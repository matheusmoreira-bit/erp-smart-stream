// Contratos agnósticos de provedor para o módulo KYP (Know Your Partner).
// Mesmo padrão de adapter usado no MasterTax (ContaPagaERP): cada provedor
// normaliza sua resposta para KYPDiligenciaResult e a regra de decisão vive
// fora do adapter (função pura reutilizável).

export type TipoPessoa = "PF" | "PJ";
export type KYPAcao = "NOOP" | "CREATE" | "DEACTIVATE" | "ERRO";

export interface KYPProviderConfig {
  clientId: string;
  baseUrl: string;
  email: string;
  password: string;
  /** Parâmetros específicos do provedor (empresa_kyp_config.config). */
  extra?: Record<string, unknown>;
}

export interface KYPSession {
  token: string;
  config: KYPProviderConfig;
  expiresAt?: number;
}

export interface KYPDiligenciaResult {
  providerRefId: string;
  status: "approved" | "rejected" | "pending" | string;
  expiryDate: string | null;
  updatedAt: string | null;
  raw: unknown;
}

export interface KYPFornecedorInput {
  documento: string;
  nome: string;
  tipoPessoa: TipoPessoa;
  empresas: string[];
}

export interface KYPProviderAdapter {
  code: string;
  authenticate(config: KYPProviderConfig): Promise<KYPSession>;
  consultarDiligencia(
    session: KYPSession,
    documento: string,
    tipoPessoa: TipoPessoa,
  ): Promise<KYPDiligenciaResult | null>;
  criarDiligencia(
    session: KYPSession,
    fornecedor: KYPFornecedorInput,
  ): Promise<KYPDiligenciaResult>;
}

/* ---------------------------- validação de documento ---------------------------- */

export function onlyDigits(value: unknown): string {
  return String(value ?? "").replace(/\D+/g, "");
}

export function isCPF(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(cpf[i]) * (10 - i);
  let d1 = (sum * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== Number(cpf[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(cpf[i]) * (11 - i);
  let d2 = (sum * 10) % 11;
  if (d2 === 10) d2 = 0;
  return d2 === Number(cpf[10]);
}

export function isCNPJ(value: string): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (len: number) => {
    let pos = len - 7;
    let sum = 0;
    for (let i = 0; i < len; i++) {
      sum += Number(cnpj[i]) * pos--;
      if (pos < 2) pos = 9;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(cnpj[12]) && calc(13) === Number(cnpj[13]);
}

/** Classifica o documento; null quando inválido ou descartável (prefixo 000). */
export function classificarDocumento(value: unknown): { documento: string; tipoPessoa: TipoPessoa } | null {
  const doc = onlyDigits(value);
  if (!doc || doc.startsWith("000")) return null;
  if (doc.length === 11 && isCPF(doc)) return { documento: doc, tipoPessoa: "PF" };
  if (doc.length === 14 && isCNPJ(doc)) return { documento: doc, tipoPessoa: "PJ" };
  return null;
}

export function formatCPF(doc: string): string {
  const d = onlyDigits(doc).padStart(11, "0");
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
}

export function maskDocumento(doc: string): string {
  const d = onlyDigits(doc);
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  if (d.length === 14) return `**.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-**`;
  return d ? `${d.slice(0, 3)}***` : "";
}

/* ------------------------------ regra de decisão ------------------------------- */

export interface KYPDecisao {
  acao: KYPAcao;
  motivo: string;
}

/**
 * Regra pura (idêntica ao node "Decide Ação PF/PJ" do workflow n8n):
 * - sem diligência        -> CREATE
 * - status rejected       -> DEACTIVATE
 * - sem expiry_date       -> NOOP (válida)
 * - expiry_date no passado-> CREATE (expirada)
 * - caso contrário        -> NOOP
 */
export function decidirAcao(result: KYPDiligenciaResult | null, now = new Date()): KYPDecisao {
  if (!result) return { acao: "CREATE", motivo: "Nenhuma diligência encontrada no provedor" };
  const status = String(result.status ?? "").toLowerCase();
  if (status === "rejected") {
    return { acao: "DEACTIVATE", motivo: "Diligência reprovada pelo provedor (rejected)" };
  }
  if (!result.expiryDate) {
    return { acao: "NOOP", motivo: "Diligência válida (sem data de expiração)" };
  }
  const expiry = new Date(result.expiryDate);
  if (isNaN(expiry.getTime())) {
    return { acao: "NOOP", motivo: "Diligência válida (data de expiração ilegível)" };
  }
  if (expiry.getTime() < now.getTime()) {
    return { acao: "CREATE", motivo: `Diligência expirada em ${expiry.toISOString().slice(0, 10)}` };
  }
  return { acao: "NOOP", motivo: `Diligência válida até ${expiry.toISOString().slice(0, 10)}` };
}

/** Ordena resultados por updated_at > created_at > expiry_date e devolve o mais recente. */
export function maisRecente<T extends Record<string, unknown>>(rows: T[]): T | null {
  if (!rows?.length) return null;
  const ts = (r: T) => {
    const raw = (r.updated_at ?? r.created_at ?? r.expiry_date ?? null) as string | null;
    const t = raw ? new Date(raw).getTime() : NaN;
    return isNaN(t) ? 0 : t;
  };
  return [...rows].sort((a, b) => ts(b) - ts(a))[0] ?? null;
}
