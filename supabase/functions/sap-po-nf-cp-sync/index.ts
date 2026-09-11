// Edge function: sap-po-nf-cp-sync
// Sincroniza a view HANA VW_FLUXO_CONTAS_PAGAR_AVANCADO em public.sap_po_nf_cp_cache.
// A view liga Pedido de Compra <-> NF de Entrada <-> Contas a Pagar por empresa.

import { fetchHanaView, resolveHanaSchema } from "../_shared/hana-views.ts";
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

const VIEW_NAME = "VW_FLUXO_CONTAS_PAGAR_AVANCADO";

function pick(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return undefined;
}

function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/\s/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Converte datas da view HANA ("2026-04-29 00:00:00.000") em ISO. */
function toDate(v: unknown): string | null {
  const s = toStr(v);
  if (!s) return null;
  const iso = s.includes("T") ? s : s.replace(" ", "T");
  const d = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function mapRow(raw: Record<string, unknown>, companyDb: string) {
  const idPedido = toStr(pick(raw, "ID_Pedido_Compra", "ID Pedido Compra", "idPedidoCompra"));
  const idNf = toStr(pick(raw, "ID_NF_Entrada", "ID NF Entrada", "idNfEntrada"));
  const numeroNf = toStr(pick(raw, "Numero_Nota_Fiscal", "Número Nota Fiscal", "Numero Nota Fiscal"));
  const idCp = toStr(pick(raw, "ID_Contas_Pagar", "ID Contas Pagar", "idContasPagar"));
  const codFornecedor = toStr(pick(raw, "Cod_Fornecedor", "Cod Fornecedor", "CardCode"));
  const nomeFornecedor = toStr(pick(raw, "Nome_Fornecedor", "Nome Fornecedor", "CardName"));
  const valor = toNum(pick(raw, "Valor", "valor"));
  const referencia = toStr(pick(raw, "Referencia_do_Valor", "Referência do Valor", "Referencia do Valor"));
  const status = toStr(pick(raw, "Status_Geral", "Status Geral", "status"));

  if (!idPedido && !idNf && !idCp) return null;

  const link_key = [idPedido ?? "-", idNf ?? "-", idCp ?? "-", numeroNf ?? "-", referencia ?? "-"].join("|");

  return {
    company_db: companyDb,
    link_key,
    id_pedido_compra: idPedido,
    id_nf_entrada: idNf,
    numero_nota_fiscal: numeroNf,
    id_contas_pagar: idCp,
    cod_fornecedor: codFornecedor,
    nome_fornecedor: nomeFornecedor,
    valor,
    referencia_valor: referencia,
    status_geral: status,
    raw_json: raw as unknown as Record<string, unknown>,
    synced_at: new Date().toISOString(),
  };
}

async function syncCompany(sb: Sb, companyDb: string, _opts: RunnerOpts): Promise<WatcherResult> {
  const creds = await loadSapCreds(sb, companyDb, { requireApiuser: true, requireHana: true });
  if (!creds) return { companyDb, synced: 0, skipped: "no_credentials_or_not_apiuser" };

  const baseUrl = buildSapBaseUrl(creds.service_layer_url);
  const dbName = creds.company_db || companyDb;
  const schema = resolveHanaSchema(companyDb, dbName);

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
      view: VIEW_NAME,
      sessionId: session.sessionId,
      hanaApiUrl: creds.hana_api_url,
      timeoutMs: 60_000,
    });

    const seen = new Map<string, NonNullable<ReturnType<typeof mapRow>>>();
    for (const r of rawRows) {
      const row = mapRow(r, companyDb);
      if (!row) continue;
      seen.set(`${row.company_db}::${row.link_key}`, row);
    }
    const rows = Array.from(seen.values());

    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const { error } = await sb
        .from("sap_po_nf_cp_cache")
        .upsert(slice, { onConflict: "company_db,link_key" });
      if (error) { lastError = `upsert: ${error.message}`; break; }
      synced += slice.length;
    }
  } catch (e) {
    lastError = (e as Error).message;
  } finally {
    await sapLogoutSession(baseUrl, session);
  }

  const { data: prev } = await sb
    .from("sap_po_nf_cp_sync_state")
    .select("total_synced")
    .eq("company_db", companyDb)
    .maybeSingle();
  const totalPrev = Number((prev as { total_synced?: number } | null)?.total_synced ?? 0);

  await sb.from("sap_po_nf_cp_sync_state").upsert({
    company_db: companyDb,
    last_run_at: new Date().toISOString(),
    last_status: lastError ? "error" : "ok",
    last_error: lastError,
    last_batch_count: synced,
    total_synced: totalPrev + synced,
    updated_at: new Date().toISOString(),
  }, { onConflict: "company_db" });

  return { companyDb, synced, error: lastError ?? undefined };
}

Deno.serve((req) => runSapCacheWatcher(req, {
  watcherName: "sap-po-nf-cp-sync",
  supportBackfill: false,
  syncCompany,
}));
