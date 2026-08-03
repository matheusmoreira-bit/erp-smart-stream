// registration-supplier-create — valida o KYP (Know Your Partner) do documento
// e, se liberado, cria o fornecedor (BusinessPartner) no SAP a partir de um
// chamado de cadastro (public.registration_requests).
//
// Ações:
//   { action: "kyp",    requestId }                       -> só consulta/cria diligência
//   { action: "create", requestId, cardCode, ... }        -> valida KYP e cria o BP no SAP
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { AuthError, requireUser, validateSapSession } from "../_shared/auth.ts";
import { corsFor, rejectForeignOrigin } from "../_shared/cors-allowlist.ts";
import { buildSapBaseUrl, loadSapCreds, sapCookieLogin, sapLogout } from "../_shared/sap-cache.ts";
import { KYP_ADAPTERS } from "../_shared/kyp/becompliance.ts";
import { classificarDocumento, decidirAcao, type KYPProviderConfig } from "../_shared/kyp/types.ts";

type Sb = ReturnType<typeof createClient>;

interface Body {
  action?: "kyp" | "create";
  requestId?: string;
  cardCode?: string;
  groupCode?: number | null;
  currency?: string | null;
  acknowledgePending?: boolean;
}

function service(): Sb {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

/** Mesma normalização do public.canonical_user_key: local-part sem sufixos
 *  .ext/.adm e sem pontuação (ex.: "samara.souza@x" -> "samarasouza"). */
function canonicalKey(email: string): string {
  const local = String(email || "").toLowerCase().trim().split("@")[0];
  return local.replace(/\.(ext|adm)$/i, "").replace(/[^a-z0-9]/g, "");
}


async function isAgent(sb: Sb, email: string): Promise<boolean> {
  const lower = String(email || "").toLowerCase().trim();
  if (!lower) return false;
  const key = canonicalKey(lower);

  // Super-admin / admin do SAP (mesma regra usada nos demais módulos).
  if (lower === "manager") return true;
  const { data: sapAdmin } = await sb.rpc("is_sap_user_admin", {
    _sap_username: lower.split("@")[0],
  });
  if (sapAdmin === true) return true;

  const { data: groups } = await sb.from("permission_groups").select("id,name");
  const ids = (groups || [])
    .filter((g) => ["facilities", "admin"].includes(String((g as { name?: string }).name || "").trim().toLowerCase()))
    .map((g) => (g as { id: string }).id);
  if (!ids.length) return false;
  const { data: assignments } = await sb
    .from("user_group_assignments")
    .select("sap_email")
    .in("group_id", ids);
  const ok = (assignments || []).some((a) => {
    const v = String((a as { sap_email?: string }).sap_email || "").toLowerCase().trim();
    return v === lower || v === lower.split("@")[0] || canonicalKey(v) === key;
  });
  if (!ok) console.warn("[registration-supplier-create] acesso negado", { caller: lower, key });
  return ok;
}


/** Identidade do chamador: usuário Cloud ou sessão SAP. */
async function resolveCaller(req: Request): Promise<{ email: string; companyDb: string | null }> {
  try {
    const user = await requireUser(req);
    if (user?.email) return { email: user.email, companyDb: null };
  } catch { /* tenta sessão SAP */ }
  const sap = await validateSapSession(req);
  if (sap) {
    const s = sap as unknown as { sapUser?: string; companyDB?: string; email?: string };
    const email = s.email || s.sapUser || "";
    if (email) return { email, companyDb: s.companyDB ?? null };
  }
  throw new AuthError("Não autenticado", 401);
}

function providerConfig(code: string, extra: Record<string, unknown>): KYPProviderConfig | null {
  if (code !== "BECOMPLIANCE") return null;
  const clientId = String(extra.client_id ?? "") || Deno.env.get("BECOMPLIANCE_CLIENT_ID") || "";
  const baseUrl = String(extra.base_url ?? "") || Deno.env.get("BECOMPLIANCE_BASE_URL") ||
    "https://api.becompliance.com";
  const email = Deno.env.get("BECOMPLIANCE_EMAIL") || "";
  const password = Deno.env.get("BECOMPLIANCE_PASSWORD") || "";
  if (!clientId || !email || !password) return null;
  return { clientId, baseUrl, email, password, extra };
}

interface KypOutcome {
  available: boolean;
  ok: boolean;
  status: "aprovado" | "pendente" | "reprovado" | "indisponivel";
  motivo: string;
  providerRefId?: string | null;
  expiryDate?: string | null;
}

/** Consulta (e cria, se faltar) a diligência do documento no provedor de KYP. */
async function runKyp(sb: Sb, documento: string, nome: string, companyDb: string | null): Promise<KypOutcome> {
  const doc = classificarDocumento(documento);
  if (!doc) {
    return { available: true, ok: false, status: "reprovado", motivo: "CNPJ/CPF inválido no chamado." };
  }

  const { data: cfgRaw } = await sb
    .from("empresa_kyp_config")
    .select("company_id, kyp_provider_id, ativo, config, kyp_providers(code, ativo)")
    .limit(50);
  const cfg = (cfgRaw ?? [])[0] as Record<string, unknown> | undefined;
  const prov = (cfg?.kyp_providers ?? null) as { code?: string; ativo?: boolean } | null;
  const providerCode = String(prov?.code ?? "BECOMPLIANCE");
  const adapter = KYP_ADAPTERS[providerCode];
  const config = adapter ? providerConfig(providerCode, (cfg?.config ?? {}) as Record<string, unknown>) : null;
  if (!adapter || !config) {
    return {
      available: false,
      ok: false,
      status: "indisponivel",
      motivo: "Provedor de KYP não configurado nesta instalação.",
    };
  }

  const session = await adapter.authenticate(config);
  let atual = await adapter.consultarDiligencia(session, doc.documento, doc.tipoPessoa);
  let decisao = decidirAcao(atual);

  if (decisao.acao === "CREATE") {
    const criada = await adapter.criarDiligencia(session, {
      documento: doc.documento,
      nome: nome || doc.documento,
      tipoPessoa: doc.tipoPessoa,
      empresas: companyDb ? [companyDb] : [],
    });
    atual = criada;
    decisao = { acao: "NOOP", motivo: "Diligência aberta no provedor — aguardando análise." };
    return {
      available: true,
      ok: false,
      status: "pendente",
      motivo: decisao.motivo,
      providerRefId: criada.providerRefId,
      expiryDate: criada.expiryDate,
    };
  }

  if (decisao.acao === "DEACTIVATE") {
    return {
      available: true,
      ok: false,
      status: "reprovado",
      motivo: decisao.motivo,
      providerRefId: atual?.providerRefId ?? null,
      expiryDate: atual?.expiryDate ?? null,
    };
  }

  const providerStatus = String(atual?.status ?? "").toLowerCase();
  if (providerStatus && providerStatus !== "approved") {
    return {
      available: true,
      ok: false,
      status: "pendente",
      motivo: `Diligência em análise no provedor (${providerStatus}).`,
      providerRefId: atual?.providerRefId ?? null,
      expiryDate: atual?.expiryDate ?? null,
    };
  }

  return {
    available: true,
    ok: true,
    status: "aprovado",
    motivo: decisao.motivo,
    providerRefId: atual?.providerRefId ?? null,
    expiryDate: atual?.expiryDate ?? null,
  };
}

async function logEvent(sb: Sb, requestId: string, author: string, message: string) {
  await sb.from("registration_request_events").insert({
    request_id: requestId,
    event_type: "audit",
    message,
    author_email: author,
  });
}

Deno.serve(async (req) => {
  const foreign = rejectForeignOrigin(req);
  if (foreign) return foreign;
  const corsHeaders = corsFor(req);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const sb = service();
  try {
    const caller = await resolveCaller(req);
    if (!(await isAgent(sb, caller.email))) {
      return json(403, { error: "Apenas o time de Facilities/Admin pode cadastrar fornecedores." });
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const requestId = String(body.requestId ?? "").trim();
    if (!requestId) return json(400, { error: "requestId obrigatório" });

    const { data: reqRow, error: reqErr } = await sb
      .from("registration_requests")
      .select("*")
      .eq("id", requestId)
      .maybeSingle();
    if (reqErr) return json(400, { error: reqErr.message });
    if (!reqRow) return json(404, { error: "Chamado não encontrado" });

    const r = reqRow as Record<string, unknown>;
    if (String(r.request_type) !== "supplier") {
      return json(400, { error: "Este chamado não é de cadastro de fornecedor." });
    }

    const companyDb = (r.company_db as string | null) ?? caller.companyDb;
    const documento = String(r.federal_tax_id ?? "");
    const nome = String(r.title ?? "");

    /* ------------------------------- KYP ------------------------------- */
    let kyp: KypOutcome;
    try {
      kyp = await runKyp(sb, documento, nome, companyDb);
    } catch (e) {
      kyp = {
        available: false,
        ok: false,
        status: "indisponivel",
        motivo: e instanceof Error ? e.message : "Falha ao consultar o provedor de KYP",
      };
    }

    if (body.action === "kyp") {
      await logEvent(
        sb,
        requestId,
        caller.email,
        `Validação KYP: ${kyp.status.toUpperCase()} — ${kyp.motivo}`,
      );
      return json(200, { ok: true, kyp });
    }

    /* ------------------------ criação no SAP --------------------------- */
    if (kyp.status === "reprovado") {
      await logEvent(sb, requestId, caller.email, `Cadastro bloqueado pelo KYP: ${kyp.motivo}`);
      return json(422, { error: `Cadastro bloqueado pelo KYP: ${kyp.motivo}`, kyp });
    }
    if (kyp.status !== "aprovado" && !body.acknowledgePending) {
      return json(409, { error: `KYP não aprovado: ${kyp.motivo}`, kyp, requiresAcknowledge: true });
    }

    const cardCode = String(body.cardCode ?? "").trim();
    if (!cardCode) return json(400, { error: "Informe o CardCode do fornecedor." });
    if (!companyDb) return json(400, { error: "Empresa (company_db) não identificada no chamado." });

    const creds = await loadSapCreds(sb, companyDb);
    if (!creds) return json(400, { error: `Credenciais SAP não configuradas para ${companyDb}.` });
    const baseUrl = buildSapBaseUrl(creds.service_layer_url);
    const cookie = await sapCookieLogin(baseUrl, creds.company_db || companyDb, creds.username, creds.password);

    try {
      const bank = (r.bank_details ?? {}) as Record<string, string | undefined>;
      const bankSummary = [
        bank.pixKey ? `PIX (${bank.pixKeyType || "chave"}): ${bank.pixKey}` : null,
        bank.bank ? `Banco ${bank.bank}` : null,
        bank.agency ? `Ag. ${bank.agency}` : null,
        bank.account ? `Cc. ${bank.account}` : null,
        bank.accountType || null,
        bank.holderName ? `Titular ${bank.holderName}${bank.holderTaxId ? ` (${bank.holderTaxId})` : ""}` : null,
        bank.other || null,
      ].filter(Boolean).join(" · ");

      const payload: Record<string, unknown> = {
        CardCode: cardCode,
        CardName: nome,
        CardType: "cSupplier",
        FederalTaxID: documento || undefined,
        EmailAddress: (r.contact_email as string | null) || undefined,
        Phone1: (r.phone1 as string | null) || undefined,
        Phone2: (r.phone2 as string | null) || undefined,
        Currency: body.currency || (r.currency as string | null) || undefined,
        Notes: [bankSummary, r.notes as string | null].filter(Boolean).join(" | ").slice(0, 100) || undefined,
        FreeText: bankSummary || undefined,
      };
      if (typeof body.groupCode === "number") payload.GroupCode = body.groupCode;
      for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];

      const res = await fetch(`${baseUrl}/BusinessPartners`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      if (!res.ok) {
        let msg = text;
        let code: string | number | undefined;
        try {
          const parsed = JSON.parse(text);
          msg = parsed?.error?.message?.value ?? text;
          code = parsed?.error?.code;
        } catch { /* texto cru */ }
        await logEvent(sb, requestId, caller.email, `Falha ao criar fornecedor no SAP: ${msg}`);
        return json(400, {
          error: `SAP recusou a criação: ${msg}`,
          kyp,
          details: { httpStatus: res.status, sapErrorCode: code, cardCode, companyDb, raw: text.slice(0, 1000) },
        });
      }

      const created = JSON.parse(text) as { CardCode?: string; CardName?: string };

      await sb
        .from("registration_requests")
        .update({ sap_card_code: created.CardCode ?? cardCode })
        .eq("id", requestId);

      await logEvent(
        sb,
        requestId,
        caller.email,
        `Fornecedor criado no SAP (${companyDb}) com CardCode ${created.CardCode ?? cardCode}. KYP: ${kyp.status}${
          kyp.status !== "aprovado" ? ` — ${kyp.motivo}` : ""
        }.`,
      );

      return json(200, { ok: true, cardCode: created.CardCode ?? cardCode, kyp });
    } finally {
      await sapLogout(baseUrl, cookie).catch(() => {});
    }
  } catch (e) {
    if (e instanceof AuthError) return json(e.status ?? 401, { error: e.message });
    console.error("[registration-supplier-create]", e);
    return json(500, { error: e instanceof Error ? e.message : "Erro inesperado" });
  }
});
