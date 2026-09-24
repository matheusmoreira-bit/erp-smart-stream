// pagcorp-settlement-candidates
//
// Detecta pedidos de compra originados do PagCorp que já têm NF de Entrada
// lançada, mas ainda não têm baixa (pagamento em Contas a Pagar), usando a
// consulta de relacionamentos PC → NF → CP (cache sap_po_nf_cp_cache,
// sincronizado a cada 15 min por sap-po-nf-cp-sync).
//
// NÃO efetua baixa: apenas notifica os responsáveis sobre os pedidos NOVOS
// que poderiam ser baixados. Cron: a cada 30 min.
// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireSchedulerOrAdmin } from "../_shared/automation-auth.ts";
import { sendWhatsApp } from "../_shared/pagcorp-settlement-notify.ts";
import { logSend } from "../_shared/send-log.ts";

const RECIPIENTS: Array<{ user: string; email: string; whatsapp?: string }> = [
  { user: "ronaldo.silva", email: "ronaldo.silva@anagaming.com.br", whatsapp: "5531998110774" },
  { user: "matheus.moreira", email: "matheus.moreira@anagaming.com.br", whatsapp: "5531972665309" },
];
const SOURCE = "pagcorp-settlement-candidates";
const CHUNK = 150;

interface Candidate {
  company_db: string;
  po: string;
  nfs: string[];
  vendor: string | null;
  amount: number;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const brl = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);

async function sendEmail(to: string, subject: string, html: string) {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  try {
    const res = await fetch(`${url}/functions/v1/send-smtp-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
      body: JSON.stringify({ to: [to], subject, html }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const auth = await requireSchedulerOrAdmin(req, corsHeaders);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dry_run === true; // não envia nem registra

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // 1) Pedidos de compra gerados a partir do PagCorp
  const logs: Array<{ company_db: string; sap_doc_num: number }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("pagcorp_integration_log")
      .select("company_db,sap_doc_num,integration_type,settlement_status")
      .eq("status", "success")
      .not("sap_doc_num", "is", null)
      .neq("integration_type", "journal_entry")
      .range(from, from + 999);
    if (error) return json({ error: error.message }, 500);
    for (const r of data || []) {
      if (r.settlement_status === "settled") continue;
      if (/^(sbo_teste|tst_)/i.test(r.company_db)) continue;
      logs.push({ company_db: r.company_db, sap_doc_num: r.sap_doc_num });
    }
    if (!data || data.length < 1000) break;
  }

  const byCompany = new Map<string, Set<string>>();
  for (const l of logs) {
    if (!byCompany.has(l.company_db)) byCompany.set(l.company_db, new Set());
    byCompany.get(l.company_db)!.add(String(l.sap_doc_num));
  }

  // 2) Relacionamentos PC → NF → CP
  const candidates: Candidate[] = [];
  for (const [companyDb, poSet] of byCompany) {
    const pos = [...poSet];
    const rows: any[] = [];
    for (let i = 0; i < pos.length; i += CHUNK) {
      const { data, error } = await sb
        .from("sap_po_nf_cp_cache")
        .select("id_pedido_compra,id_nf_entrada,numero_nota_fiscal,id_contas_pagar,data_pagamento,nome_fornecedor,valor,referencia_valor")
        .eq("company_db", companyDb)
        .in("id_pedido_compra", pos.slice(i, i + CHUNK));
      if (error) return json({ error: error.message }, 500);
      rows.push(...(data || []));
    }
    const grouped = new Map<string, any[]>();
    for (const r of rows) {
      const k = String(r.id_pedido_compra);
      if (!grouped.has(k)) grouped.set(k, []);
      grouped.get(k)!.push(r);
    }
    for (const [po, rs] of grouped) {
      const withNf = rs.filter((r) => r.id_nf_entrada);
      if (withNf.length === 0) continue;
      if (rs.some((r) => r.id_contas_pagar || r.data_pagamento)) continue; // já tem baixa
      const nfs = [...new Set(withNf.map((r) => String(r.numero_nota_fiscal ?? r.id_nf_entrada)))];
      const aPagar = withNf.filter((r) => /a pagar/i.test(r.referencia_valor || ""));
      const amount = (aPagar.length ? aPagar : withNf).reduce((s, r) => s + Number(r.valor || 0), 0);
      candidates.push({ company_db: companyDb, po, nfs, vendor: withNf[0].nome_fornecedor ?? null, amount: +amount.toFixed(2) });
    }
  }

  // 3) Só notifica pedidos ainda não avisados
  const { data: notices, error: nErr } = await sb
    .from("pagcorp_settlement_candidate_notices")
    .select("company_db,po_doc_num,resolved_at");
  if (nErr) return json({ error: nErr.message }, 500);
  const known = new Set((notices || []).filter((n) => !n.resolved_at).map((n) => `${n.company_db}|${n.po_doc_num}`));
  const current = new Set(candidates.map((c) => `${c.company_db}|${c.po}`));
  const fresh = candidates.filter((c) => !known.has(`${c.company_db}|${c.po}`));

  if (dryRun) {
    return json({ ok: true, dry_run: true, candidates: candidates.length, new: fresh.length, sample: fresh.slice(0, 20) });
  }

  const now = new Date().toISOString();
  // Marca como resolvidos os que deixaram de ser candidatos (baixados)
  const resolved = (notices || []).filter((n) => !n.resolved_at && !current.has(`${n.company_db}|${n.po_doc_num}`));
  for (const n of resolved) {
    await sb.from("pagcorp_settlement_candidate_notices").update({ resolved_at: now })
      .eq("company_db", n.company_db).eq("po_doc_num", n.po_doc_num);
  }
  if (candidates.length) {
    await sb.from("pagcorp_settlement_candidate_notices").upsert(
      candidates.map((c) => ({
        company_db: c.company_db, po_doc_num: c.po, nf_doc_nums: c.nfs, vendor_name: c.vendor,
        amount: c.amount, last_seen_at: now, resolved_at: null,
        ...(known.has(`${c.company_db}|${c.po}`) ? {} : { first_notified_at: now }),
      })),
      { onConflict: "company_db,po_doc_num" },
    );
  }

  if (fresh.length === 0) {
    return json({ ok: true, candidates: candidates.length, new: 0, resolved: resolved.length });
  }

  // 4) Notificação (e-mail para todos; WhatsApp quando cadastrado)
  const total = fresh.reduce((s, c) => s + c.amount, 0);
  const perCompany = new Map<string, { n: number; v: number }>();
  for (const c of fresh) {
    const p = perCompany.get(c.company_db) || { n: 0, v: 0 };
    p.n++; p.v += c.amount;
    perCompany.set(c.company_db, p);
  }
  const subject = `ERP Flow — ${fresh.length} pedido(s) PagCorp com NF de Entrada prontos para baixa`;
  const rowsHtml = fresh
    .sort((a, b) => a.company_db.localeCompare(b.company_db) || Number(a.po) - Number(b.po))
    .map((c) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #e2e8f0">${esc(c.company_db)}</td><td style="padding:4px 8px;border-bottom:1px solid #e2e8f0">${esc(c.po)}</td><td style="padding:4px 8px;border-bottom:1px solid #e2e8f0">${esc(c.nfs.join(", "))}</td><td style="padding:4px 8px;border-bottom:1px solid #e2e8f0">${esc(c.vendor)}</td><td style="padding:4px 8px;border-bottom:1px solid #e2e8f0;text-align:right">${esc(brl(c.amount))}</td></tr>`)
    .join("");
  const html = `<div style="font-family:Arial,sans-serif;color:#0f172a;max-width:900px">
    <h2 style="margin:0 0 8px">Pedidos PagCorp prontos para baixa</h2>
    <p style="font-size:14px;color:#334155">Os pedidos abaixo, gerados a partir do PagCorp, já têm NF de Entrada lançada no ERP e ainda não têm baixa em Contas a Pagar. <strong>Nenhuma baixa foi feita automaticamente.</strong></p>
    <p style="font-size:14px">Total: <strong>${fresh.length}</strong> pedido(s) · <strong>${esc(brl(total))}</strong></p>
    <table style="border-collapse:collapse;font-size:13px;width:100%"><thead><tr style="background:#f1f5f9">
      <th style="padding:6px 8px;text-align:left">Empresa</th><th style="padding:6px 8px;text-align:left">Pedido</th><th style="padding:6px 8px;text-align:left">NF de Entrada</th><th style="padding:6px 8px;text-align:left">Fornecedor</th><th style="padding:6px 8px;text-align:right">Valor</th>
    </tr></thead><tbody>${rowsHtml}</tbody></table>
    <p style="margin-top:24px;font-size:12px;color:#94a3b8">Mensagem automática do ERP Flow (verificação a cada 30 min).</p></div>`;
  const wppMsg =
    `*ERP Flow — Pedidos PagCorp prontos para baixa*\n` +
    `${fresh.length} novo(s) pedido(s) com NF de Entrada e sem baixa · ${brl(total)}\n` +
    [...perCompany].map(([k, v]) => `• ${k}: ${v.n} (${brl(v.v)})`).join("\n") +
    `\nDetalhes enviados por e-mail. Nenhuma baixa foi feita automaticamente.`;

  const sent: Record<string, unknown>[] = [];
  for (const r of RECIPIENTS) {
    const ok = await sendEmail(r.email, subject, html);
    sent.push({ user: r.user, channel: "email", ok });
    if (r.whatsapp) {
      const w = await sendWhatsApp(r.whatsapp, wppMsg);
      sent.push({ user: r.user, channel: "whatsapp", ok: w.ok });
      await logSend({
        channel: "whatsapp", recipient: r.whatsapp, status: w.ok ? "sent" : "failed",
        subject: "Pedidos PagCorp prontos para baixa", source: SOURCE,
        errorMessage: w.ok ? null : String((w as any).error || w.status),
        entityType: "pagcorp_settlement_candidates", metadata: { count: fresh.length },
      });
    }
  }

  return json({ ok: true, candidates: candidates.length, new: fresh.length, resolved: resolved.length, sent });
});
