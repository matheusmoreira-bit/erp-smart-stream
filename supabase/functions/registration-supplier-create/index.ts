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
import { resolveBeComplianceConfig } from "../_shared/kyp/config.ts";
import { classificarDocumento, decidirAcao, type KYPProviderConfig } from "../_shared/kyp/types.ts";

type Sb = ReturnType<typeof createClient>;

interface Body {
  action?: "kyp" | "create" | "next-code";
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

async function providerConfig(
  sb: Sb,
  code: string,
  extra: Record<string, unknown>,
  companyDb?: string | null,
): Promise<KYPProviderConfig | null> {
  if (code !== "BECOMPLIANCE") return null;
  return await resolveBeComplianceConfig(sb as any, companyDb ?? null, extra);
}

interface KypOutcome {
  available: boolean;
  ok: boolean;
  status: "aprovado" | "pendente" | "reprovado" | "indisponivel";
  motivo: string;
  providerRefId?: string | null;
  expiryDate?: string | null;
  /** Detalhes completos do provedor, para exibição/cópia na UI. */
  detalhes?: {
    provider?: string;
    documento?: string;
    tipoPessoa?: string;
    providerStatus?: string | null;
    updatedAt?: string | null;
    campos?: Record<string, unknown>;
  };
}

/** Reduz o payload bruto do provedor a campos legíveis (sem dados sensíveis de sessão). */
function camposDoProvedor(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (/token|password|secret|authorization/i.test(k)) continue;
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "object") {
      out[k] = JSON.stringify(v).slice(0, 500);
    } else {
      out[k] = v;
    }
  }
  return out;
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
  const config = adapter
    ? await providerConfig(sb, providerCode, (cfg?.config ?? {}) as Record<string, unknown>, companyDb)
    : null;
  if (!adapter || !config) {
    return {
      available: false,
      ok: false,
      status: "indisponivel",
      motivo: "Provedor de KYP não configurado nesta instalação.",
      detalhes: { provider: providerCode, documento: doc.documento, tipoPessoa: doc.tipoPessoa },
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
      detalhes: {
        provider: providerCode,
        documento: doc.documento,
        tipoPessoa: doc.tipoPessoa,
        providerStatus: criada.status ?? null,
        updatedAt: criada.updatedAt ?? null,
        campos: camposDoProvedor(criada.raw),
      },
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
      detalhes: {
        provider: providerCode,
        documento: doc.documento,
        tipoPessoa: doc.tipoPessoa,
        providerStatus: atual?.status ?? null,
        updatedAt: atual?.updatedAt ?? null,
        campos: camposDoProvedor(atual?.raw),
      },
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
      detalhes: {
        provider: providerCode,
        documento: doc.documento,
        tipoPessoa: doc.tipoPessoa,
        providerStatus: atual?.status ?? null,
        updatedAt: atual?.updatedAt ?? null,
        campos: camposDoProvedor(atual?.raw),
      },
    };
  }

  return {
    available: true,
    ok: true,
    status: "aprovado",
    motivo: decisao.motivo,
    providerRefId: atual?.providerRefId ?? null,
    expiryDate: atual?.expiryDate ?? null,
    detalhes: {
      provider: providerCode,
      documento: doc.documento,
      tipoPessoa: doc.tipoPessoa,
      providerStatus: atual?.status ?? null,
      updatedAt: atual?.updatedAt ?? null,
      campos: camposDoProvedor(atual?.raw),
    },
  };
}

/** Gera o próximo código sequencial de fornecedor no padrão FXXXXXX (prefixo + 6 dígitos). */
async function nextSupplierCode(baseUrl: string, cookie: string, prefix = "F", width = 6): Promise<string> {
  const filtro = encodeURIComponent(`startswith(CardCode,'${prefix}') and CardType eq 'cSupplier'`);
  const url = `${baseUrl}/BusinessPartners?$select=CardCode&$filter=${filtro}&$orderby=CardCode desc&$top=200`;
  let maior = 0;
  try {
    const res = await fetch(url, { headers: { Cookie: cookie } });
    if (res.ok) {
      const parsed = JSON.parse(await res.text()) as { value?: { CardCode?: string }[] };
      for (const row of parsed.value ?? []) {
        const m = new RegExp(`^${prefix}(\\d+)$`).exec(String(row.CardCode ?? "").trim());
        if (m) maior = Math.max(maior, Number(m[1]));
      }
    }
  } catch { /* sem base para sequência: começa do zero */ }
  return `${prefix}${String(maior + 1).padStart(width, "0")}`;
}

/** Resolve o código de moeda válido na base (ex.: BRL pode ser "R$" no SAP). Retorna null se não existir. */
async function resolveCurrency(baseUrl: string, cookie: string, wanted: string): Promise<string | null> {
  const alvo = String(wanted || "").trim();
  if (!alvo) return null;
  try {
    const res = await fetch(`${baseUrl}/Currencies?$select=Code,Name,InternationalDescription&$top=200`, {
      headers: { Cookie: cookie },
    });
    if (!res.ok) return null;
    const rows = (JSON.parse(await res.text()).value ?? []) as {
      Code?: string;
      Name?: string;
      InternationalDescription?: string;
    }[];
    const up = alvo.toUpperCase();
    const exato = rows.find((c) => String(c.Code ?? "").toUpperCase() === up);
    if (exato?.Code) return String(exato.Code);
    const porDescricao = rows.find(
      (c) => String(c.InternationalDescription ?? "").toUpperCase() === up || String(c.Name ?? "").toUpperCase() === up,
    );
    if (porDescricao?.Code) return String(porDescricao.Code);
    if (up === "BRL") {
      const real = rows.find((c) => ["R$", "BRL", "REA", "RS"].includes(String(c.Code ?? "").toUpperCase()));
      if (real?.Code) return String(real.Code);
    }
    return null;
  } catch {
    return null;
  }
}

/** Idempotência: procura um Business Partner já existente por CardCode ou por CNPJ/CPF. */
async function findExistingBp(
  baseUrl: string,
  cookie: string,
  cardCode: string,
  documento: string,
): Promise<string | null> {
  const get = async (url: string) => {
    try {
      const res = await fetch(url, { headers: { Cookie: cookie } });
      if (!res.ok) return null;
      return JSON.parse(await res.text()) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  if (!cardCode) {
    // sem código informado: só a busca por documento faz sentido
  } else {
  const byCode = await get(`${baseUrl}/BusinessPartners('${encodeURIComponent(cardCode)}')?$select=CardCode`);
  if (byCode?.CardCode) return String(byCode.CardCode);
  }

  const doc = (documento || "").replace(/\D/g, "");
  if (doc.length >= 11) {
    const filtro = encodeURIComponent(`FederalTaxID eq '${doc}' and CardType eq 'cSupplier'`);
    const byDoc = await get(`${baseUrl}/BusinessPartners?$select=CardCode&$filter=${filtro}&$top=1`);
    const rows = (byDoc?.value ?? []) as { CardCode?: string }[];
    if (rows[0]?.CardCode) return String(rows[0].CardCode);
  }
  return null;
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
    // Consulta de KYP roda apenas na ação explícita "kyp".
    // O cadastro NÃO é bloqueado pelo KYP: a gestão do fornecedor pelo fluxo de KYP
    // será tratada em um momento posterior.
    if (body.action === "kyp") {
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
      await logEvent(sb, requestId, caller.email, `Validação KYP: ${kyp.status.toUpperCase()} — ${kyp.motivo}`);
      return json(200, { ok: true, kyp });
    }

    /* --------------------- próximo código no ERP ----------------------- */
    if (body.action === "next-code") {
      if (!companyDb) return json(400, { error: "Empresa (company_db) não identificada no chamado." });
      const credsNc = await loadSapCreds(sb, companyDb);
      if (!credsNc) return json(400, { error: `Credenciais SAP não configuradas para ${companyDb}.` });
      const baseNc = buildSapBaseUrl(credsNc.service_layer_url);
      const cookieNc = await sapCookieLogin(baseNc, credsNc.company_db || companyDb, credsNc.username, credsNc.password);
      try {
        const suggested = await nextSupplierCode(baseNc, cookieNc);
        return json(200, { ok: true, cardCode: suggested, companyDb });
      } finally {
        await sapLogout(baseNc, cookieNc).catch(() => {});
      }
    }

    /* ------------------------ criação no SAP --------------------------- */
    // Idempotência 1: o chamado já tem um código gravado — nada a criar.
    const jaRegistrado = String(r.sap_card_code ?? "").trim();
    if (jaRegistrado) {
      return json(200, {
        ok: true,
        cardCode: jaRegistrado,
        alreadyRegistered: true,
        message: `Fornecedor já cadastrado neste chamado com o código ${jaRegistrado}.`,
      });
    }

    const cardCodeInformado = String(body.cardCode ?? "").trim();
    if (!companyDb) return json(400, { error: "Empresa (company_db) não identificada no chamado." });

    const creds = await loadSapCreds(sb, companyDb);
    if (!creds) return json(400, { error: `Credenciais SAP não configuradas para ${companyDb}.` });
    const baseUrl = buildSapBaseUrl(creds.service_layer_url);
    const cookie = await sapCookieLogin(baseUrl, creds.company_db || companyDb, creds.username, creds.password);

    // Código no ERP obtido automaticamente quando não informado (FXXXXXX + 1).
    let cardCode = cardCodeInformado;
    try {
      if (!cardCode) cardCode = await nextSupplierCode(baseUrl, cookie);
    } catch {
      await sapLogout(baseUrl, cookie).catch(() => {});
      return json(400, { error: "Não foi possível obter o próximo código de fornecedor no ERP." });
    }

    try {
      // Idempotência 2: o Business Partner já existe no SAP (mesmo CardCode ou mesmo CNPJ/CPF).
      // Se o código foi gerado automaticamente e já existe, avança a sequência.
      if (!cardCodeInformado) {
        for (let i = 0; i < 20; i++) {
          const ocupado = await findExistingBp(baseUrl, cookie, cardCode, "");
          if (!ocupado) break;
          const m = /^([A-Za-z]+)(\d+)$/.exec(cardCode);
          cardCode = m ? `${m[1]}${String(Number(m[2]) + 1).padStart(m[2].length, "0")}` : cardCode;
        }
      }

      const existente = await findExistingBp(baseUrl, cookie, cardCodeInformado ? cardCode : "", documento);
      if (existente) {
        await sb.from("registration_requests").update({ sap_card_code: existente }).eq("id", requestId);
        await logEvent(
          sb,
          requestId,
          caller.email,
          `Cadastro não duplicado: fornecedor já existente no SAP (${companyDb}) com CardCode ${existente}.`,
        );
        return json(200, {
          ok: true,
          cardCode: existente,
          alreadyRegistered: true,
          message: `Fornecedor já existia no ERP com o código ${existente}. Nenhum cadastro duplicado foi criado.`,
        });
      }

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
        Currency: await resolveCurrency(baseUrl, cookie, String(body.currency || (r.currency as string | null) || "")) ?? undefined,
        Notes: [bankSummary, r.notes as string | null].filter(Boolean).join(" | ").slice(0, 100) || undefined,
        FreeText: bankSummary || undefined,
      };
      if (typeof body.groupCode === "number") payload.GroupCode = body.groupCode;
      for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];

      const postBp = async (data: Record<string, unknown>) => {
        const r2 = await fetch(`${baseUrl}/BusinessPartners`, {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        return { r2, t2: await r2.text() };
      };

      let { r2: res, t2: text } = await postBp(payload);
      // Moeda inexistente na base: repete sem o campo Currency (assume a moeda padrão do SAP).
      if (!res.ok && /Currency/i.test(text) && payload.Currency !== undefined) {
        delete payload.Currency;
        ({ r2: res, t2: text } = await postBp(payload));
      }
      if (!res.ok) {
        let msg = text;
        let code: string | number | undefined;
        try {
          const parsed = JSON.parse(text);
          msg = parsed?.error?.message?.value ?? text;
          code = parsed?.error?.code;
        } catch { /* texto cru */ }
        // SAP recusou por duplicidade: reaproveita o BP existente em vez de falhar.
        if (/already exist|já existe|duplicate/i.test(String(msg)) || code === -2035) {
          const dup = await findExistingBp(baseUrl, cookie, cardCode, documento);
          if (dup) {
            await sb.from("registration_requests").update({ sap_card_code: dup }).eq("id", requestId);
            await logEvent(sb, requestId, caller.email, `Cadastro não duplicado: fornecedor já existente no SAP com CardCode ${dup}.`);
            return json(200, {
              ok: true,
              cardCode: dup,
              alreadyRegistered: true,
              message: `Fornecedor já existia no ERP com o código ${dup}. Nenhum cadastro duplicado foi criado.`,
            });
          }
        }
        await logEvent(sb, requestId, caller.email, `Falha ao criar fornecedor no SAP: ${msg}`);
        return json(400, {
          error: `SAP recusou a criação: ${msg}`,
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
        `Fornecedor criado no SAP (${companyDb}) com CardCode ${created.CardCode ?? cardCode}. KYP: não validado neste cadastro (gestão posterior pelo fluxo de KYP).`,
      );

      return json(200, { ok: true, cardCode: created.CardCode ?? cardCode });
    } finally {
      await sapLogout(baseUrl, cookie).catch(() => {});
    }
  } catch (e) {
    if (e instanceof AuthError) return json(e.status ?? 401, { error: e.message });
    console.error("[registration-supplier-create]", e);
    return json(500, { error: e instanceof Error ? e.message : "Erro inesperado" });
  }
});
