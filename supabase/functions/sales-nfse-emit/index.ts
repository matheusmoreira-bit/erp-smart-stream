// Edge function: sales-nfse-emit
// Emite a NFS-e (Invoice de saída) no SAP B1 a partir de um Pedido de Venda
// aprovado e já integrado (SAP Orders), e sincroniza o status/número real da
// NFS-e autorizada pelo addon fiscal (TaxOne) via `sap-nfse-lookup`.
//
// Body:
//   { action: "emit", expense_id: string }
//   { action: "sync-status", company_db: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders as baseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireUserOrSapSession } from "../_shared/auth.ts";
import { notifySalesMilestone } from "../_shared/sales-notify.ts";

const corsHeaders = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db, x-sap-auth-token",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function buildBaseUrl(raw: string): string {
  let url = String(raw || "").replace(/\/+$/, "");
  if (!url) throw new Error("URL do SAP B1 não configurada");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

// deno-lint-ignore no-explicit-any
async function loadCreds(sb: any, companyDb: string): Promise<Record<string, string>> {
  const { data, error } = await sb
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "sap")
    .eq("company_db", companyDb);
  if (error) throw new Error(`Erro credenciais SAP: ${error.message}`);
  const kv: Record<string, string> = {};
  for (const r of (data || []) as Array<{ credential_key: string; credential_value: string }>) {
    kv[r.credential_key] = r.credential_value ?? "";
  }
  if (!kv.service_layer_url || !kv.username || !kv.password) {
    throw new Error("Credenciais de integração (Apiuser) não configuradas para esta empresa.");
  }
  return kv;
}

async function sapLogin(baseUrl: string, u: string, p: string, db: string) {
  const r = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ UserName: u, Password: p, CompanyDB: db }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Falha no login SAP [${r.status}]: ${t.slice(0, 200)}`);
  }
  const j = await r.json().catch(() => ({}));
  const setCookie = r.headers.get("set-cookie") || "";
  const sid = j?.SessionId || setCookie.match(/B1SESSION=([^;]+)/)?.[1];
  const rid = setCookie.match(/(?:B1)?ROUTEID=([^;]+)/)?.[1] || "";
  if (!sid) throw new Error("SAP não retornou SessionId.");
  return { cookies: `B1SESSION=${sid}${rid ? `; ROUTEID=${rid}` : ""}`, sessionId: sid as string };
}

// deno-lint-ignore no-explicit-any
async function sapGet(baseUrl: string, cookies: string, path: string): Promise<any> {
  const r = await fetch(`${baseUrl}/${path}`, { headers: { Cookie: cookies } });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = b?.error?.message?.value || JSON.stringify(b);
    throw new Error(`SAP GET ${path} falhou [${r.status}]: ${String(msg).slice(0, 300)}`);
  }
  return b;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const auth = await requireUserOrSapSession(req).catch(() => null);
    if (!auth) return json({ error: "Não autenticado" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "emit");

    /* ── sincroniza número/status real da NFS-e (TaxOne) ───────────── */
    if (action === "sync-status") {
      const companyDb = String(body?.company_db || "").trim();
      if (!companyDb) return json({ error: "company_db obrigatório" }, 400);

      const { data: rows, error } = await supabase
        .from("sales_order_invoices")
        .select("id, sap_invoice_doc_entry, status")
        .eq("company_db", companyDb)
        .not("sap_invoice_doc_entry", "is", null)
        .neq("status", "authorized")
        .limit(200);
      if (error) throw new Error(error.message);

      const docEntries = (rows || [])
        .map((r) => Number(r.sap_invoice_doc_entry))
        .filter((n) => Number.isFinite(n));
      if (docEntries.length === 0) return json({ updated: 0 });

      const { data: lookup, error: fnErr } = await supabase.functions.invoke("sap-nfse-lookup", {
        body: { company_db: companyDb, doc_entries: docEntries },
      });
      if (fnErr) throw new Error(`Consulta fiscal falhou: ${fnErr.message}`);

      const map = (lookup?.map || {}) as Record<string, {
        nfse?: string | null; rps?: string | null; status?: string | null; authorized_at?: string | null;
      }>;

      let updated = 0;
      for (const row of rows || []) {
        const info = map[String(row.sap_invoice_doc_entry)];
        if (!info) continue;
        const nfse = info.nfse ? String(info.nfse) : null;
        await supabase
          .from("sales_order_invoices")
          .update({
            nfse_number: nfse,
            rps_number: info.rps ? String(info.rps) : null,
            authorized_at: info.authorized_at || null,
            status: nfse ? "authorized" : "issued",
          })
          .eq("id", row.id);
        updated += 1;
      }
      return json({ updated });
    }

    /* ── emissão da NFS-e a partir do pedido de venda ──────────────── */
    if (action !== "emit") return json({ error: "Ação inválida" }, 400);

    // Origem 1: pedido criado no ERP Flow (expense_id)
    // Origem 2: pedido criado direto no ERP (company_db + sap_order_doc_entry)
    const expenseId = String(body?.expense_id || "").trim();
    const rawOrderEntry = Number(body?.sap_order_doc_entry ?? NaN);
    const nativeCompanyDb = String(body?.company_db || "").trim();
    const isNative = !expenseId;

    if (isNative) {
      if (!nativeCompanyDb) return json({ error: "company_db obrigatório" }, 400);
      if (!Number.isFinite(rawOrderEntry) || rawOrderEntry <= 0) {
        return json({ error: "sap_order_doc_entry inválido" }, 400);
      }
    } else if (!/^[0-9a-f-]{36}$/i.test(expenseId)) {
      return json({ error: "expense_id inválido" }, 400);
    }

    let expense: {
      id: string | null;
      company_db: string;
      supplier_name: string | null;
      total_amount: number | null;
      currency: string | null;
      sap_doc_entry: number;
    };

    if (isNative) {
      expense = {
        id: null,
        company_db: nativeCompanyDb,
        supplier_name: String(body?.customer_name || "") || null,
        total_amount: Number(body?.total_amount || 0),
        currency: String(body?.currency || "BRL"),
        sap_doc_entry: rawOrderEntry,
      };
      const { data: alreadyNative } = await supabase
        .from("sales_order_invoices")
        .select("id, sap_invoice_doc_num, status")
        .eq("company_db", nativeCompanyDb)
        .eq("sap_order_doc_entry", rawOrderEntry)
        .is("expense_id", null)
        .not("status", "in", "(failed,cancelled)")
        .maybeSingle();
      if (alreadyNative?.sap_invoice_doc_num) {
        return json(
          { error: `Já existe NFS-e emitida para este pedido (doc ${alreadyNative.sap_invoice_doc_num}).` },
          409,
        );
      }
    } else {
      const { data: exp, error: expErr } = await supabase
        .from("expenses")
        .select("id, doc_type, status, company_db, supplier_code, supplier_name, total_amount, currency, sap_doc_entry, sap_doc_num, remarks")
        .eq("id", expenseId)
        .maybeSingle();
      if (expErr) throw new Error(expErr.message);
      if (!exp) return json({ error: "Pedido de venda não encontrado" }, 404);
      if (exp.doc_type !== "sales") return json({ error: "Documento não é um pedido de venda" }, 400);
      if (!exp.sap_doc_entry) {
        return json({ error: "Pedido ainda não foi integrado ao ERP. Aguarde a integração." }, 400);
      }
      if (!["aprovado", "pc_lancado", "nf_entrada", "pagamento", "finalizado"].includes(String(exp.status))) {
        return json({ error: "Pedido de venda não está aprovado." }, 400);
      }

      const { data: already } = await supabase
        .from("sales_order_invoices")
        .select("id, sap_invoice_doc_num, status")
        .eq("expense_id", expenseId)
        .not("status", "in", "(failed,cancelled)")
        .maybeSingle();
      if (already?.sap_invoice_doc_num) {
        return json({ error: `Já existe NFS-e emitida para este pedido (doc ${already.sap_invoice_doc_num}).` }, 409);
      }

      expense = {
        id: exp.id,
        company_db: exp.company_db,
        supplier_name: exp.supplier_name,
        total_amount: Number(exp.total_amount || 0),
        currency: exp.currency || "BRL",
        sap_doc_entry: Number(exp.sap_doc_entry),
      };
    }

    const creds = await loadCreds(supabase, expense.company_db);
    const baseUrl = buildBaseUrl(creds.service_layer_url);
    const session = await sapLogin(baseUrl, creds.username, creds.password, creds.company_db || expense.company_db);

    // Pedido de venda no SAP → base para a nota
    const order = await sapGet(
      baseUrl,
      session.cookies,
      `Orders(${Number(expense.sap_doc_entry)})?$select=DocEntry,DocNum,CardCode,CardName,DocCurrency,BPL_IDAssignedToInvoice,DocumentStatus,Comments,DocumentLines`,
    );
    if (String(order?.DocumentStatus) === "bost_Close") {
      return json({ error: "Pedido já está fechado/faturado no ERP." }, 409);
    }

    // deno-lint-ignore no-explicit-any
    const lines = (order?.DocumentLines || []) as any[];
    const openLines = lines.filter((l) => Number(l?.RemainingOpenQuantity ?? l?.Quantity ?? 0) > 0);
    if (openLines.length === 0) return json({ error: "Pedido não possui linhas em aberto para faturar." }, 400);

    const invoicePayload: Record<string, unknown> = {
      CardCode: order.CardCode,
      DocDate: new Date().toISOString().slice(0, 10),
      DocDueDate: new Date().toISOString().slice(0, 10),
      DocCurrency: order.DocCurrency || expense.currency || "BRL",
      Comments: `NFS-e gerada pelo ERP Flow — Pedido ${order.DocNum}`,
      DocumentLines: openLines.map((l) => ({
        BaseType: 17,
        BaseEntry: Number(order.DocEntry),
        BaseLine: Number(l.LineNum),
        Quantity: Number(l.RemainingOpenQuantity ?? l.Quantity ?? 0),
      })),
    };
    if (order.BPL_IDAssignedToInvoice) {
      invoicePayload.BPL_IDAssignedToInvoice = Number(order.BPL_IDAssignedToInvoice);
    }

    const res = await fetch(`${baseUrl}/Invoices`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.cookies },
      body: JSON.stringify(invoicePayload),
    });
    const invoice = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = invoice?.error?.message?.value || JSON.stringify(invoice);
      await supabase.from("sales_order_invoices").insert({
        expense_id: expense.id,
        company_db: expense.company_db,
        sap_order_doc_entry: Number(expense.sap_doc_entry),
        sap_order_doc_num: Number(order.DocNum) || null,
        total_amount: Number(expense.total_amount || 0),
        currency: expense.currency || "BRL",
        status: "failed",
        last_error: String(msg).slice(0, 1000),
        created_by_email: (auth as { email?: string })?.email ?? null,
      });
      return json({ error: `SAP Invoices falhou [${res.status}]: ${String(msg).slice(0, 400)}` }, 400);
    }

    /* ── Envio automático da NFS-e (addon fiscal) ──────────────────────
       O botão "Enviar NFS-e" do addon apenas marca o documento para o
       serviço fiscal transmitir. Fazemos o mesmo via Service Layer,
       marcando o UDF de fila de transmissão. Não é fatal: se a base não
       tiver o campo (ou o serviço estiver desligado), a nota continua
       criada e o envio pode ser feito manualmente no ERP.
       Desativável por empresa com a credencial `nfse_autosend = false`. */
    let autoSend: { ok: boolean; detail?: string } = { ok: false, detail: "desativado" };
    if (String(creds.nfse_autosend ?? "true").toLowerCase() !== "false") {
      try {
        const sendRes = await fetch(`${baseUrl}/Invoices(${Number(invoice.DocEntry)})`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Cookie: session.cookies },
          body: JSON.stringify({ U_XmlServiceStatus: "1" }),
        });
        if (sendRes.ok) {
          autoSend = { ok: true };
        } else {
          const t = await sendRes.text().catch(() => "");
          autoSend = { ok: false, detail: `HTTP ${sendRes.status}: ${t.slice(0, 200)}` };
        }
      } catch (e) {
        autoSend = { ok: false, detail: (e as Error).message?.slice(0, 200) };
      }
      if (!autoSend.ok) console.error("sales-nfse-emit auto-send falhou", autoSend.detail);
    }


    const { data: inserted, error: insErr } = await supabase
      .from("sales_order_invoices")
      .insert({
        expense_id: expense.id,
        company_db: expense.company_db,
        sap_order_doc_entry: Number(expense.sap_doc_entry),
        sap_order_doc_num: Number(order.DocNum) || null,
        sap_invoice_doc_entry: Number(invoice.DocEntry),
        sap_invoice_doc_num: Number(invoice.DocNum),
        rps_number: invoice.SequenceSerial ? String(invoice.SequenceSerial) : null,
        series: invoice.SeriesString ? String(invoice.SeriesString) : null,
        total_amount: Number(invoice.DocTotal ?? expense.total_amount ?? 0),
        currency: invoice.DocCurrency || expense.currency || "BRL",
        status: "issued",
        created_by_email: (auth as { email?: string })?.email ?? null,
      })
      .select("id")
      .single();
    if (insErr) console.error("sales-nfse-emit insert error", insErr.message);

    await notifySalesMilestone(supabase, {
      milestone: "nfse_issued",
      companyDb: expense.company_db,
      refId: `${expense.company_db}:${Number(invoice.DocEntry)}`,
      link: "/vendas/nfse",
      summary: "Uma NFS-e foi emitida a partir de um pedido de venda.",
      details: [
        { label: "Cliente", value: expense.supplier_name || order.CardName || order.CardCode },
        { label: "Documento SAP", value: Number(invoice.DocNum) },
        { label: "RPS/Série", value: invoice.SequenceSerial ? String(invoice.SequenceSerial) : null },
        { label: "Valor", value: `${invoice.DocCurrency || expense.currency || "BRL"} ${Number(invoice.DocTotal ?? expense.total_amount ?? 0).toFixed(2)}` },
        { label: "Empresa", value: expense.company_db },
      ],
    });

    return json({
      success: true,
      id: inserted?.id ?? null,
      doc_entry: Number(invoice.DocEntry),
      doc_num: Number(invoice.DocNum),
    });
  } catch (e) {
    console.error("sales-nfse-emit error", e);
    return json({ error: (e as Error).message || "Erro inesperado" }, 500);
  }
});
