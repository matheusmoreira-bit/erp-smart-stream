// Adapter do provedor BeCompliance para o módulo KYP.
// Credenciais nunca ficam em código: chegam via KYPProviderConfig, montado a
// partir de secrets do backend (BECOMPLIANCE_*) e de empresa_kyp_config.config.

import {
  formatCPF,
  maisRecente,
  onlyDigits,
  type KYPDiligenciaResult,
  type KYPFornecedorInput,
  type KYPProviderAdapter,
  type KYPProviderConfig,
  type KYPSession,
  type TipoPessoa,
} from "./types.ts";


/**
 * Normaliza a URL base: aceita tanto "https://api.becompliance.com" quanto
 * "https://api.becompliance.com/ext/v1/" (como cadastrado nos secrets) e
 * devolve sempre a raiz, evitando duplicar /ext/v1 nas rotas.
 */
export function beBaseRoot(raw: string): string {
  return (raw || "https://api.becompliance.com")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/ext\/v1$/i, "")
    .replace(/\/ext$/i, "");
}

async function request(
  url: string,
  init: RequestInit,
  timeoutMs = 30_000,
): Promise<{ status: number; body: unknown }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error("timeout")), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch { /* mantém texto */ }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function asArray(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const key of ["data", "results", "items", "content"]) {
      if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
    }
    if (obj.id || obj.status) return [obj];
  }
  return [];
}

/** Mapeia o process_status/status do BeCompliance para approved|rejected|pending. */
function mapStatus(row: Record<string, unknown>): string {
  const raw = String(row.process_status ?? row.status ?? row.result ?? row.situation ?? "pending")
    .toLowerCase();
  if (["approved", "aprovado", "finished_approved", "concluded_approved"].includes(raw)) return "approved";
  if (["rejected", "reproved", "reprovado", "disapproved", "denied", "blocked"].includes(raw)) return "rejected";
  if (["closed", "finished", "concluded", "done"].includes(raw)) return "approved";
  return "pending";
}

function normalize(row: Record<string, unknown> | null): KYPDiligenciaResult | null {
  if (!row) return null;
  const providerRefId = String(
    row.id ?? row.uuid ?? row.np_id ?? row.analysis_id ?? row.code ?? "",
  );
  const status = mapStatus(row);
  const expiry = (row.expiry_date ?? row.expiration_date ?? row.valid_until ?? null) as string | null;
  const updated = (row.updated_at ?? row.created_at ?? null) as string | null;
  return { providerRefId, status, expiryDate: expiry, updatedAt: updated, raw: row };
}

export const BeComplianceAdapter: KYPProviderAdapter = {
  code: "BECOMPLIANCE",

  async authenticate(config: KYPProviderConfig): Promise<KYPSession> {
    const url = `${beBaseRoot(config.baseUrl)}/ext/v1/${config.clientId}/auth/login`;
    const { status, body } = await request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email: config.email, password: config.password }),
    });
    if (status < 200 || status >= 300) {
      throw new Error(`BeCompliance login falhou (HTTP ${status})`);
    }
    const obj = (body ?? {}) as Record<string, unknown>;
    const token = String(
      obj.token ?? obj.access_token ?? obj.accessToken ??
        ((obj.data as Record<string, unknown> | undefined)?.token ?? ""),
    );
    if (!token) throw new Error("BeCompliance login não retornou token");
    return { token, config };
  },

  async consultarDiligencia(
    session: KYPSession,
    documento: string,
    tipoPessoa: TipoPessoa,
  ): Promise<KYPDiligenciaResult | null> {
    const { baseUrl, clientId } = session.config;
    const base = beBaseRoot(baseUrl);
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${session.token}`,
    };

    // A API expõe a mesma rota para PF e PJ. O filtro por CNPJ funciona no
    // servidor; para CPF a API ignora o parâmetro, então filtramos localmente
    // pelos dígitos do documento presentes na linha.
    const digits = onlyDigits(documento);
    const query = tipoPessoa === "PJ"
      ? `?cnpj=${encodeURIComponent(digits)}`
      : `?document_number=${encodeURIComponent(formatCPF(documento))}`;
    const url = `${base}/ext/v1/${clientId}/third-party-analysis${query}`;

    const { status, body } = await request(url, { method: "GET", headers });
    if (status === 404) return null;
    if (status < 200 || status >= 300) {
      throw new Error(`BeCompliance consulta ${tipoPessoa} falhou (HTTP ${status})`);
    }
    const todas = asArray(body);
    // Linhas que confirmam o mesmo documento.
    const comDoc = todas.filter((r) => {
      const campos = [r.cnpj, r.cpf, r.document_number, r.document, r.documento]
        .map((v) => onlyDigits(v));
      return campos.some(Boolean) && campos.includes(digits);
    });
    // Fallback: a consulta PJ já é filtrada por CNPJ no servidor. Quando o
    // provedor não devolve o documento na listagem, descartar as linhas fazia o
    // fluxo concluir "sem diligência" e abrir uma nova (duplicidade).
    const semDoc = todas.filter((r) =>
      ![r.cnpj, r.cpf, r.document_number, r.document, r.documento].some((v) => onlyDigits(v))
    );
    const rows = comDoc.length ? comDoc : (tipoPessoa === "PJ" ? semDoc : []);
    if (!rows.length) return null;
    return normalize(selecionarDiligencia(rows));

  },

  async criarDiligencia(
    session: KYPSession,
    fornecedor: KYPFornecedorInput,
  ): Promise<KYPDiligenciaResult> {
    const { baseUrl, clientId, email } = session.config;
    const base = beBaseRoot(baseUrl);
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
    };
    const empresas = fornecedor.empresas.filter(Boolean);

    const isPF = fornecedor.tipoPessoa === "PF";
    const docDigits = onlyDigits(fornecedor.documento);

    const { status, body } = await request(`${base}/ext/v1/${clientId}/third-party-analysis`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        alternative_names: [fornecedor.nome].filter(Boolean),
        ...(isPF ? { cpf: formatCPF(docDigits) } : { cnpj: docDigits }),
        name: fornecedor.nome,
        tags: empresas,
        solicitation_areas: ["Compras"],
        solicitation_user_email: email,
        search_courts_of_justice: true,
        search_international: true,
        notes: `${empresas.join(", ")} - Diligência de avaliação de fornecedor`,
      }),
    });
    if (status < 200 || status >= 300) {
      throw new Error(`BeCompliance criação ${isPF ? "PF" : "PJ"} falhou (HTTP ${status})`);
    }
    const created = normalize(asArray(body)[0] ?? (body as Record<string, unknown>));
    return created ?? {
      providerRefId: "",
      status: "pending",
      expiryDate: null,
      updatedAt: new Date().toISOString(),
      raw: body,
    };
  },
};

/** Registry extensível: novo provedor = nova entrada aqui + linha em kyp_providers. */
export const KYP_ADAPTERS: Record<string, KYPProviderAdapter> = {
  BECOMPLIANCE: BeComplianceAdapter,
};
