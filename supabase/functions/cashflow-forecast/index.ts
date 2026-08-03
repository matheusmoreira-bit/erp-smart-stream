// Edge function: cashflow-forecast
// Consolida Contas a Pagar (cache VW_FIN_ANALISE_FLUXO) e Contas a Receber
// (Invoices do SAP Service Layer) por data de vencimento, com quebra por
// centro de custo / projeto e comparação previsto × realizado.
//
// Body: { company_db: string, from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
// Resposta: { ap: Row[], ar: Row[], ar_source: "sap" | "unavailable", ar_note?: string }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders as baseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireAdminOrSapModule, authErrorResponse } from "../_shared/auth.ts";
import { buildSapBaseUrl, loadSapCreds, sapSessionLogin, sapLogoutSession } from "../_shared/sap-cache.ts";

const corsHeaders = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-company-db, x-sap-session, x-sap-username, x-sap-routeid, x-sap-baseurl, x-csrf-token",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface FlowRow {
  kind: "ap" | "ar";
  key: string;
  party: string | null;
  description: string | null;
  cost_center: string | null;
  project: string | null;
  due_date: string | null;
  amount: number;
  paid_date: string | null;
  paid_amount: number;
  doc_ref: string | null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function dayOnly(v: string | null): string | null {
  if (!v) return null;
  return String(v).slice(0, 10);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    await requireAdminOrSapModule(req, "financial_review");
  } catch (err) {
    return authErrorResponse(err, corsHeaders) ?? json({ error: "Acesso negado" }, 403);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const companyDb = typeof body.company_db === "string" ? body.company_db.trim() : "";
    const from = typeof body.from === "string" ? body.from.trim() : "";
    const to = typeof body.to === "string" ? body.to.trim() : "";

    if (!companyDb || !DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
      return json({ error: "Parâmetros inválidos: informe company_db, from e to (YYYY-MM-DD)." }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ---------- Contas a pagar (cache do fluxo financeiro) ----------
    const ap: FlowRow[] = [];
    {
      const { data, error } = await admin
        .from("sap_fluxo_analise_cache")
        .select(
          "flow_key, fornecedor, descricao, centro_custo, marca, valor, data_vencimento, data_pagamento, id_pedido, id_nf, id_cp",
        )
        .eq("company_db", companyDb)
        .gte("data_vencimento", `${from}T00:00:00Z`)
        .lte("data_vencimento", `${to}T23:59:59Z`)
        .limit(20000);
      if (error) throw new Error(`Contas a pagar: ${error.message}`);
      for (const r of data || []) {
        const amount = Number(r.valor) || 0;
        if (!amount) continue;
        const paidDate = dayOnly(r.data_pagamento as string | null);
        ap.push({
          kind: "ap",
          key: String(r.flow_key),
          party: r.fornecedor ?? null,
          description: r.descricao ?? null,
          cost_center: r.centro_custo ?? null,
          project: r.marca ?? null,
          due_date: dayOnly(r.data_vencimento as string | null),
          amount,
          paid_date: paidDate,
          paid_amount: paidDate ? amount : 0,
          doc_ref: (r.id_cp as string) || (r.id_nf as string) || (r.id_pedido as string) || null,
        });
      }
    }

    // ---------- Contas a receber (SAP Service Layer / Invoices) ----------
    const ar: FlowRow[] = [];
    let arSource: "sap" | "unavailable" = "unavailable";
    let arNote: string | undefined;

    const creds = await loadSapCreds(admin as never, companyDb, { requireApiuser: true });
    if (!creds) {
      arNote = "Contas a receber indisponível: a empresa não possui credencial Apiuser configurada.";
    } else {
      const baseUrl = buildSapBaseUrl(creds.service_layer_url);
      let session: { sessionId: string; routeId: string } | null = null;
      try {
        session = await sapSessionLogin(baseUrl, companyDb, creds.username, creds.password);
        const cookie = `B1SESSION=${session.sessionId}${session.routeId ? `; B1ROUTEID=${session.routeId}` : ""}`;
        const select =
          "DocEntry,DocNum,CardCode,CardName,DocDate,DocDueDate,DocTotal,PaidToDate,DocumentStatus,Comments,Project";
        const filter =
          `DocDueDate ge '${from}' and DocDueDate le '${to}' and Cancelled eq 'tNO'`;
        let next: string | null =
          `${baseUrl}/Invoices?$select=${encodeURIComponent(select)}&$filter=${encodeURIComponent(filter)}&$orderby=DocDueDate`;
        let pages = 0;
        while (next && pages < 20) {
          const res: Response = await fetch(next, {
            headers: { Cookie: cookie, Prefer: "odata.maxpagesize=200" },
          });
          if (!res.ok) {
            throw new Error(`SAP Invoices [${res.status}]: ${(await res.text().catch(() => "")).slice(0, 300)}`);
          }
          const page = await res.json();
          for (const inv of page.value || []) {
            const total = Number(inv.DocTotal) || 0;
            if (!total) continue;
            const paid = Number(inv.PaidToDate) || 0;
            const settled = inv.DocumentStatus === "bost_Close" || paid >= total - 0.005;
            ar.push({
              kind: "ar",
              key: `AR:${inv.DocEntry}`,
              party: inv.CardName || inv.CardCode || null,
              description: (inv.Comments || "").slice(0, 160) || null,
              cost_center: null,
              project: inv.Project || null,
              due_date: dayOnly(inv.DocDueDate),
              amount: total,
              paid_date: settled ? dayOnly(inv.DocDueDate) : null,
              paid_amount: paid || (settled ? total : 0),
              doc_ref: inv.DocNum ? String(inv.DocNum) : null,
            });
          }
          const link = page["odata.nextLink"] || page["@odata.nextLink"];
          next = link ? (String(link).startsWith("http") ? String(link) : `${baseUrl}/${String(link).replace(/^\/+/, "")}`) : null;
          pages++;
        }
        arSource = "sap";
      } catch (e) {
        arNote = `Contas a receber indisponível: ${e instanceof Error ? e.message : String(e)}`;
      } finally {
        if (session) { try { await sapLogoutSession(baseUrl, session); } catch { /* ignore */ } }
      }
    }

    return json({ ap, ar, ar_source: arSource, ar_note: arNote });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
