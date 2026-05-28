import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

/**
 * approval-history-sync
 * --------------------------------------------------------------
 * Sincroniza o histórico de aprovações direto do SAP B1 Service Layer
 * (endpoint /ApprovalRequests) para a tabela local public.approval_history.
 *
 * Cada decisão (linha de ApprovalRequestDecisions) vira uma linha em
 * approval_history, identificada de forma única por (company_db, external_id).
 *
 * Roda para todas as empresas ativas que possuem credenciais SAP
 * configuradas em system_credentials, ou para uma empresa específica
 * quando o body informa { companyDb }.
 */

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const OBJECT_CODE_TO_NAME: Record<string, string> = {
  "13": "Nota Fiscal de Saída",
  "15": "Entrega",
  "17": "Pedido de Venda",
  "18": "Nota Fiscal de Entrada",
  "19": "Nota de Crédito de Entrada",
  "20": "Recebimento de Mercadorias",
  "22": "Pedido de Compra",
  "23": "Cotação de Venda",
  "112": "Solicitação de Pagamento",
  "1470000113": "Solicitação de Compra",
  "540000006": "Pagamento Efetuado",
};

const DECISION_STATUS_MAP: Record<string, string> = {
  // ApprovalRequestLines (linhas de decisão por aprovador)
  ardApproved: "Y",
  ardRejected: "N",
  ardPending: "P",
  ardNoDecision: "P",
  // Alguns ambientes usam a nomenclatura legada
  asaApproved: "Y",
  asaRejected: "N",
  asaPending: "P",
  asaNoDecision: "P",
};

interface SapCreds {
  service_layer_url: string;
  company_db: string;
  username: string;
  password: string;
}

function normalizeSlUrl(url: string): string {
  let u = url.replace(/\/+$/, "");
  if (u.includes("/b1s/v1")) u = u.replace("/b1s/v1", "/b1s/v2");
  else if (!u.includes("/b1s/v2")) u = `${u}/b1s/v2`;
  return u;
}

async function loadCompanyCreds(
  supabase: ReturnType<typeof createClient>,
  companyDb: string,
): Promise<SapCreds | null> {
  const { data, error } = await supabase
    .from("system_credentials")
    .select("credential_key,credential_value")
    .eq("company_db", companyDb)
    .eq("system_name", "sap");
  if (error) throw new Error(error.message);
  const map = new Map((data || []).map((r: any) => [r.credential_key, r.credential_value as string]));
  const service_layer_url = map.get("service_layer_url");
  const username = map.get("username");
  const password = map.get("password");
  const company_db = map.get("company_db") || companyDb;
  if (!service_layer_url || !username || !password) return null;
  return {
    service_layer_url: normalizeSlUrl(service_layer_url),
    company_db,
    username,
    password,
  };
}

async function sapLogin(creds: SapCreds): Promise<{ sessionId: string; routeId: string }> {
  const res = await fetch(`${creds.service_layer_url}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      UserName: creds.username,
      Password: creds.password,
      CompanyDB: creds.company_db,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SAP Login falhou (${res.status}): ${text.slice(0, 300)}`);
  }
  const setCookie = res.headers.get("set-cookie") || "";
  const sessionMatch = setCookie.match(/B1SESSION=([^;]+)/);
  const routeMatch = setCookie.match(/ROUTEID=([^;]+)/);
  const body = await res.json().catch(() => ({} as any));
  return {
    sessionId: sessionMatch?.[1] || body.SessionId || "",
    routeId: routeMatch?.[1] || "",
  };
}

function buildCookie(sessionId: string, routeId: string) {
  const parts = [`B1SESSION=${sessionId}`];
  if (routeId) parts.push(`ROUTEID=${routeId}`);
  return parts.join("; ");
}

async function fetchApprovalRequests(
  creds: SapCreds,
  sessionId: string,
  routeId: string,
): Promise<any[]> {
  const all: any[] = [];
  let url: string | null =
    `${creds.service_layer_url}/ApprovalRequests?$orderby=Code desc&$top=100`;
  let safety = 1; // limita a 100 registros mais recentes por sync (performance)
  while (url && safety-- > 0) {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Cookie: buildCookie(sessionId, routeId),
        Accept: "application/json",
        Prefer: "odata.maxpagesize=200",
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GET /ApprovalRequests falhou (${res.status}): ${text.slice(0, 300)}`);
    }
    const body: any = await res.json();
    const items: any[] = Array.isArray(body?.value) ? body.value : [];
    all.push(...items);
    url = body?.["@odata.nextLink"]
      ? `${creds.service_layer_url}/${body["@odata.nextLink"]}`
      : null;
  }
  return all;
}

/**
 * Cache leve de Users por sessão para resolver UserID -> UserCode/UserName/E-mail.
 */
async function loadUsersIndex(
  creds: SapCreds,
  sessionId: string,
  routeId: string,
): Promise<Map<number, { code: string; name: string; email: string | null }>> {
  const idx = new Map<number, { code: string; name: string; email: string | null }>();
  try {
    let url: string | null =
      `${creds.service_layer_url}/Users?$select=InternalKey,UserCode,UserName,eMail&$top=1000`;
    let safety = 30;
    while (url && safety-- > 0) {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Cookie: buildCookie(sessionId, routeId),
          Accept: "application/json",
          Prefer: "odata.maxpagesize=1000",
        },
      });
      if (!res.ok) break;
      const body: any = await res.json();
      for (const u of body?.value || []) {
        const id = Number(u.InternalKey);
        if (!Number.isFinite(id)) continue;
        idx.set(id, {
          code: String(u.UserCode || ""),
          name: String(u.UserName || u.UserCode || ""),
          email: u.eMail ? String(u.eMail) : null,
        });
      }
      url = body?.["@odata.nextLink"]
        ? `${creds.service_layer_url}/${body["@odata.nextLink"]}`
        : null;
    }
  } catch (e) {
    console.warn("loadUsersIndex falhou:", e instanceof Error ? e.message : e);
  }
  return idx;
}

async function fetchUsersByIds(
  creds: SapCreds,
  sessionId: string,
  routeId: string,
  ids: number[],
  idx: Map<number, { code: string; name: string; email: string | null }>,
): Promise<void> {
  const missing = Array.from(new Set(ids.filter((id) => Number.isFinite(id) && id > 0 && !idx.has(id))));
  if (missing.length === 0) return;
  const batchSize = 25;
  for (let i = 0; i < missing.length; i += batchSize) {
    const batch = missing.slice(i, i + batchSize);
    const filter = batch.map((id) => `InternalKey eq ${id}`).join(" or ");
    const url = `${creds.service_layer_url}/Users?$select=InternalKey,UserCode,UserName,eMail&$filter=${encodeURIComponent(filter)}&$top=${batchSize}`;
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Cookie: buildCookie(sessionId, routeId), Accept: "application/json" },
      });
      if (!res.ok) {
        console.warn("fetchUsersByIds falhou:", res.status, (await res.text()).slice(0, 200));
        continue;
      }
      const body: any = await res.json();
      for (const u of body?.value || []) {
        const id = Number(u.InternalKey);
        if (!Number.isFinite(id)) continue;
        idx.set(id, {
          code: String(u.UserCode || ""),
          name: String(u.UserName || u.UserCode || ""),
          email: u.eMail ? String(u.eMail) : null,
        });
      }
    } catch (e) {
      console.warn("fetchUsersByIds erro:", e instanceof Error ? e.message : e);
    }
  }
}

type DraftInfo = {
  doc_num: number | null;
  doc_total: number | null;
  currency: string | null;
  card_code: string | null;
  card_name: string | null;
  doc_date: string | null;
};

const OBJECT_TYPE_TO_COLLECTION: Record<string, string> = {
  "13": "Invoices",
  "15": "DeliveryNotes",
  "17": "Orders",
  "18": "PurchaseInvoices",
  "19": "PurchaseCreditNotes",
  "20": "PurchaseDeliveryNotes",
  "22": "PurchaseOrders",
  "23": "Quotations",
  "112": "VendorPayments",
  "1470000113": "PurchaseRequests",
};

async function fetchDocsBulk(
  creds: SapCreds,
  sessionId: string,
  routeId: string,
  collection: string,
  docEntries: number[],
): Promise<Map<number, DraftInfo>> {
  const out = new Map<number, DraftInfo>();
  if (docEntries.length === 0) return out;
  const batchSize = 20;
  for (let i = 0; i < docEntries.length; i += batchSize) {
    const batch = docEntries.slice(i, i + batchSize);
    const filter = batch.map((e) => `DocEntry eq ${e}`).join(" or ");
    let url: string | null =
      `${creds.service_layer_url}/${collection}` +
      `?$filter=${encodeURIComponent(filter)}&$top=${batchSize}`;
    let safety = 5;
    while (url && safety-- > 0) {
      try {
        const res = await fetch(url, {
          method: "GET",
          headers: {
            Cookie: buildCookie(sessionId, routeId),
            Accept: "application/json",
            Prefer: "odata.maxpagesize=100",
          },
        });
        if (!res.ok) {
          console.warn(`fetchDocsBulk ${collection} falhou:`, res.status, (await res.text()).slice(0, 200));
          break;
        }
        const body: any = await res.json();
        for (const d of body?.value || []) {
          const entry = Number(d?.DocEntry);
          if (!Number.isFinite(entry)) continue;
          out.set(entry, {
            doc_num: Number.isFinite(Number(d?.DocNum)) ? Number(d.DocNum) : null,
            doc_total: Number.isFinite(Number(d?.DocTotal)) ? Number(d.DocTotal) : null,
            currency: d?.DocCurrency || null,
            card_code: d?.CardCode || null,
            card_name: d?.CardName || null,
            doc_date: d?.DocDate || null,
          });
        }
        url = body?.["@odata.nextLink"]
          ? `${creds.service_layer_url}/${body["@odata.nextLink"]}`
          : null;
      } catch (e) {
        console.warn(`fetchDocsBulk ${collection} erro:`, e instanceof Error ? e.message : e);
        break;
      }
    }
  }
  return out;
}

function combineDateTime(date: unknown, time: unknown): string | null {
  if (!date) return null;
  try {
    const baseDate = new Date(String(date));
    if (!Number.isFinite(baseDate.getTime())) return null;
    if (time && typeof time === "string" && /^\d{1,2}:\d{2}/.test(time)) {
      const [h, m] = time.split(":").map((v) => parseInt(v, 10));
      baseDate.setUTCHours(h || 0, m || 0, 0, 0);
    }
    return baseDate.toISOString();
  } catch {
    return null;
  }
}

function buildRowsFromRequest(
  req: any,
  company_db: string,
  users: Map<number, { code: string; name: string; email: string | null }>,
  draftInfo: DraftInfo | null,
) {
  const lines: any[] = Array.isArray(req?.ApprovalRequestLines)
    ? req.ApprovalRequestLines
    : Array.isArray(req?.ApprovalRequestDecisions)
      ? req.ApprovalRequestDecisions
      : [];
  const objectType = String(req?.ObjectType || req?.DraftType || "");
  const requester = users.get(Number(req?.OriginatorID));
  const baseExternal = `${req?.Code ?? req?.DraftEntry ?? ""}`;
  const docEntry = Number.isFinite(Number(req?.ObjectEntry))
    ? Number(req.ObjectEntry)
    : Number.isFinite(Number(req?.DraftEntry))
      ? Number(req.DraftEntry)
      : null;

  const items = lines.length > 0 ? lines : [null];

  return items.map((d: any, idx: number) => {
    const approver = d ? users.get(Number(d.UserID)) : undefined;
    const stepRaw = d?.StageCode ?? d?.Step ?? d?.StageID ?? idx + 1;
    const step = Number.isFinite(Number(stepRaw)) ? Number(stepRaw) : idx + 1;
    const decisionStatus = d
      ? DECISION_STATUS_MAP[String(d.Status)] || String(d.Status || "P")
      : DECISION_STATUS_MAP[String(req?.Status)] || "P";
    const decisionDate =
      combineDateTime(d?.UpdateDate, d?.UpdateTime) ||
      combineDateTime(d?.CreationDate, d?.CreationTime) ||
      combineDateTime(req?.CreationDate, req?.CreationTime);

    return {
      external_id: `${baseExternal}-${step}-${d?.UserID ?? "x"}`,
      company_db,
      decision: decisionStatus,
      decision_date: decisionDate,
      approver_code: approver?.code || (d?.UserID ? String(d.UserID) : null),
      approver_name: approver?.name || null,
      approver_email: approver?.email || null,
      requester_code: requester?.code || (req?.OriginatorID ? String(req.OriginatorID) : null),
      requester_name: requester?.name || null,
      doc_object_type: objectType || null,
      doc_type_name: OBJECT_CODE_TO_NAME[objectType] || (objectType ? `Documento (${objectType})` : null),
      doc_entry: docEntry,
      doc_num: draftInfo?.doc_num ?? null,
      doc_total: draftInfo?.doc_total ?? null,
      currency: draftInfo?.currency ?? null,
      card_code: draftInfo?.card_code ?? null,
      card_name: draftInfo?.card_name ?? null,
      remarks: req?.Remarks || d?.Remarks || null,
      stage_name: stepRaw ? `Estágio ${step}` : null,
      step,
      raw: { request: req, decision: d, draft: draftInfo },
    };
  });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function syncCompany(
  supabase: ReturnType<typeof createClient>,
  companyDb: string,
): Promise<{ companyDb: string; received: number; upserted: number; error?: string }> {
  try {
    const creds = await loadCompanyCreds(supabase, companyDb);
    if (!creds) {
      return { companyDb, received: 0, upserted: 0, error: "Credenciais SAP não configuradas" };
    }
    const { sessionId, routeId } = await sapLogin(creds);
    const [users, requests] = await Promise.all([
      loadUsersIndex(creds, sessionId, routeId),
      fetchApprovalRequests(creds, sessionId, routeId),
    ]);

    // Enriquecimento: agrupa cada solicitação por coleção SL (PurchaseOrders,
    // PurchaseRequests, Drafts, etc.) com base no ObjectType, e faz UMA consulta
    // em lote por coleção para trazer DocNum, DocTotal, CardCode/Name e moeda.
    type DocKey = { collection: string; entry: number };
    const docKeyByRequestCode = new Map<string | number, DocKey>();
    const entriesByCollection = new Map<string, Set<number>>();

    for (const r of requests) {
      const objectType = String(r?.ObjectType || "");
      const objectEntry = Number(r?.ObjectEntry);
      const draftEntry = Number(r?.DraftEntry);
      const hasObjectEntry = Number.isFinite(objectEntry) && objectEntry > 0;
      const collection = hasObjectEntry
        ? OBJECT_TYPE_TO_COLLECTION[objectType] || "Drafts"
        : "Drafts";
      const entry = hasObjectEntry ? objectEntry : draftEntry;
      if (!Number.isFinite(entry) || entry <= 0) continue;
      docKeyByRequestCode.set(r?.Code, { collection, entry });
      if (!entriesByCollection.has(collection)) entriesByCollection.set(collection, new Set());
      entriesByCollection.get(collection)!.add(entry);
    }

    const docInfoByKey = new Map<string, DraftInfo>();
    for (const [collection, set] of entriesByCollection.entries()) {
      const infoMap = await fetchDocsBulk(creds, sessionId, routeId, collection, Array.from(set));
      for (const [entry, info] of infoMap.entries()) {
        docInfoByKey.set(`${collection}:${entry}`, info);
      }
    }

    // Busca sob demanda os usuários (originador/aprovador) ausentes do cache inicial
    const neededUserIds: number[] = [];
    for (const r of requests) {
      const oid = Number(r?.OriginatorID);
      if (Number.isFinite(oid)) neededUserIds.push(oid);
      const lines = Array.isArray(r?.ApprovalRequestLines) ? r.ApprovalRequestLines : [];
      for (const l of lines) {
        const uid = Number(l?.UserID);
        if (Number.isFinite(uid)) neededUserIds.push(uid);
      }
    }
    await fetchUsersByIds(creds, sessionId, routeId, neededUserIds, users);

    const rows = requests.flatMap((r) => {
      const key = docKeyByRequestCode.get(r?.Code);
      const info = key ? docInfoByKey.get(`${key.collection}:${key.entry}`) ?? null : null;
      return buildRowsFromRequest(r, companyDb, users, info);
    });

    let upserted = 0;
    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await supabase
        .from("approval_history")
        .upsert(chunk, { onConflict: "company_db,external_id" });
      if (error) throw new Error(error.message);
      upserted += chunk.length;
    }
    return { companyDb, received: requests.length, upserted };
  } catch (e) {
    return {
      companyDb,
      received: 0,
      upserted: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    let bodyIn: any = {};
    try { bodyIn = await req.json(); } catch { /* sem body */ }
    const url = new URL(req.url);
    const targetCompany = bodyIn?.companyDb || url.searchParams.get("companyDb") || null;

    let companies: string[];
    if (targetCompany) {
      companies = [targetCompany];
    } else {
      const { data, error } = await supabase
        .from("companies")
        .select("company_db,is_active,erp_type")
        .eq("is_active", true)
        .eq("erp_type", "sap");
      if (error) throw new Error(error.message);
      companies = (data || []).map((c: any) => c.company_db);
    }

    const perCompany: Awaited<ReturnType<typeof syncCompany>>[] = [];
    let received = 0;
    let upserted = 0;
    const errors: string[] = [];
    for (const db of companies) {
      const r = await syncCompany(supabase, db);
      perCompany.push(r);
      received += r.received;
      upserted += r.upserted;
      if (r.error) errors.push(`${db}: ${r.error}`);
    }

    const message = errors.length
      ? `Importados ${upserted} registros (${received} recebidos). ${errors.length} empresa(s) com erro: ${errors.join(" | ").slice(0, 500)}`
      : `Importados ${upserted} registros (${received} recebidos) de ${companies.length} empresa(s).`;

    await supabase.from("approval_history_sync_state").upsert({
      id: 1,
      last_sync_at: new Date().toISOString(),
      last_status: errors.length && upserted === 0 ? "error" : (errors.length ? "partial" : "success"),
      last_message: message,
      last_count: upserted,
      updated_at: new Date().toISOString(),
    });

    return jsonResponse({
      success: errors.length === 0 || upserted > 0,
      received,
      upserted,
      companies: companies.length,
      perCompany,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase.from("approval_history_sync_state").upsert({
      id: 1,
      last_sync_at: new Date().toISOString(),
      last_status: "error",
      last_message: msg,
      updated_at: new Date().toISOString(),
    });
    console.error("approval-history-sync error:", msg);
    return jsonResponse({ success: false, error: msg }, 500);
  }
});
