// Reconciliação automática de totais entre o ERP Flow e o SAP B1.
//
// Para cada documento integrado (pedido de compra/venda com DocEntry), lê o
// documento no Service Layer, compara o total do Flow com o total do SAP e
// aponta a CAUSA da divergência (desconto de cabeçalho, desconto de linha,
// impostos, despesas adicionais/frete, arredondamento, câmbio ou diferença de
// linhas). O resultado é gravado em public.sap_total_reconciliation.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsFor, rejectForeignOrigin } from "../_shared/cors-allowlist.ts";

const TOLERANCE = 0.02;

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round(v: number, d = 2): number {
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

function buildBaseUrl(raw: string): string {
  let url = (raw || "").replace(/\/+$/, "");
  if (!url) throw new Error("URL do SAP B1 não configurada");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

interface SapLine {
  ItemCode?: string | null;
  ItemDescription?: string | null;
  Quantity?: number;
  UnitPrice?: number;
  Price?: number;
  LineTotal?: number;
  DiscountPercent?: number;
  TaxTotal?: number;
  LineStatus?: string | null;
}

interface Finding {
  status: "ok" | "explained" | "divergent" | "error";
  cause: string | null;
  cause_label: string | null;
  cause_detail: Record<string, unknown>;
}

const CAUSE_LABELS: Record<string, string> = {
  discount_header: "Desconto aplicado no cabeçalho do documento no SAP",
  discount_lines: "Desconto aplicado nas linhas do documento no SAP",
  tax: "Impostos somados ao total no SAP",
  freight: "Despesas adicionais/frete lançadas no SAP",
  rounding: "Arredondamento",
  currency: "Moeda/taxa de câmbio diferente",
  lines_mismatch: "Quantidade ou preço das linhas alterado no SAP",
  missing_in_sap: "Documento não encontrado no SAP",
  unknown: "Divergência sem causa identificada",
};

/** Compara os totais e aponta a causa mais provável. */
function classify(params: {
  flowTotal: number;
  flowLinesTotal: number;
  flowCurrency: string | null;
  sapDoc: Record<string, unknown>;
  sapLines: SapLine[];
}): Finding & { sapTotal: number; sapNet: number; breakdown: Record<string, unknown> } {
  const { flowTotal, flowLinesTotal, flowCurrency, sapDoc, sapLines } = params;

  const sapTotal = round(num(sapDoc.DocTotal));
  const vat = round(num(sapDoc.VatSum));
  const freight = round(num(sapDoc.TotalExpenses ?? sapDoc.TotalExpns));
  const rounding = round(num(sapDoc.RoundingDiffAmount));
  const discountPercent = round(num(sapDoc.DiscountPercent), 4);
  const totalDiscount = round(num(sapDoc.TotalDiscount));
  const currency = typeof sapDoc.DocCurrency === "string" ? sapDoc.DocCurrency : null;

  const linesTotal = round(sapLines.reduce((s, l) => s + num(l.LineTotal ?? num(l.Quantity) * num(l.UnitPrice ?? l.Price)), 0));
  const linesWithDiscount = sapLines.filter((l) => num(l.DiscountPercent) > 0).length;

  // Total "líquido" do SAP: sem imposto, sem frete e sem arredondamento.
  const sapNet = round(sapTotal - vat - freight - rounding);
  const diffGross = round(flowTotal - sapTotal);
  const diffNet = round(flowTotal - sapNet);

  const breakdown = {
    sap_total: sapTotal,
    sap_net: sapNet,
    sap_lines_total: linesTotal,
    flow_total: flowTotal,
    flow_lines_total: flowLinesTotal,
    vat,
    freight,
    rounding,
    discount_percent: discountPercent,
    total_discount: totalDiscount,
    currency,
    diff_gross: diffGross,
    diff_net: diffNet,
    lines_with_discount: linesWithDiscount,
    sap_line_count: sapLines.length,
  };

  const finish = (status: Finding["status"], cause: string | null, detail: Record<string, unknown> = {}) => ({
    status,
    cause,
    cause_label: cause ? CAUSE_LABELS[cause] ?? cause : null,
    cause_detail: detail,
    sapTotal,
    sapNet,
    breakdown,
  });

  // 1) Totais batem exatamente.
  if (Math.abs(diffGross) <= TOLERANCE) return finish("ok", null);

  // 2) Diferença explicada por desconto (cabeçalho ou linhas).
  if (Math.abs(diffNet) > TOLERANCE) {
    if (totalDiscount > 0 && Math.abs(round(diffNet - totalDiscount)) <= TOLERANCE) {
      return finish("divergent", "discount_header", {
        desconto_percentual: discountPercent,
        desconto_valor: totalDiscount,
        explicacao:
          `O SAP aplicou ${discountPercent}% de desconto (R$ ${totalDiscount.toFixed(2)}) no cabeçalho, herdado do cadastro do parceiro de negócios.`,
      });
    }
    if (linesWithDiscount > 0) {
      const perLine = sapLines
        .filter((l) => num(l.DiscountPercent) > 0)
        .map((l) => ({ item: l.ItemCode ?? l.ItemDescription ?? "—", desconto: round(num(l.DiscountPercent), 4) }));
      return finish("divergent", "discount_lines", {
        linhas: perLine,
        explicacao: `${linesWithDiscount} linha(s) com desconto aplicado no SAP.`,
      });
    }
    if (currency && flowCurrency && currency !== flowCurrency) {
      return finish("divergent", "currency", {
        moeda_flow: flowCurrency,
        moeda_sap: currency,
        taxa: num(sapDoc.DocRate),
        explicacao: `Documento gravado em ${currency} no SAP e em ${flowCurrency} no Flow.`,
      });
    }
    if (Math.abs(diffNet) <= 0.05) {
      return finish("divergent", "rounding", { diferenca: diffNet, explicacao: "Diferença de centavos por arredondamento." });
    }
    if (Math.abs(round(flowLinesTotal - linesTotal)) > TOLERANCE) {
      return finish("divergent", "lines_mismatch", {
        total_linhas_flow: flowLinesTotal,
        total_linhas_sap: linesTotal,
        explicacao: "As linhas do documento no SAP somam valor diferente das linhas no Flow (quantidade ou preço alterado).",
      });
    }
    return finish("divergent", "unknown", {
      diferenca_liquida: diffNet,
      explicacao: "Diferença não explicada por desconto, imposto, frete, câmbio ou linhas.",
    });
  }

  // 3) O líquido bate: a diferença vem de imposto, frete ou arredondamento.
  const parts: string[] = [];
  if (Math.abs(vat) > TOLERANCE) parts.push(`impostos R$ ${vat.toFixed(2)}`);
  if (Math.abs(freight) > TOLERANCE) parts.push(`despesas adicionais R$ ${freight.toFixed(2)}`);
  if (Math.abs(rounding) > TOLERANCE) parts.push(`arredondamento R$ ${rounding.toFixed(2)}`);

  const cause = Math.abs(vat) > TOLERANCE ? "tax" : Math.abs(freight) > TOLERANCE ? "freight" : "rounding";
  return finish("explained", cause, {
    impostos: vat,
    frete: freight,
    arredondamento: rounding,
    explicacao: `O total do SAP é maior porque inclui ${parts.join(" + ") || "arredondamento"}. O valor líquido é idêntico ao do ERP Flow.`,
  });
}

Deno.serve(async (req) => {
  const cors = corsFor(req, "POST, OPTIONS");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const foreign = rejectForeignOrigin(req);
  if (foreign) return foreign;
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405, cors);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const cronKey = Deno.env.get("RECONCILE_CRON_KEY") || "";
    const isCron = !!cronKey && req.headers.get("x-cron-key") === cronKey;

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token && !isCron) return json({ error: "UNAUTHORIZED" }, 401, cors);

    let actorEmail = isCron ? "cron" : "service_role";
    if (!isCron && token !== serviceKey) {
      const asCaller = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: userData } = await asCaller.auth.getUser();
      if (!userData?.user) return json({ error: "Sessão inválida. Faça login novamente." }, 401, cors);
      actorEmail = userData.user.email || "desconhecido";
    }

    const body = await req.json().catch(() => ({}));
    const companyDb = String(body.company_db || "").trim();
    const expenseId = String(body.expense_id || "").trim();
    const days = Math.min(Math.max(Number(body.days) || 90, 1), 365);
    const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 300);
    if (!companyDb && !expenseId) return json({ error: "Informe company_db ou expense_id" }, 400, cors);

    // Execução automática (cron diário): varre todas as empresas ativas, uma a uma.
    if (companyDb === "all") {
      const { data: companies } = await supabase
        .from("companies")
        .select("company_db")
        .eq("is_active", true);
      const summary: Array<Record<string, unknown>> = [];
      for (const c of companies || []) {
        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/expense-sap-reconcile`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
            body: JSON.stringify({ company_db: c.company_db, days, limit }),
          });
          const payload = await res.json().catch(() => ({}));
          summary.push({ company_db: c.company_db, ...payload });
        } catch (e) {
          summary.push({ company_db: c.company_db, error: e instanceof Error ? e.message : String(e) });
        }
      }
      return json({ success: true, mode: "all", companies: summary }, 200, cors);
    }

    let query = supabase
      .from("expenses")
      .select("id, company_db, doc_type, sap_doc_entry, sap_doc_num, total_amount, currency, supplier_name, doc_date, status, created_at")
      .not("sap_doc_entry", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (expenseId) query = query.eq("id", expenseId);
    else {
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      query = query.eq("company_db", companyDb).gte("created_at", since);
    }

    const { data: expenses, error: expErr } = await query;
    if (expErr) throw new Error(expErr.message);
    if (!expenses?.length) return json({ success: true, checked: 0, results: [] }, 200, cors);

    const db = expenses[0].company_db;
    if (expenses.some((e) => e.company_db !== db)) {
      return json({ error: "Documentos de empresas diferentes na mesma execução" }, 400, cors);
    }

    // Linhas locais para comparação por item.
    const ids = expenses.map((e) => e.id);
    const { data: itemRows } = await supabase
      .from("expense_items")
      .select("expense_id, line_total")
      .in("expense_id", ids);
    const flowLinesByExpense = new Map<string, number>();
    for (const r of itemRows || []) {
      flowLinesByExpense.set(r.expense_id, round((flowLinesByExpense.get(r.expense_id) || 0) + num(r.line_total)));
    }

    // Credenciais + login SAP (uma sessão para todo o lote).
    const { data: credRows, error: credErr } = await supabase
      .from("system_credentials")
      .select("credential_key, credential_value")
      .eq("system_name", "sap")
      .eq("company_db", db);
    if (credErr) throw new Error(credErr.message);
    const creds: Record<string, string> = {};
    for (const r of credRows || []) creds[r.credential_key] = r.credential_value ?? "";

    const baseUrl = buildBaseUrl(creds.service_layer_url || creds.base_url || creds.url || "");
    const user = creds.username || creds.user_name || creds.api_user || "";
    const pass = creds.password || creds.api_password || "";
    if (!user || !pass) return json({ error: "Credenciais de integração (Apiuser) não configuradas." }, 400, cors);

    const loginRes = await fetch(`${baseUrl}/Login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ UserName: user, Password: pass, CompanyDB: db }),
    });
    if (!loginRes.ok) {
      const t = await loginRes.text().catch(() => "");
      return json({ error: `Falha no login SAP [${loginRes.status}]: ${t.slice(0, 200)}` }, 502, cors);
    }
    await loginRes.json().catch(() => ({}));
    const setCookie = loginRes.headers.get("set-cookie") || "";
    const sid = setCookie.match(/B1SESSION=([^;]+)/)?.[1];
    const rid = setCookie.match(/ROUTEID=([^;]+)/)?.[1];
    if (!sid) return json({ error: "SAP não retornou B1SESSION" }, 502, cors);
    const cookies = `B1SESSION=${sid}${rid ? `; ROUTEID=${rid}` : ""}`;

    const results: Array<Record<string, unknown>> = [];
    const rowsToUpsert: Array<Record<string, unknown>> = [];

    // Lotes pequenos e sequenciais: o Service Layer não gosta de rajadas.
    // Processa em lotes paralelos (5 por vez) para não estourar o tempo da função.
    const processOne = async (exp: typeof expenses[number]) => {
      const endpoint = exp.doc_type === "sales" ? "Orders" : "PurchaseOrders";
      let finding: Finding & { sapTotal: number; sapNet: number; breakdown: Record<string, unknown> };
      let sapDocNum: number | null = exp.sap_doc_num ?? null;

      try {
        const docRes = await fetch(`${baseUrl}/${endpoint}(${exp.sap_doc_entry})`, { headers: { Cookie: cookies } });
        if (docRes.status === 404) {
          finding = {
            status: "divergent",
            cause: "missing_in_sap",
            cause_label: CAUSE_LABELS.missing_in_sap,
            cause_detail: { explicacao: "O documento não existe mais no SAP (cancelado ou excluído)." },
            sapTotal: 0,
            sapNet: 0,
            breakdown: {},
          };
        } else if (!docRes.ok) {
          const t = await docRes.text().catch(() => "");
          finding = {
            status: "error",
            cause: null,
            cause_label: null,
            cause_detail: { erro: `SAP ${docRes.status}: ${t.slice(0, 200)}` },
            sapTotal: 0,
            sapNet: 0,
            breakdown: {},
          };
        } else {
          const sapDoc = await docRes.json();
          sapDocNum = typeof sapDoc?.DocNum === "number" ? sapDoc.DocNum : sapDocNum;
          const allLines: SapLine[] = Array.isArray(sapDoc?.DocumentLines) ? sapDoc.DocumentLines : [];
          finding = classify({
            flowTotal: round(num(exp.total_amount)),
            flowLinesTotal: flowLinesByExpense.get(exp.id) ?? round(num(exp.total_amount)),
            flowCurrency: exp.currency ?? null,
            sapDoc,
            sapLines: allLines,
          });
        }
      } catch (e) {
        finding = {
          status: "error",
          cause: null,
          cause_label: null,
          cause_detail: { erro: e instanceof Error ? e.message : String(e) },
          sapTotal: 0,
          sapNet: 0,
          breakdown: {},
        };
      }

      const flowTotal = round(num(exp.total_amount));
      const difference = round(flowTotal - finding.sapTotal);

      rowsToUpsert.push({
        expense_id: exp.id,
        company_db: exp.company_db,
        doc_type: exp.doc_type,
        sap_doc_entry: exp.sap_doc_entry,
        sap_doc_num: sapDocNum,
        flow_total: flowTotal,
        sap_total: finding.sapTotal,
        sap_net_total: finding.sapNet,
        difference,
        abs_difference: Math.abs(difference),
        status: finding.status,
        cause: finding.cause,
        cause_label: finding.cause_label,
        cause_detail: finding.cause_detail,
        breakdown: finding.breakdown,
        checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      results.push({
        expense_id: exp.id,
        supplier_name: exp.supplier_name,
        sap_doc_num: sapDocNum,
        flow_total: flowTotal,
        sap_total: finding.sapTotal,
        difference,
        status: finding.status,
        cause: finding.cause,
        cause_label: finding.cause_label,
        cause_detail: finding.cause_detail,
      });
    }

    await fetch(`${baseUrl}/Logout`, { method: "POST", headers: { Cookie: cookies } }).catch(() => {});

    if (rowsToUpsert.length) {
      const { error: upErr } = await supabase
        .from("sap_total_reconciliation")
        .upsert(rowsToUpsert, { onConflict: "expense_id" });
      if (upErr) throw new Error(upErr.message);
    }

    const divergent = results.filter((r) => r.status === "divergent").length;
    await supabase.from("integration_log").insert({
      system_name: "sap",
      action: "expense_sap_reconcile",
      company_db: db,
      status: "ok",
      request_meta: { company_db: db, expense_id: expenseId || null, checked: results.length, actor: actorEmail },
      response_meta: { divergent, explained: results.filter((r) => r.status === "explained").length },
    }).then(() => {}, () => {});

    return json(
      {
        success: true,
        company_db: db,
        checked: results.length,
        divergent,
        explained: results.filter((r) => r.status === "explained").length,
        ok: results.filter((r) => r.status === "ok").length,
        errors: results.filter((r) => r.status === "error").length,
        results,
      },
      200,
      cors,
    );
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500, cors);
  }
});
