// Edge function: sap-fluxo-analise-sync
// Sincroniza a view HANA VW_FIN_ANALISE_FLUXO em public.sap_fluxo_analise_cache
// para cada empresa SAP com credenciais Apiuser configuradas.

import { fetchHanaView } from "../_shared/hana-views.ts";
import {
  buildSapBaseUrl,
  loadSapCreds,
  runSapCacheWatcher,
  sapLogoutSession,
  sapSessionLogin,
  type RunnerOpts,
  type Sb,
  type WatcherResult,
} from "../_shared/sap-cache.ts";

const HANA_SCHEMA_OVERRIDES: Record<string, string> = { open_gaming_sa: "SBO_OPENGAMING" };

function pick(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function toIso(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  const n2 = Number(v);
  return Number.isFinite(n2) ? n2 : null;
}

function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
}

function mapRow(raw: Record<string, unknown>, companyDb: string) {
  const dataAtualizacao = toIso(pick(raw, "Data Atualização Esboço", "Data_Atualizacao_Esboco", "dataAtualizacaoEsboco"));
  const solicitante = toStr(pick(raw, "Solicitante", "solicitante"));
  const departamento = toStr(pick(raw, "Departamento", "departamento"));
  const centroCusto = toStr(pick(raw, "Centro de Custo", "Centro_de_Custo", "centroCusto"));
  const marca = toStr(pick(raw, "Marca/Brand", "Marca", "marca", "Brand"));
  const descricao = toStr(pick(raw, "Descrição", "Descricao", "descricao"));
  const aprovador = toStr(pick(raw, "Aprovador", "aprovador"));
  const dataAprovacao = toIso(pick(raw, "Data Aprovação", "Data_Aprovacao", "dataAprovacao"));
  const fornecedor = toStr(pick(raw, "Fornecedor", "fornecedor"));
  const valor = toNum(pick(raw, "Valor", "valor"));
  const dataVencimento = toIso(pick(raw, "Data Vencimento", "Data_Vencimento", "dataVencimento"));
  const dataLancamento = toIso(pick(raw, "Data Lançamento", "Data_Lancamento", "dataLancamento"));
  const dataPagamento = toIso(pick(raw, "Data Pagamento", "Data_Pagamento", "dataPagamento"));
  const idEsboco = toStr(pick(raw, "ID Esboço", "ID_Esboco", "idEsboco"));
  const idPedido = toStr(pick(raw, "ID Pedido", "ID_Pedido", "idPedido"));
  const idNf = toStr(pick(raw, "ID NF", "ID_NF", "idNf"));
  const idCp = toStr(pick(raw, "ID CP", "ID_CP", "idCp"));

  const flowKey =
    (idEsboco && `E:${idEsboco}`) ||
    (idPedido && `P:${idPedido}`) ||
    (idNf && `N:${idNf}`) ||
    (idCp && `C:${idCp}`) ||
    null;
  if (!flowKey) return null;

  return {
    company_db: companyDb,
    flow_key: flowKey,
    data_atualizacao_esboco: dataAtualizacao,
    solicitante,
    departamento,
    centro_custo: centroCusto,
    marca,
    descricao,
    aprovador,
    data_aprovacao: dataAprovacao,
    fornecedor,
    valor,
    data_vencimento: dataVencimento,
    data_lancamento: dataLancamento,
    data_pagamento: dataPagamento,
    id_esboco: idEsboco,
    id_pedido: idPedido,
    id_nf: idNf,
    id_cp: idCp,
    raw_json: raw as unknown as Record<string, unknown>,
    synced_at: new Date().toISOString(),
  };
}

async function syncCompany(sb: Sb, companyDb: string, _opts: RunnerOpts): Promise<WatcherResult> {
  const creds = await loadSapCreds(sb, companyDb, { requireApiuser: true, requireHana: true });
  if (!creds) return { companyDb, synced: 0, skipped: "no_credentials_or_not_apiuser" };

  const baseUrl = buildSapBaseUrl(creds.service_layer_url);
  const dbName = creds.company_db || companyDb;
  const schema = HANA_SCHEMA_OVERRIDES[companyDb] || dbName;

  let session: { sessionId: string; routeId: string };
  try {
    session = await sapSessionLogin(baseUrl, dbName, creds.username, creds.password);
  } catch (e) {
    return { companyDb, synced: 0, error: (e as Error).message };
  }

  let synced = 0;
  let lastError: string | null = null;
  try {
    const rawRows = await fetchHanaView({
      schema,
      view: "VW_FIN_ANALISE_FLUXO",
      sessionId: session.sessionId,
      hanaApiUrl: creds.hana_api_url,
      useV2: creds.use_hana_v2 === "true" || creds.hana_api_v2 === "true",
    });
    const seen = new Map<string, ReturnType<typeof mapRow>>();
    for (const r of rawRows) {
      const row = mapRow(r, companyDb);
      if (!row) continue;
      seen.set(`${row.company_db}::${row.flow_key}`, row);
    }
    const rows = Array.from(seen.values()).filter((r): r is NonNullable<typeof r> => !!r);

    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const { error } = await sb
        .from("sap_fluxo_analise_cache")
        .upsert(slice, { onConflict: "company_db,flow_key" });
      if (error) { lastError = `upsert: ${error.message}`; break; }
      synced += slice.length;
    }
  } catch (e) {
    lastError = (e as Error).message;
  } finally {
    await sapLogoutSession(baseUrl, session);
  }

  const { data: prev } = await sb
    .from("sap_fluxo_analise_sync_state")
    .select("total_synced")
    .eq("company_db", companyDb)
    .maybeSingle();
  const totalPrev = Number((prev as { total_synced?: number } | null)?.total_synced ?? 0);

  await sb.from("sap_fluxo_analise_sync_state").upsert({
    company_db: companyDb,
    last_run_at: new Date().toISOString(),
    last_status: lastError ? "error" : "ok",
    last_error: lastError,
    last_batch_count: synced,
    total_synced: totalPrev + synced,
  }, { onConflict: "company_db" });

  return { companyDb, synced, error: lastError ?? undefined };
}

Deno.serve((req) => runSapCacheWatcher(req, {
  watcherName: "sap-fluxo-analise-sync",
  supportBackfill: false,
  syncCompany,
}));
