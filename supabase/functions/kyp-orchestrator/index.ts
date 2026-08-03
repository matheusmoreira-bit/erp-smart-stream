// kyp-orchestrator — varre fornecedores dos ERPs conectados, avalia a diligência
// no provedor de KYP configurado por empresa, cria/reutiliza diligência e bloqueia
// fornecedores reprovados. Toda a atividade vai para public.kyp_avaliacoes.
//
// Modos:
//   { mode: "full" }                    -> varredura completa (cron horário)
//   { mode: "single", documento: "..." } -> reprocessa um fornecedor (Auditoria)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { releaseWatcherLock, tryWatcherLock, isTestCompanyDb } from "../_shared/watcher-lock.ts";
import { KYP_ADAPTERS } from "../_shared/kyp/becompliance.ts";
import { resolveBeComplianceConfig } from "../_shared/kyp/config.ts";
import {
  decidirAcao,
  type KYPDiligenciaResult,
  type KYPProviderAdapter,
  type KYPProviderConfig,
  type KYPSession,
} from "../_shared/kyp/types.ts";
import {
  omieBlockSupplier,
  omieCreds,
  omieListSuppliers,
  sapBlockSupplier,
  sapClose,
  sapListSuppliers,
  sapSession,
  type FornecedorERP,
} from "../_shared/kyp/erp-sources.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Sb = ReturnType<typeof createClient>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function service(): Sb {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

/** Config do provedor: credenciais da tela de Credenciais + secrets do backend. */
async function providerConfig(
  sb: Sb,
  code: string,
  extra: Record<string, unknown>,
  companyDb?: string | null,
): Promise<KYPProviderConfig | null> {
  if (code !== "BECOMPLIANCE") return null;
  return await resolveBeComplianceConfig(sb as any, companyDb ?? null, extra);
}

interface CompanyRow {
  id: string;
  company_db: string;
  erp_type: string | null;
  display_name: string | null;
  is_active: boolean | null;
  is_test: boolean | null;
}

/* ------------------------------ coleta nos ERPs ------------------------------ */

async function coletarFornecedores(sb: Sb, companies: CompanyRow[]) {
  const encontrados: FornecedorERP[] = [];
  const erros: Array<{ company_db: string; error: string }> = [];

  for (const c of companies) {
    const erp = (c.erp_type || "sap").toLowerCase();
    try {
      if (erp === "omie") {
        const creds = await omieCreds(sb, c.company_db);
        if (!creds) continue;
        encontrados.push(...await omieListSuppliers(creds, c.company_db));
      } else {
        const session = await sapSession(sb, c.company_db);
        if (!session) continue;
        try {
          encontrados.push(...await sapListSuppliers(session, c.company_db));
        } finally {
          await sapClose(session);
        }
      }
    } catch (e) {
      erros.push({ company_db: c.company_db, error: (e as Error).message });
      console.error(`[kyp] coleta falhou em ${c.company_db}:`, e);
    }
  }
  return { encontrados, erros };
}

async function upsertFornecedores(sb: Sb, rows: FornecedorERP[], companies: CompanyRow[]) {
  const byDb = new Map(companies.map((c) => [c.company_db, c]));
  const porDocumento = new Map<string, FornecedorERP[]>();
  for (const r of rows) {
    const list = porDocumento.get(r.documento) ?? [];
    list.push(r);
    porDocumento.set(r.documento, list);
  }

  for (const [documento, ocorrencias] of porDocumento) {
    const first = ocorrencias[0];
    const { data: forn, error } = await sb
      .from("kyp_fornecedores")
      .upsert(
        {
          documento,
          tipo_pessoa: first.tipoPessoa,
          nome: ocorrencias.find((o) => o.nome)?.nome ?? null,
        },
        { onConflict: "documento", ignoreDuplicates: false },
      )
      .select("id")
      .single();
    if (error || !forn) {
      console.error("[kyp] upsert fornecedor falhou", documento, error?.message);
      continue;
    }
    const payload = ocorrencias.map((o) => ({
      kyp_fornecedor_id: (forn as { id: string }).id,
      company_id: byDb.get(o.companyDb)?.id ?? null,
      company_db: o.companyDb,
      erp: o.erp,
      codigo_fornecedor_erp: o.codigo,
      nome_erp: o.nome || null,
      detalhes: o.detalhes,
    }));
    const { error: occErr } = await sb
      .from("kyp_fornecedor_ocorrencias")
      .upsert(payload, { onConflict: "company_db,erp,codigo_fornecedor_erp" });
    if (occErr) console.error("[kyp] upsert ocorrências falhou", documento, occErr.message);
  }
  return porDocumento.size;
}

/* ------------------------------ avaliação -------------------------------- */

interface Ocorrencia {
  id: string;
  company_id: string | null;
  company_db: string;
  erp: "SAP" | "OMIE";
  codigo_fornecedor_erp: string;
}

interface FornecedorRow {
  id: string;
  documento: string;
  tipo_pessoa: "PF" | "PJ";
  nome: string | null;
}

async function bloquearNosErps(sb: Sb, ocorrencias: Ocorrencia[]) {
  const empresas: string[] = [];
  const falhas: string[] = [];
  const porDb = new Map<string, Ocorrencia[]>();
  for (const o of ocorrencias) {
    porDb.set(o.company_db, [...(porDb.get(o.company_db) ?? []), o]);
  }

  for (const [companyDb, list] of porDb) {
    try {
      if (list[0].erp === "OMIE") {
        const creds = await omieCreds(sb, companyDb);
        if (!creds) throw new Error("credenciais Omie ausentes");
        for (const o of list) await omieBlockSupplier(creds, o.codigo_fornecedor_erp);
      } else {
        const session = await sapSession(sb, companyDb);
        if (!session) throw new Error("credenciais SAP ausentes");
        try {
          for (const o of list) await sapBlockSupplier(session, o.codigo_fornecedor_erp);
        } finally {
          await sapClose(session);
        }
      }
      empresas.push(companyDb);
      await sb
        .from("kyp_fornecedor_ocorrencias")
        .update({ bloqueado_em: new Date().toISOString() })
        .in("id", list.map((o) => o.id));
    } catch (e) {
      falhas.push(`${companyDb}: ${(e as Error).message}`);
    }
  }
  return { empresas, falhas };
}

async function avaliarFornecedor(
  sb: Sb,
  forn: FornecedorRow,
  ctx: {
    adapter: KYPProviderAdapter;
    session: KYPSession;
    providerId: string;
    providerCode: string;
    disparadoPor: string;
  },
) {
  const { data: occRaw } = await sb
    .from("kyp_fornecedor_ocorrencias")
    .select("id, company_id, company_db, erp, codigo_fornecedor_erp")
    .eq("kyp_fornecedor_id", forn.id);
  const ocorrencias = (occRaw ?? []) as unknown as Ocorrencia[];
  const empresas = [...new Set(ocorrencias.map((o) => o.company_db))];

  const registrar = async (
    acao: "NOOP" | "CREATE" | "DEACTIVATE" | "ERRO",
    motivo: string,
    sucesso: boolean,
    result: KYPDiligenciaResult | null,
    empresasAfetadas: string[],
  ) => {
    await sb.from("kyp_avaliacoes").insert({
      kyp_fornecedor_id: forn.id,
      documento: forn.documento,
      tipo_pessoa: forn.tipo_pessoa,
      nome: forn.nome,
      kyp_provider_id: ctx.providerId,
      provider_code: ctx.providerCode,
      acao,
      motivo,
      provider_ref_id: result?.providerRefId ?? null,
      provider_response: result ? (result.raw as Record<string, unknown>) : null,
      empresas_afetadas: empresasAfetadas,
      sucesso,
      disparado_por: ctx.disparadoPor,
    });
  };

  try {
    const atual = await ctx.adapter.consultarDiligencia(ctx.session, forn.documento, forn.tipo_pessoa);
    const decisao = decidirAcao(atual);

    if (decisao.acao === "NOOP") {
      await sb.from("kyp_fornecedores").update({
        status_atual: "VALIDO",
        ultima_avaliacao_em: new Date().toISOString(),
        proxima_expiracao_em: atual?.expiryDate ?? null,
        kyp_provider_id: ctx.providerId,
        provider_ref_id: atual?.providerRefId ?? null,
        provider_status: atual?.status ?? null,
      }).eq("id", forn.id);
      await registrar("NOOP", decisao.motivo, true, atual, empresas);
      return "NOOP";
    }

    if (decisao.acao === "CREATE") {
      const criada = await ctx.adapter.criarDiligencia(ctx.session, {
        documento: forn.documento,
        nome: forn.nome ?? forn.documento,
        tipoPessoa: forn.tipo_pessoa,
        empresas,
      });
      await sb.from("kyp_fornecedores").update({
        status_atual: "PENDENTE",
        ultima_avaliacao_em: new Date().toISOString(),
        proxima_expiracao_em: criada.expiryDate,
        kyp_provider_id: ctx.providerId,
        provider_ref_id: criada.providerRefId || null,
        provider_status: criada.status,
      }).eq("id", forn.id);
      await registrar("CREATE", decisao.motivo, true, criada, empresas);
      return "CREATE";
    }

    // DEACTIVATE
    const { empresas: bloqueadas, falhas } = await bloquearNosErps(sb, ocorrencias);
    await sb.from("kyp_fornecedores").update({
      status_atual: "BLOQUEADO",
      ultima_avaliacao_em: new Date().toISOString(),
      proxima_expiracao_em: atual?.expiryDate ?? null,
      kyp_provider_id: ctx.providerId,
      provider_ref_id: atual?.providerRefId ?? null,
      provider_status: atual?.status ?? null,
    }).eq("id", forn.id);
    await registrar(
      "DEACTIVATE",
      falhas.length ? `${decisao.motivo}. Falhas: ${falhas.join(" | ")}` : decisao.motivo,
      falhas.length === 0,
      atual,
      bloqueadas,
    );
    return "DEACTIVATE";
  } catch (e) {
    await sb.from("kyp_fornecedores").update({
      status_atual: "ERRO",
      ultima_avaliacao_em: new Date().toISOString(),
    }).eq("id", forn.id);
    await registrar("ERRO", (e as Error).message, false, null, empresas);
    return "ERRO";
  }
}

/* --------------------------------- handler -------------------------------- */

async function executar(
  sb: Sb,
  opts: { mode: string; documentoAlvo: string; limit: number; disparadoPor: string },
) {
  const { mode, documentoAlvo, limit, disparadoPor } = opts;
  const { data: companiesRaw } = await sb
    .from("companies")
    .select("id, company_db, erp_type, display_name, is_active, is_test");
  const companies = ((companiesRaw ?? []) as unknown as CompanyRow[])
    .filter((c) => c.is_active !== false && !c.is_test && !isTestCompanyDb(c.company_db));

  // Provedor por empresa (default BECOMPLIANCE já garantido no banco)
  const { data: cfgRaw } = await sb
    .from("empresa_kyp_config")
    .select("company_id, kyp_provider_id, ativo, config, kyp_providers(code, ativo)");
  const cfgByCompany = new Map<string, {
    providerId: string;
    code: string;
    extra: Record<string, unknown>;
    ativo: boolean;
  }>();
  for (const row of (cfgRaw ?? []) as Array<Record<string, unknown>>) {
    const prov = row.kyp_providers as { code?: string; ativo?: boolean } | null;
    cfgByCompany.set(String(row.company_id), {
      providerId: String(row.kyp_provider_id),
      code: String(prov?.code ?? "BECOMPLIANCE"),
      extra: (row.config ?? {}) as Record<string, unknown>,
      ativo: row.ativo !== false && prov?.ativo !== false,
    });
  }

  const empresasHabilitadas = companies.filter((c) => cfgByCompany.get(c.id)?.ativo !== false);

  let documentosUnicos = 0;
  const errosColeta: Array<{ company_db: string; error: string }> = [];
  if (mode === "full") {
    const { encontrados, erros } = await coletarFornecedores(sb, empresasHabilitadas);
    errosColeta.push(...erros);
    documentosUnicos = await upsertFornecedores(sb, encontrados, empresasHabilitadas);
  }

  // Fornecedores a avaliar
  let query = sb
    .from("kyp_fornecedores")
    .select("id, documento, tipo_pessoa, nome")
    .order("ultima_avaliacao_em", { ascending: true, nullsFirst: true })
    .limit(mode === "single" ? 1 : limit);
  if (mode === "single") {
    query = query.eq("documento", documentoAlvo);
  } else {
    const agora = new Date().toISOString();
    query = query.or(
      `ultima_avaliacao_em.is.null,proxima_expiracao_em.lt.${agora},status_atual.eq.PENDENTE,status_atual.eq.ERRO`,
    );
  }
  const { data: fornRaw, error: fornErr } = await query;
  if (fornErr) throw fornErr;
  const fornecedores = (fornRaw ?? []) as unknown as FornecedorRow[];

  // Sessão do provedor (credenciais únicas do backend)
  const primeiro = cfgByCompany.values().next().value;
  const providerCode = primeiro?.code ?? "BECOMPLIANCE";
  const providerId = primeiro?.providerId ?? "";
  const adapter = KYP_ADAPTERS[providerCode];
  if (!adapter) throw new Error(`Provedor KYP não suportado: ${providerCode}`);
  const config = await providerConfig(sb, providerCode, primeiro?.extra ?? {}, primeiro?.companyDb ?? null);
  if (!config) throw new Error("Credenciais do provedor KYP não configuradas.");
  const session = await adapter.authenticate(config);

  const resumo: Record<string, number> = { NOOP: 0, CREATE: 0, DEACTIVATE: 0, ERRO: 0 };
  for (const forn of fornecedores) {
    const acao = await avaliarFornecedor(sb, forn, {
      adapter,
      session,
      providerId,
      providerCode,
      disparadoPor,
    });
    resumo[acao] = (resumo[acao] ?? 0) + 1;
  }

  return {
    mode,
    empresas: empresasHabilitadas.length,
    documentos_unicos: documentosUnicos,
    avaliados: fornecedores.length,
    resumo,
    erros_coleta: errosColeta,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const sb = service();
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const mode = String(body.mode ?? "full");
  const documentoAlvo = typeof body.documento === "string" ? body.documento.replace(/\D+/g, "") : "";
  const limit = Number(body.limit ?? 150);
  const lockName = "kyp-orchestrator";

  // Modo single: reprocessa um documento e responde de forma síncrona.
  if (mode === "single") {
    if (!documentoAlvo) return json({ error: "documento obrigatório no modo single" }, 400);
    try {
      const result = await executar(sb, { mode, documentoAlvo, limit: 1, disparadoPor: "manual" });
      return json({ ok: true, ...result });
    } catch (e) {
      console.error("[kyp-orchestrator][single]", e);
      return json({ error: (e as Error).message }, 500);
    }
  }

  // Modo full: varredura longa — roda em segundo plano com lock de execução.
  if (!(await tryWatcherLock(sb, lockName, 55))) {
    return json({ ok: true, skipped: "already_running" });
  }

  const job = (async () => {
    try {
      const result = await executar(sb, { mode: "full", documentoAlvo: "", limit, disparadoPor: "cron" });
      console.log("[kyp-orchestrator] concluído", JSON.stringify(result));
      await releaseWatcherLock(sb, lockName, "ok");
    } catch (e) {
      console.error("[kyp-orchestrator]", e);
      await releaseWatcherLock(sb, lockName, "error", (e as Error).message);
    }
  })();

  const runtime = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(job);
  else await job;

  return json({ ok: true, mode: "full", started: true }, 202);
});

