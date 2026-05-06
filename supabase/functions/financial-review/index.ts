// Financial Review module — surfaces unmatched advance payments / down payments
// in SAP B1 (AR + AP) and exposes actions to link them to invoices, perform
// internal reconciliation, or cancel the payment.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface SapCreds {
  baseUrl: string;
  companyDB: string;
  userName: string;
  password: string;
}

async function loadSapCreds(
  sb: ReturnType<typeof createClient>,
  companyDb: string,
): Promise<SapCreds | null> {
  const { data } = await sb
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "sap")
    .eq("company_db", companyDb);
  if (!data || data.length === 0) return null;
  const map: Record<string, string> = {};
  for (const r of data as { credential_key: string; credential_value: string }[]) {
    map[r.credential_key] = r.credential_value;
  }
  let baseUrl = (map.service_layer_url || map.base_url || map.url || "").replace(/\/+$/, "");
  if (!baseUrl) return null;
  if (baseUrl.includes("/b1s/v1")) baseUrl = baseUrl.replace("/b1s/v1", "/b1s/v2");
  else if (!baseUrl.includes("/b1s/v2")) baseUrl = `${baseUrl}/b1s/v2`;
  const sapCompanyDB = map.company_db || map.CompanyDB || companyDb;
  const userName = map.username || map.UserName;
  const password = map.password || map.Password;
  if (!userName || !password) return null;
  return { baseUrl, companyDB: sapCompanyDB, userName, password };
}

async function sapLogin(creds: SapCreds): Promise<string> {
  const resp = await fetch(`${creds.baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      CompanyDB: creds.companyDB,
      UserName: creds.userName,
      Password: creds.password,
    }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`SAP Login HTTP ${resp.status}: ${t.slice(0, 200)}`);
  }
  return resp.headers.get("set-cookie") || "";
}

async function sapGetAll(
  baseUrl: string,
  cookies: string,
  endpoint: string,
  params: Record<string, string>,
  maxItems = 5000,
): Promise<any[]> {
  const all: any[] = [];
  const pageSize = 100;
  let url: string | null = (() => {
    const qp = new URLSearchParams(params);
    qp.set("$top", String(pageSize));
    qp.set("$skip", "0");
    return `${baseUrl}/${endpoint}?${qp.toString()}`;
  })();
  let pageCount = 0;
  while (url) {
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookies,
        Prefer: "odata.maxpagesize=" + pageSize,
      },
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`SAP ${endpoint} HTTP ${resp.status}: ${t.slice(0, 300)}`);
    }
    const body: any = await resp.json();
    const items: any[] = body.value || [];
    all.push(...items);
    pageCount++;
    const nextLink: string | undefined = body["odata.nextLink"] || body["@odata.nextLink"];
    if (nextLink) {
      url = nextLink.startsWith("http") ? nextLink : `${baseUrl}/${nextLink}`;
    } else if (items.length >= pageSize) {
      const qp = new URLSearchParams(params);
      qp.set("$top", String(pageSize));
      qp.set("$skip", String(pageCount * pageSize));
      url = `${baseUrl}/${endpoint}?${qp.toString()}`;
    } else {
      url = null;
    }
    if (all.length > maxItems) break;
  }
  return all;
}

async function sapPost(
  baseUrl: string,
  cookies: string,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  const resp = await fetch(`${baseUrl}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookies },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = (data as any)?.error?.message?.value || `HTTP ${resp.status}`;
    return { ok: false, error: msg };
  }
  return { ok: true, data };
}

async function sapCancel(
  baseUrl: string,
  cookies: string,
  endpoint: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // SAP B1 Service Layer cancellation
  const resp = await fetch(`${baseUrl}/${endpoint}/Cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookies },
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    const msg = (data as any)?.error?.message?.value || `HTTP ${resp.status}`;
    return { ok: false, error: msg };
  }
  return { ok: true };
}

async function withSession<T>(
  creds: SapCreds,
  fn: (cookies: string) => Promise<T>,
): Promise<T> {
  const cookies = await sapLogin(creds);
  try {
    return await fn(cookies);
  } finally {
    fetch(`${creds.baseUrl}/Logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookies },
    }).catch(() => {});
  }
}

interface AdvanceItem {
  doc_type: "ADVANCE_AP" | "ADVANCE_AR" | "PAYMENT_OA_OUT" | "PAYMENT_OA_IN";
  doc_entry: number;
  doc_num: number | null;
  card_code: string;
  card_name: string;
  bp_type: "supplier" | "customer";
  doc_date: string | null;
  doc_total: number;
  paid_to_date: number;
  open_amount: number;
  doc_currency: string;
  remarks: string | null;
  reference: string | null;
}

async function listAdvances(creds: SapCreds, cookies: string): Promise<AdvanceItem[]> {
  const items: AdvanceItem[] = [];

  // Estratégia: o SAP B1 Service Layer NÃO expõe o campo OVPM/ORCT.OpenBal
  // diretamente. Para identificar adiantamentos com saldo disponível e não
  // cancelados, fazemos:
  //
  //   1) Buscar pagamentos não cancelados (Cancelled eq 'tNO') direto dos
  //      endpoints equivalentes a OVPM/ORCT. Não filtramos por DocType no OData
  //      porque instalações SAP podem expor enums diferentes do valor esperado.
  //   2) Calcular o saldo somando os meios de pagamento do header
  //      (CashSum + TransferSum + CheckAccountSum + CreditSum + BoeSum)
  //      e subtraindo o que já foi aplicado em invoices/down payments
  //      (somatório de PaymentInvoices[].SumApplied + PaymentAccounts[]).
  //
  // Para adiantamento puro (sem invoices vinculadas) o saldo disponível é
  // o próprio DocTotal. Para pagamentos parcialmente aplicados, subtraímos
  // o que já foi consumido em PaymentInvoices.

  function calcOpen(d: any): { docTotal: number; applied: number; open: number } {
    const docTotal = Number(d.DocTotal ?? 0);
    const invoices: any[] = Array.isArray(d.PaymentInvoices) ? d.PaymentInvoices : [];
    const applied = invoices.reduce(
      (sum, pi) => sum + Number(pi.SumApplied ?? pi.AppliedFC ?? pi.AppliedSys ?? 0),
      0,
    );
    const open = Math.max(0, docTotal - applied);
    return { docTotal, applied, open };
  }

  // 1) Adiantamentos / pagamentos a fornecedores em aberto (OVPM)
  try {
    const op = await sapGetAll(creds.baseUrl, cookies, "VendorPayments", {
      $select:
        "DocEntry,DocNum,CardCode,CardName,DocDate,DocTotal,DocCurrency,JournalRemarks,Reference1,DocType,Cancelled,PaymentInvoices",
      $filter: "Cancelled eq 'tNO'",
    });
    for (const d of op) {
      const { docTotal, applied, open } = calcOpen(d);
      if (open <= 0.0001) continue;
      items.push({
        doc_type: "ADVANCE_AP",
        doc_entry: d.DocEntry,
        doc_num: d.DocNum,
        card_code: d.CardCode,
        card_name: d.CardName,
        bp_type: "supplier",
        doc_date: d.DocDate,
        doc_total: docTotal,
        paid_to_date: applied,
        open_amount: open,
        doc_currency: d.DocCurrency,
        remarks: d.JournalRemarks,
        reference: d.Reference1,
      });
    }
  } catch (e) {
    console.warn("VendorPayments err", e);
  }

  // 2) Adiantamentos / pagamentos de clientes em aberto (ORCT)
  try {
    const ip = await sapGetAll(creds.baseUrl, cookies, "IncomingPayments", {
      $select:
        "DocEntry,DocNum,CardCode,CardName,DocDate,DocTotal,DocCurrency,JournalRemarks,Reference1,DocType,Cancelled,PaymentInvoices",
      $filter: "Cancelled eq 'tNO'",
    });
    for (const d of ip) {
      const { docTotal, applied, open } = calcOpen(d);
      if (open <= 0.0001) continue;
      items.push({
        doc_type: "ADVANCE_AR",
        doc_entry: d.DocEntry,
        doc_num: d.DocNum,
        card_code: d.CardCode,
        card_name: d.CardName,
        bp_type: "customer",
        doc_date: d.DocDate,
        doc_total: docTotal,
        paid_to_date: applied,
        open_amount: open,
        doc_currency: d.DocCurrency,
        remarks: d.JournalRemarks,
        reference: d.Reference1,
      });
    }
  } catch (e) {
    console.warn("IncomingPayments err", e);
  }

  return items;
}

async function listOpenInvoicesForBp(
  creds: SapCreds,
  cookies: string,
  cardCode: string,
  bpType: "supplier" | "customer",
): Promise<any[]> {
  const endpoint = bpType === "supplier" ? "PurchaseInvoices" : "Invoices";
  const data = await sapGetAll(
    creds.baseUrl,
    cookies,
    endpoint,
    {
      $select: "DocEntry,DocNum,DocDate,DocTotal,PaidToDate,DocCurrency,NumAtCard,DocumentStatus",
      // Inclui NFs Abertas e Fechadas; o filtro de saldo > 0 é aplicado abaixo.
      $filter: `CardCode eq '${cardCode.replace(/'/g, "''")}'`,
    },
    2000,
  );
  return data
    .filter((d) => ((d.DocTotal ?? 0) - (d.PaidToDate ?? 0)) > 0.0001)
    .map((d) => ({
    doc_entry: d.DocEntry,
    doc_num: d.DocNum,
    doc_date: d.DocDate,
    doc_total: d.DocTotal,
    paid_to_date: d.PaidToDate ?? 0,
    open_amount: (d.DocTotal ?? 0) - (d.PaidToDate ?? 0),
    doc_currency: d.DocCurrency,
    reference: d.NumAtCard,
  }));
}

interface InvoiceWithAdvances {
  doc_entry: number;
  doc_num: number;
  doc_date: string | null;
  doc_total: number;
  paid_to_date: number;
  open_amount: number;
  doc_currency: string;
  reference: string | null;
  card_code: string;
  card_name: string;
  bp_type: "supplier" | "customer";
  invoice_kind: "PURCHASE" | "SALES";
  // BP-level aggregates of open advances
  advances_count: number;
  advances_open_total: number;
}

async function listInvoicesWithAdvances(
  creds: SapCreds,
  cookies: string,
): Promise<InvoiceWithAdvances[]> {
  // 1) Get all open advances grouped by card_code
  const advances = await listAdvances(creds, cookies);
  if (advances.length === 0) return [];

  // Build BP map: card_code -> { count, total, bp_type, card_name }
  const bpMap = new Map<
    string,
    { count: number; total: number; bp_type: "supplier" | "customer"; card_name: string }
  >();
  for (const a of advances) {
    const cur = bpMap.get(a.card_code);
    if (cur) {
      cur.count++;
      cur.total += a.open_amount;
    } else {
      bpMap.set(a.card_code, {
        count: 1,
        total: a.open_amount,
        bp_type: a.bp_type,
        card_name: a.card_name,
      });
    }
  }

  const supplierCards = [...bpMap.entries()].filter(([, v]) => v.bp_type === "supplier").map(([k]) => k);
  const customerCards = [...bpMap.entries()].filter(([, v]) => v.bp_type === "customer").map(([k]) => k);

  const out: InvoiceWithAdvances[] = [];

  // SAP Service Layer URL length is limited — chunk into groups of 25 cards.
  async function fetchInvoicesFor(
    cards: string[],
    endpoint: "PurchaseInvoices" | "Invoices",
    bpType: "supplier" | "customer",
    invoiceKind: "PURCHASE" | "SALES",
  ) {
    if (cards.length === 0) return;
    const chunkSize = 25;
    for (let i = 0; i < cards.length; i += chunkSize) {
      const chunk = cards.slice(i, i + chunkSize);
      const orFilter = chunk.map((c) => `CardCode eq '${c.replace(/'/g, "''")}'`).join(" or ");
      try {
        const data = await sapGetAll(
          creds.baseUrl,
          cookies,
          endpoint,
          {
            $select: "DocEntry,DocNum,DocDate,DocTotal,PaidToDate,DocCurrency,NumAtCard,CardCode,CardName,DocumentStatus",
            // Não filtrar por DocumentStatus: NFs podem estar "Fechadas" mas com saldo > 0
            // (ex.: vinculadas a adiantamentos pendentes). Filtra-se pelo saldo abaixo.
            $filter: `(${orFilter})`,
          },
          5000,
        );
        for (const d of data) {
          const open = (d.DocTotal ?? 0) - (d.PaidToDate ?? 0);
          if (open <= 0.0001) continue;
          const bp = bpMap.get(d.CardCode);
          if (!bp) continue;
          out.push({
            doc_entry: d.DocEntry,
            doc_num: d.DocNum,
            doc_date: d.DocDate,
            doc_total: d.DocTotal,
            paid_to_date: d.PaidToDate ?? 0,
            open_amount: open,
            doc_currency: d.DocCurrency,
            reference: d.NumAtCard,
            card_code: d.CardCode,
            card_name: d.CardName || bp.card_name,
            bp_type: bpType,
            invoice_kind: invoiceKind,
            advances_count: bp.count,
            advances_open_total: bp.total,
          });
        }
      } catch (e) {
        console.warn(`${endpoint} chunk err`, e);
      }
    }
  }

  await fetchInvoicesFor(supplierCards, "PurchaseInvoices", "supplier", "PURCHASE");
  await fetchInvoicesFor(customerCards, "Invoices", "customer", "SALES");

  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body JSON inválido" }, 400);
  }

  const action = body?.action;
  const companyDb: string | undefined = body?.company_db;
  if (!action) return json({ error: "action é obrigatório" }, 400);
  if (!companyDb) return json({ error: "company_db é obrigatório" }, 400);

  const creds = await loadSapCreds(sb, companyDb);
  if (!creds) return json({ error: "Credenciais SAP não configuradas para esta empresa" }, 400);

  try {
    if (action === "list-advances") {
      const data = await withSession(creds, (cookies) => listAdvances(creds, cookies));
      return json({ items: data });
    }

    if (action === "list-open-invoices") {
      const cardCode = String(body.card_code || "");
      const bpType = body.bp_type === "customer" ? "customer" : "supplier";
      if (!cardCode) return json({ error: "card_code é obrigatório" }, 400);
      const data = await withSession(creds, (cookies) =>
        listOpenInvoicesForBp(creds, cookies, cardCode, bpType),
      );
      return json({ items: data });
    }

    if (action === "list-invoices-with-advances") {
      const data = await withSession(creds, (cookies) =>
        listInvoicesWithAdvances(creds, cookies),
      );
      return json({ items: data });
    }
    if (action === "auto-link") {

      // body: { doc_type, doc_entry, invoice_doc_entry, amount?, card_code }
      const docType = String(body.doc_type || "");
      const docEntry = Number(body.doc_entry);
      const invoiceDocEntry = Number(body.invoice_doc_entry);
      const cardCode = String(body.card_code || "");
      const amountIn = body.amount != null ? Number(body.amount) : null;
      if (!docType || !docEntry || !invoiceDocEntry || !cardCode) {
        return json({ error: "doc_type, doc_entry, invoice_doc_entry e card_code são obrigatórios" }, 400);
      }

      const isAP = docType === "ADVANCE_AP" || docType === "PAYMENT_OA_OUT";
      const isAdvance = docType === "ADVANCE_AP" || docType === "ADVANCE_AR";

      const result = await withSession(creds, async (cookies) => {
        // Buscar a NF e o documento de origem para validar valores e moeda
        const invoiceEndpoint = isAP ? "PurchaseInvoices" : "Invoices";
        const invResp = await fetch(
          `${creds.baseUrl}/${invoiceEndpoint}(${invoiceDocEntry})?$select=DocEntry,DocNum,DocTotal,PaidToDate,DocCurrency,DocDate`,
          { headers: { Cookie: cookies } },
        );
        if (!invResp.ok) {
          const t = await invResp.text().catch(() => "");
          return { ok: false as const, error: `NF não encontrada: ${t.slice(0, 200)}` };
        }
        const inv: any = await invResp.json();
        const invoiceOpen = (inv.DocTotal ?? 0) - (inv.PaidToDate ?? 0);

        if (isAdvance) {
          // ADVANCE_AP / ADVANCE_AR: criar pagamento que liga DownPayment + Invoice
          // Buscar o downpayment para pegar valor
          const dpEndpoint = isAP ? "PurchaseDownPayments" : "DownPayments";
          const dpResp = await fetch(
            `${creds.baseUrl}/${dpEndpoint}(${docEntry})?$select=DocEntry,DocTotal,PaidToDate,DocCurrency`,
            { headers: { Cookie: cookies } },
          );
          if (!dpResp.ok) {
            const t = await dpResp.text().catch(() => "");
            return { ok: false as const, error: `Adiantamento não encontrado: ${t.slice(0, 200)}` };
          }
          const dp: any = await dpResp.json();
          const dpOpen = (dp.DocTotal ?? 0) - (dp.PaidToDate ?? 0);

          // Valor a aplicar = min(DP em aberto, NF em aberto) ou amountIn se informado
          const applyAmount = amountIn != null
            ? Math.min(amountIn, dpOpen, invoiceOpen)
            : Math.min(dpOpen, invoiceOpen);

          if (applyAmount <= 0.0001) {
            return { ok: false as const, error: "Sem saldo aplicável (DP ou NF já quitados)" };
          }

          // InvoiceType para PaymentInvoices:
          //   AP: 'it_PurchaseInvoice' (NF) e 'it_PurchaseDownPayment' (DP)
          //   AR: 'it_Invoice' e 'it_DownPayment'
          const invType = isAP ? "it_PurchaseInvoice" : "it_Invoice";
          const dpType = isAP ? "it_PurchaseDownPayment" : "it_DownPayment";

          const payEndpoint = isAP ? "VendorPayments" : "IncomingPayments";
          const payload: Record<string, unknown> = {
            CardCode: cardCode,
            DocCurrency: inv.DocCurrency,
            JournalRemarks: `Auto-link DP ${docEntry} -> ${invoiceEndpoint} ${invoiceDocEntry}`,
            PaymentInvoices: [
              { DocEntry: invoiceDocEntry, SumApplied: applyAmount, InvoiceType: invType },
              { DocEntry: docEntry, SumApplied: -applyAmount, InvoiceType: dpType },
            ],
          };
          const r = await sapPost(creds.baseUrl, cookies, payEndpoint, payload);
          return r.ok
            ? { ok: true as const, data: r.data, applied: applyAmount }
            : { ok: false as const, error: r.error };
        }

        // PAYMENT_OA_OUT / PAYMENT_OA_IN: pagamento já existe, fazer reconciliação interna BP
        // Precisamos das TransId/Lines no JournalEntry de cada documento.
        // Para o pagamento on-account: o JE referencia o pagamento.
        // Para a NF: o JE referencia a NF.
        // Buscamos ambos via JournalEntries com filtro por origem.
        //
        // Estratégia: buscar JE do pagamento (TransId conhecido como DocEntry-1 não é confiável)
        // — usar /JournalEntries?$filter=TransactionCode eq '...' não é determinístico.
        // Caminho seguro: JournalEntries?$filter=ReferenceLine relates... — porém SAP B1 expõe
        // a propriedade JdtNum/TransId via documento. Para Payments: o objeto retorna JdtNum.
        const payObj = isAP ? "VendorPayments" : "IncomingPayments";
        const payJe = await fetch(
          `${creds.baseUrl}/${payObj}(${docEntry})?$select=DocEntry,DocNum,DocCurrency,JournalEntry`,
          { headers: { Cookie: cookies } },
        );
        if (!payJe.ok) {
          const t = await payJe.text().catch(() => "");
          return { ok: false as const, error: `Pagamento não encontrado: ${t.slice(0, 200)}` };
        }
        const payDoc: any = await payJe.json();
        const payTransId = payDoc.JournalEntry;

        // JE da NF
        const invJeNum = (inv as any).JournalEntry;
        let invTransId: number | undefined = invJeNum;
        if (!invTransId) {
          const invFull = await fetch(
            `${creds.baseUrl}/${invoiceEndpoint}(${invoiceDocEntry})?$select=JournalEntry`,
            { headers: { Cookie: cookies } },
          );
          if (invFull.ok) {
            const j: any = await invFull.json();
            invTransId = j.JournalEntry;
          }
        }
        if (!payTransId || !invTransId) {
          return { ok: false as const, error: "Não foi possível resolver os JournalEntries para reconciliação" };
        }

        // Buscar as linhas (JournalEntryLines) de cada JE para identificar as do BP
        async function bpLine(transId: number): Promise<{ line: number; amount: number } | null> {
          const r = await fetch(
            `${creds.baseUrl}/JournalEntries(${transId})?$select=JdtNum,JournalEntryLines`,
            { headers: { Cookie: cookies } },
          );
          if (!r.ok) return null;
          const j: any = await r.json();
          const lines: any[] = j.JournalEntryLines || [];
          // Linha do BP: ShortName === cardCode
          const bp = lines.find((l) => l.ShortName === cardCode);
          if (!bp) return null;
          const amt = (bp.Debit ?? 0) - (bp.Credit ?? 0);
          return { line: bp.Line_ID ?? bp.LineNum ?? 0, amount: Math.abs(amt) };
        }

        const payBp = await bpLine(payTransId);
        const invBp = await bpLine(invTransId);
        if (!payBp || !invBp) {
          return { ok: false as const, error: "Linha do parceiro não encontrada nos JE" };
        }

        const reconcileAmount = amountIn != null
          ? Math.min(amountIn, payBp.amount, invBp.amount)
          : Math.min(payBp.amount, invBp.amount);

        if (reconcileAmount <= 0.0001) {
          return { ok: false as const, error: "Sem valor para reconciliar" };
        }

        const recResp = await sapPost(
          creds.baseUrl,
          cookies,
          "InternalReconciliationsService_Reconcile",
          {
            BusinessPartner: { CardCode: cardCode },
            ReconcileType: "rt_BPInternal",
            InternalReconciliationRows: [
              { TransId: payTransId, TransRowId: payBp.line, ReconcileAmount: reconcileAmount },
              { TransId: invTransId, TransRowId: invBp.line, ReconcileAmount: reconcileAmount },
            ],
          },
        );
        return recResp.ok
          ? { ok: true as const, data: recResp.data, applied: reconcileAmount }
          : { ok: false as const, error: recResp.error };
      });

      if (!result.ok) return json({ error: result.error }, 400);
      return json({ ok: true, applied: result.applied, data: result.data });
    }

    if (action === "auto-link-batch") {
      // Body shape (one of):
      //  { mode: "advance-to-invoices", doc_type, doc_entry, card_code, invoices: [{ doc_entry, amount? }] }
      //  { mode: "invoice-to-advances", invoice_kind: "PURCHASE"|"SALES", invoice_doc_entry, card_code, advances: [{ doc_type, doc_entry, amount? }] }
      const mode = String(body.mode || "");
      const cardCode = String(body.card_code || "");
      if (!cardCode) return json({ error: "card_code é obrigatório" }, 400);

      // Normalize to a flat list of { advance, invoiceKind, invoiceDocEntry, amount? } pairs
      // grouped by AP vs AR (one VendorPayments / IncomingPayments per group).
      type Pair = {
        advanceDocType: string; // ADVANCE_AP | ADVANCE_AR | PAYMENT_OA_OUT | PAYMENT_OA_IN
        advanceDocEntry: number;
        invoiceDocEntry: number;
        amount?: number;
      };
      const pairs: Pair[] = [];

      if (mode === "advance-to-invoices") {
        const docType = String(body.doc_type || "");
        const docEntry = Number(body.doc_entry);
        const invoices = Array.isArray(body.invoices) ? body.invoices : [];
        if (!docType || !docEntry || invoices.length === 0) {
          return json({ error: "doc_type, doc_entry e invoices são obrigatórios" }, 400);
        }
        for (const inv of invoices) {
          pairs.push({
            advanceDocType: docType,
            advanceDocEntry: docEntry,
            invoiceDocEntry: Number(inv.doc_entry),
            amount: inv.amount != null ? Number(inv.amount) : undefined,
          });
        }
      } else if (mode === "invoice-to-advances") {
        const invoiceDocEntry = Number(body.invoice_doc_entry);
        const advances = Array.isArray(body.advances) ? body.advances : [];
        if (!invoiceDocEntry || advances.length === 0) {
          return json({ error: "invoice_doc_entry e advances são obrigatórios" }, 400);
        }
        for (const a of advances) {
          pairs.push({
            advanceDocType: String(a.doc_type),
            advanceDocEntry: Number(a.doc_entry),
            invoiceDocEntry,
            amount: a.amount != null ? Number(a.amount) : undefined,
          });
        }
      } else {
        return json({ error: "mode inválido (use advance-to-invoices ou invoice-to-advances)" }, 400);
      }

      // Validate consistency: all advances must be either AP-side or AR-side, and same kind family
      const isAPDoc = (t: string) => t === "ADVANCE_AP" || t === "PAYMENT_OA_OUT";
      const allAP = pairs.every((p) => isAPDoc(p.advanceDocType));
      const allAR = pairs.every((p) => !isAPDoc(p.advanceDocType));
      if (!allAP && !allAR) {
        return json({ error: "Não é possível misturar adiantamentos de fornecedor e cliente" }, 400);
      }
      const isAP = allAP;

      // Separate adiantamentos (DownPayments) and pagamentos on-account
      const advancePairs = pairs.filter(
        (p) => p.advanceDocType === "ADVANCE_AP" || p.advanceDocType === "ADVANCE_AR",
      );
      const oaPairs = pairs.filter(
        (p) => p.advanceDocType === "PAYMENT_OA_OUT" || p.advanceDocType === "PAYMENT_OA_IN",
      );

      const result = await withSession(creds, async (cookies) => {
        const results: Array<{ ok: boolean; applied: number; error?: string; pair: Pair }> = [];

        // ── Group 1: DownPayments → single VendorPayments/IncomingPayments per advance
        // (cannot mix multiple DPs of different docs into one payment safely; we group by
        //  unique (advance) when "advance-to-invoices" mode, and by unique (invoice) when
        //  "invoice-to-advances" mode — see strategy below.)
        const invoiceEndpoint = isAP ? "PurchaseInvoices" : "Invoices";
        const dpEndpoint = isAP ? "PurchaseDownPayments" : "DownPayments";
        const invType = isAP ? "it_PurchaseInvoice" : "it_Invoice";
        const dpType = isAP ? "it_PurchaseDownPayment" : "it_DownPayment";
        const payEndpoint = isAP ? "VendorPayments" : "IncomingPayments";

        // Helper: fetch open amounts
        async function fetchInvoiceOpen(de: number) {
          const r = await fetch(
            `${creds.baseUrl}/${invoiceEndpoint}(${de})?$select=DocEntry,DocNum,DocTotal,PaidToDate,DocCurrency`,
            { headers: { Cookie: cookies } },
          );
          if (!r.ok) return null;
          const j: any = await r.json();
          return {
            docEntry: j.DocEntry,
            open: (j.DocTotal ?? 0) - (j.PaidToDate ?? 0),
            currency: j.DocCurrency,
          };
        }
        async function fetchDpOpen(de: number) {
          const r = await fetch(
            `${creds.baseUrl}/${dpEndpoint}(${de})?$select=DocEntry,DocTotal,PaidToDate,DocCurrency`,
            { headers: { Cookie: cookies } },
          );
          if (!r.ok) return null;
          const j: any = await r.json();
          return {
            docEntry: j.DocEntry,
            open: (j.DocTotal ?? 0) - (j.PaidToDate ?? 0),
            currency: j.DocCurrency,
          };
        }

        if (advancePairs.length > 0) {
          if (mode === "advance-to-invoices") {
            // 1 DP -> N NFs : criar 1 pagamento com várias linhas (NFs +) e 1 linha (DP -)
            const dpDocEntry = advancePairs[0].advanceDocEntry; // todas iguais nesse modo
            const dp = await fetchDpOpen(dpDocEntry);
            if (!dp) {
              for (const p of advancePairs) results.push({ ok: false, applied: 0, error: "Adiantamento não encontrado", pair: p });
            } else {
              let dpRemaining = dp.open;
              const lines: Array<Record<string, unknown>> = [];
              const planned: Array<{ pair: Pair; applied: number }> = [];
              let docCurrency = dp.currency;
              for (const p of advancePairs) {
                if (dpRemaining <= 0.0001) {
                  results.push({ ok: false, applied: 0, error: "Saldo do adiantamento esgotado", pair: p });
                  continue;
                }
                const inv = await fetchInvoiceOpen(p.invoiceDocEntry);
                if (!inv) {
                  results.push({ ok: false, applied: 0, error: "NF não encontrada", pair: p });
                  continue;
                }
                docCurrency = inv.currency || docCurrency;
                const apply = p.amount != null
                  ? Math.min(p.amount, dpRemaining, inv.open)
                  : Math.min(dpRemaining, inv.open);
                if (apply <= 0.0001) {
                  results.push({ ok: false, applied: 0, error: "Sem saldo aplicável", pair: p });
                  continue;
                }
                lines.push({ DocEntry: p.invoiceDocEntry, SumApplied: apply, InvoiceType: invType });
                dpRemaining -= apply;
                planned.push({ pair: p, applied: apply });
              }
              if (lines.length > 0) {
                const totalApplied = planned.reduce((s, x) => s + x.applied, 0);
                lines.push({ DocEntry: dpDocEntry, SumApplied: -totalApplied, InvoiceType: dpType });
                const r = await sapPost(creds.baseUrl, cookies, payEndpoint, {
                  CardCode: cardCode,
                  DocCurrency: docCurrency,
                  JournalRemarks: `Auto-link batch DP ${dpDocEntry} -> ${planned.length} NFs`,
                  PaymentInvoices: lines,
                });
                if (r.ok) {
                  for (const x of planned) results.push({ ok: true, applied: x.applied, pair: x.pair });
                } else {
                  for (const x of planned) results.push({ ok: false, applied: 0, error: r.error, pair: x.pair });
                }
              }
            }
          } else {
            // 1 NF -> N DPs : criar 1 pagamento com 1 linha NF (+) e várias linhas DP (-)
            const invoiceDocEntry = advancePairs[0].invoiceDocEntry;
            const inv = await fetchInvoiceOpen(invoiceDocEntry);
            if (!inv) {
              for (const p of advancePairs) results.push({ ok: false, applied: 0, error: "NF não encontrada", pair: p });
            } else {
              let invRemaining = inv.open;
              const lines: Array<Record<string, unknown>> = [];
              const planned: Array<{ pair: Pair; applied: number }> = [];
              for (const p of advancePairs) {
                if (invRemaining <= 0.0001) {
                  results.push({ ok: false, applied: 0, error: "Saldo da NF esgotado", pair: p });
                  continue;
                }
                const dp = await fetchDpOpen(p.advanceDocEntry);
                if (!dp) {
                  results.push({ ok: false, applied: 0, error: "Adiantamento não encontrado", pair: p });
                  continue;
                }
                const apply = p.amount != null
                  ? Math.min(p.amount, dp.open, invRemaining)
                  : Math.min(dp.open, invRemaining);
                if (apply <= 0.0001) {
                  results.push({ ok: false, applied: 0, error: "Sem saldo aplicável", pair: p });
                  continue;
                }
                lines.push({ DocEntry: p.advanceDocEntry, SumApplied: -apply, InvoiceType: dpType });
                invRemaining -= apply;
                planned.push({ pair: p, applied: apply });
              }
              if (lines.length > 0) {
                const totalApplied = planned.reduce((s, x) => s + x.applied, 0);
                lines.unshift({ DocEntry: invoiceDocEntry, SumApplied: totalApplied, InvoiceType: invType });
                const r = await sapPost(creds.baseUrl, cookies, payEndpoint, {
                  CardCode: cardCode,
                  DocCurrency: inv.currency,
                  JournalRemarks: `Auto-link batch ${planned.length} DPs -> NF ${invoiceDocEntry}`,
                  PaymentInvoices: lines,
                });
                if (r.ok) {
                  for (const x of planned) results.push({ ok: true, applied: x.applied, pair: x.pair });
                } else {
                  for (const x of planned) results.push({ ok: false, applied: 0, error: r.error, pair: x.pair });
                }
              }
            }
          }
        }

        // ── Group 2: PAYMENT_OA — internal reconciliation (multi-line). Process one by one,
        //     reusing the single-link logic semantics, but issued sequentially.
        for (const p of oaPairs) {
          try {
            const isAPp = p.advanceDocType === "PAYMENT_OA_OUT";
            const invEp = isAPp ? "PurchaseInvoices" : "Invoices";
            const payObj = isAPp ? "VendorPayments" : "IncomingPayments";
            const payJe = await fetch(
              `${creds.baseUrl}/${payObj}(${p.advanceDocEntry})?$select=DocEntry,JournalEntry`,
              { headers: { Cookie: cookies } },
            );
            const invJe = await fetch(
              `${creds.baseUrl}/${invEp}(${p.invoiceDocEntry})?$select=DocEntry,JournalEntry,DocTotal,PaidToDate`,
              { headers: { Cookie: cookies } },
            );
            if (!payJe.ok || !invJe.ok) {
              results.push({ ok: false, applied: 0, error: "Pagamento ou NF não encontrado", pair: p });
              continue;
            }
            const payDoc: any = await payJe.json();
            const invDoc: any = await invJe.json();
            const payTransId = payDoc.JournalEntry;
            const invTransId = invDoc.JournalEntry;
            if (!payTransId || !invTransId) {
              results.push({ ok: false, applied: 0, error: "JE não resolvido", pair: p });
              continue;
            }
            async function bpLine(transId: number) {
              const r = await fetch(
                `${creds.baseUrl}/JournalEntries(${transId})?$select=JdtNum,JournalEntryLines`,
                { headers: { Cookie: cookies } },
              );
              if (!r.ok) return null;
              const j: any = await r.json();
              const lines: any[] = j.JournalEntryLines || [];
              const bp = lines.find((l) => l.ShortName === cardCode);
              if (!bp) return null;
              const amt = (bp.Debit ?? 0) - (bp.Credit ?? 0);
              return { line: bp.Line_ID ?? bp.LineNum ?? 0, amount: Math.abs(amt) };
            }
            const payBp = await bpLine(payTransId);
            const invBp = await bpLine(invTransId);
            if (!payBp || !invBp) {
              results.push({ ok: false, applied: 0, error: "Linha do BP não encontrada", pair: p });
              continue;
            }
            const apply = p.amount != null
              ? Math.min(p.amount, payBp.amount, invBp.amount)
              : Math.min(payBp.amount, invBp.amount);
            if (apply <= 0.0001) {
              results.push({ ok: false, applied: 0, error: "Sem saldo", pair: p });
              continue;
            }
            const r = await sapPost(creds.baseUrl, cookies, "InternalReconciliationsService_Reconcile", {
              BusinessPartner: { CardCode: cardCode },
              ReconcileType: "rt_BPInternal",
              InternalReconciliationRows: [
                { TransId: payTransId, TransRowId: payBp.line, ReconcileAmount: apply },
                { TransId: invTransId, TransRowId: invBp.line, ReconcileAmount: apply },
              ],
            });
            if (r.ok) results.push({ ok: true, applied: apply, pair: p });
            else results.push({ ok: false, applied: 0, error: r.error, pair: p });
          } catch (e) {
            results.push({ ok: false, applied: 0, error: e instanceof Error ? e.message : String(e), pair: p });
          }
        }

        return { ok: true as const, results };
      });

      const succeeded = result.results.filter((r) => r.ok).length;
      const failed = result.results.filter((r) => !r.ok).length;
      const totalApplied = result.results.reduce((s, r) => s + (r.applied || 0), 0);
      return json({ ok: true, succeeded, failed, total_applied: totalApplied, results: result.results });
    }

    if (action === "internal-reconcile") {
      // Internal reconciliation between BP transactions
      // body: { card_code, lines: [{ TransId, TransRowId, ReconcileAmount }] }
      const cardCode = String(body.card_code || "");
      const lines = Array.isArray(body.lines) ? body.lines : [];
      if (!cardCode || lines.length < 2) {
        return json({ error: "card_code e ao menos 2 lines são obrigatórios" }, 400);
      }
      const result = await withSession(creds, async (cookies) => {
        return await sapPost(creds.baseUrl, cookies, "InternalReconciliationsService_Reconcile", {
          BusinessPartner: { CardCode: cardCode },
          ReconcileType: "rt_BPInternal",
          InternalReconciliationRows: lines,
        });
      });
      if (!result.ok) return json({ error: result.error }, 400);
      return json({ ok: true, data: result.data });
    }

    if (action === "cancel-payment") {
      // body: { doc_type: 'PAYMENT_OA_OUT' | 'PAYMENT_OA_IN' | 'ADVANCE_AP' | 'ADVANCE_AR', doc_entry }
      const docEntry = Number(body.doc_entry);
      const docType = String(body.doc_type || "");
      if (!docEntry || !docType) return json({ error: "doc_type e doc_entry obrigatórios" }, 400);
      const endpointMap: Record<string, string> = {
        PAYMENT_OA_OUT: `VendorPayments(${docEntry})`,
        PAYMENT_OA_IN: `IncomingPayments(${docEntry})`,
        ADVANCE_AP: `PurchaseDownPayments(${docEntry})`,
        ADVANCE_AR: `DownPayments(${docEntry})`,
      };
      const endpoint = endpointMap[docType];
      if (!endpoint) return json({ error: "doc_type inválido" }, 400);
      const result = await withSession(creds, (cookies) =>
        sapCancel(creds.baseUrl, cookies, endpoint),
      );
      if (!result.ok) return json({ error: result.error }, 400);
      return json({ ok: true });
    }

    return json({ error: `Ação desconhecida: ${action}` }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
