// Edge function: approval-daily-digest
// Lembrete diário (dias úteis, 08:00 BRT) das aprovações pendentes — ERP Flow + SAP.
// Canais: e-mail (cron approval-daily-digest) e WhatsApp (cron approval-daily-whatsapp).
// Substituições ativas redirecionam ao substituto "em nome de <titular>".
// Exige scheduler/admin. Suporta { dry_run, channels: ["email"|"whatsapp"], force }.
// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireSchedulerOrAdmin } from "../_shared/automation-auth.ts";
import { blockIfIntegrationsDisabled } from "../_shared/integrations-mode.ts";
import { logSend } from "../_shared/send-log.ts";
import { fetchHanaView, resolveHanaSchema } from "../_shared/hana-views.ts";
import { listSapUsersHybrid } from "../_shared/sap-users-hybrid.ts";
import { tryWatcherLock, releaseWatcherLock } from "../_shared/watcher-lock.ts";
import {
  buildRecipients, daysSince, dedupeAcrossSources, isBusinessDaySaoPaulo, isEmail, normKey,
  type Person, type Recipient, type ReminderDoc, type Substitution,
} from "./reminder-core.ts";

const APP_URL = (Deno.env.get("APP_PUBLIC_URL") || "https://erp-flow.cactuscorporation.com").replace(/\/+$/, "");
const WHATSAPP_URL = Deno.env.get("WHATSAPP_URL") || "http://63.177.171.140/sender_wpp";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || Deno.env.get("WHATSAPP_API_TOKEN") || "";
const SOURCE = "approval-daily-digest";
const MAX_DOCS = 2000;
const SAP_TIMEOUT_MS = 30_000;

type Channel = "email" | "whatsapp";

function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fmtMoney(value: number, currency: string): string {
  const cur = (currency || "BRL").trim().toUpperCase();
  try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: cur }).format(Number(value || 0)); }
  catch { return `${cur} ${Number(value || 0).toFixed(2)}`; }
}
function normalizePhone(p?: string | null): string {
  const d = String(p || "").replace(/\D+/g, "");
  if (!d) return "";
  return d.length === 10 || d.length === 11 ? `55${d}` : d;
}
function normalizeBaseUrl(url: string): string {
  let u = url.replace(/\/+$/, "");
  if (u.includes("/b1s/v1")) u = u.replace("/b1s/v1", "/b1s/v2");
  else if (!u.includes("/b1s/v2")) u = `${u}/b1s/v2`;
  return u;
}
function normCurrency(c?: unknown): string {
  const v = String(c ?? "").trim();
  if (!v || v === "R$") return "BRL";
  if (v === "$") return "USD";
  if (v === "€") return "EUR";
  return v.length === 3 ? v.toUpperCase() : "BRL";
}
function saoPauloDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
}

// ---------- Mensagens ----------
interface Redactor { supplier: (s: string) => string; money: (n: number, c: string) => string; name: (s: string) => string }
const plain: Redactor = { supplier: (s) => s, money: fmtMoney, name: (s) => s };
function makeRedactor(): Redactor {
  const m = new Map<string, string>();
  const names = new Map<string, string>();
  return {
    supplier: (s) => { if (!m.has(s)) m.set(s, `Fornecedor ${String.fromCharCode(65 + (m.size % 26))}`); return m.get(s)!; },
    money: (_n, c) => `${c} •••`,
    name: (s) => { if (!names.has(s)) names.set(s, `Titular ${names.size + 1}`); return names.get(s)!; },
  };
}

function docLine(d: Recipient["docs"][number], r: Redactor): string {
  const behalf = d.on_behalf_of ? ` (em nome de ${r.name(d.on_behalf_of)})` : "";
  return `${d.company_name} — ${r.supplier(d.supplier)} — ${r.money(d.amount, d.currency)} — ${d.days_open} dia(s) parado — ${d.label}${behalf}`;
}

function buildEmail(rec: Recipient, r: Redactor, greetName: string) {
  const flow = rec.docs.filter((d) => d.source === "flow");
  const sap = rec.docs.filter((d) => d.source === "sap");
  const subject = `[ERP Flow] ${rec.docs.length} aprovação(ões) pendente(s) aguardando você`;
  const section = (title: string, list: typeof rec.docs) => {
    if (!list.length) return `<h3 style="margin:18px 0 6px;font-size:15px">${esc(title)}</h3><p style="font-size:13px;color:#71717a;margin:0">Nenhuma pendência.</p>`;
    const rows = list.map((d) => `<tr>
      <td style="padding:7px 9px;border-bottom:1px solid #e4e4e7;font-size:13px">${esc(d.company_name)}</td>
      <td style="padding:7px 9px;border-bottom:1px solid #e4e4e7;font-size:13px">${esc(r.supplier(d.supplier))}<div style="color:#71717a;font-size:12px">${esc(d.label)}${d.on_behalf_of ? ` · em nome de ${esc(r.name(d.on_behalf_of))}` : ""}</div></td>
      <td style="padding:7px 9px;border-bottom:1px solid #e4e4e7;font-size:13px;white-space:nowrap">${esc(r.money(d.amount, d.currency))}</td>
      <td style="padding:7px 9px;border-bottom:1px solid #e4e4e7;font-size:13px;white-space:nowrap">${d.days_open} dia(s)</td>
      <td style="padding:7px 9px;border-bottom:1px solid #e4e4e7;font-size:13px"><a href="${esc(d.link)}" style="color:#0ea5e9;text-decoration:none">Abrir</a></td></tr>`).join("");
    return `<h3 style="margin:18px 0 6px;font-size:15px">${esc(title)} (${list.length})</h3>
      <table style="width:100%;border-collapse:collapse"><tr>
      <th align="left" style="padding:5px 9px;font-size:12px;color:#71717a">Empresa</th>
      <th align="left" style="padding:5px 9px;font-size:12px;color:#71717a">Fornecedor</th>
      <th align="left" style="padding:5px 9px;font-size:12px;color:#71717a">Valor</th>
      <th align="left" style="padding:5px 9px;font-size:12px;color:#71717a">Parado</th><th></th></tr>${rows}</table>`;
  };
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f4f5;font-family:Segoe UI,Arial,sans-serif;color:#18181b">
  <div style="max-width:760px;margin:0 auto;background:#fff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden">
    <div style="background:#18181b;color:#fff;padding:18px 24px"><div style="font-size:18px;font-weight:600">${esc(subject.replace("[ERP Flow] ", ""))}</div>
    <div style="font-size:13px;opacity:.85">Lembrete diário (dias úteis) do ERP Flow</div></div>
    <div style="padding:16px 24px"><p style="margin:0 0 8px;font-size:14px">Olá ${esc(greetName)}, estes documentos continuam aguardando sua aprovação:</p>
    ${section("ERP Flow", flow)}${section("SAP", sap)}
    <div style="margin-top:22px"><a href="${APP_URL}/aprovacoes" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px">Abrir minhas aprovações</a></div></div>
    <div style="padding:14px 24px;background:#fafafa;color:#71717a;font-size:12px;border-top:1px solid #e4e4e7">Você recebe este lembrete todo dia útil enquanto houver pendências.</div>
  </div></body></html>`;
  const text = [
    subject, `Olá ${greetName},`, "",
    `ERP Flow (${flow.length}):`, ...(flow.length ? flow.map((d) => `• ${docLine(d, r)} — Abrir: ${d.link}`) : ["• Nenhuma pendência."]), "",
    `SAP (${sap.length}):`, ...(sap.length ? sap.map((d) => `• ${docLine(d, r)} — Abrir: ${d.link}`) : ["• Nenhuma pendência."]), "",
    `${APP_URL}/aprovacoes`,
  ].join("\n");
  return { subject, html, text };
}

function buildWhatsApp(rec: Recipient, r: Redactor, greetName: string): string {
  const flow = rec.docs.filter((d) => d.source === "flow").length;
  const sap = rec.docs.length - flow;
  const lines = [
    `🔔 *Aprovações pendentes — ERP Flow*`,
    `Olá ${greetName}, você tem *${rec.docs.length}* pendência(s) (ERP Flow: ${flow} · SAP: ${sap}).`,
    "", "*5 mais antigas:*",
    ...rec.docs.slice(0, 5).map((d) => `• ${docLine(d, r)}`),
    "", `Acesse: ${APP_URL}/aprovacoes`,
  ];
  return lines.join("\n");
}

// ---------- Coleta SAP ----------
interface SapCompanyResult { company_db: string; status: "ok" | "skipped" | "error"; pending: number; error?: string }

async function sapLogin(baseUrl: string, user: string, pass: string, db: string) {
  const resp = await fetch(`${baseUrl}/Login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ UserName: user, Password: pass, CompanyDB: db }),
    signal: AbortSignal.timeout(SAP_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`Login SAP falhou: HTTP ${resp.status}`);
  const json = await resp.json();
  const routeId = (resp.headers.get("set-cookie") || "").match(/B1ROUTEID=([^;]+)/)?.[1] ?? "";
  return { sessionId: json.SessionId as string, routeId };
}
async function sapLogout(baseUrl: string, s: { sessionId: string; routeId: string }) {
  try {
    await fetch(`${baseUrl}/Logout`, {
      method: "POST", signal: AbortSignal.timeout(5000),
      headers: { Cookie: `B1SESSION=${s.sessionId}${s.routeId ? `; B1ROUTEID=${s.routeId}` : ""}` },
    });
  } catch { /* ignore */ }
}

function costCentersFromLines(raw: unknown): string[] {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return Array.from(new Set(parsed.map((l: any) => String(l?.CostingCode || "").trim()).filter(Boolean)));
  } catch { return []; }
}

async function collectSap(
  sb: any, company: { company_db: string; display_name: string }, creds: Record<string, string>, now: Date,
  phoneByAlias: Map<string, string>,
): Promise<{ docs: ReminderDoc[]; result: SapCompanyResult }> {
  const result: SapCompanyResult = { company_db: company.company_db, status: "ok", pending: 0 };
  if (creds.use_hana_db === "false") return { docs: [], result: { ...result, status: "skipped", error: "HANA desabilitado" } };
  if (!creds.username || !creds.password || !creds.service_layer_url) return { docs: [], result: { ...result, status: "skipped", error: "Credenciais SAP incompletas" } };
  if (creds.username.trim().toLowerCase() !== "apiuser") return { docs: [], result: { ...result, status: "skipped", error: "Usuário SAP não é Apiuser" } };
  const baseUrl = normalizeBaseUrl(creds.service_layer_url);
  const dbName = creds.company_db || company.company_db;
  let session: { sessionId: string; routeId: string };
  try { session = await sapLogin(baseUrl, creds.username, creds.password, dbName); }
  catch (e) { return { docs: [], result: { ...result, status: "error", error: (e as Error).message } }; }
  try {
    const [rows, users] = await Promise.all([
      fetchHanaView({ schema: resolveHanaSchema(company.company_db, dbName), view: "VW_APROVACOES_DETALHADAS", sessionId: session.sessionId, hanaApiUrl: creds.hana_api_url, timeoutMs: 90_000 }),
      listSapUsersHybrid({ sb, companyDb: company.company_db, baseUrl, sapSession: session, database: dbName, needsPhone: true })
        .catch(() => ({ users: [] as any[], source: "hana" as const })),
    ]);
    for (const u of users.users) {
      const phone = normalizePhone(u.MobilePhoneNumber);
      if (!phone) continue;
      for (const a of [u.UserCode, u.eMail]) { const k = normKey(a); if (k && !phoneByAlias.has(k)) phoneByAlias.set(k, phone); }
    }
    const docs: ReminderDoc[] = [];
    for (const row of rows as any[]) {
      const code = Number(row.Code || 0);
      if (code <= 0) continue;
      const currency = normCurrency(row["Código da moeda original"]);
      const orig = Number(row["Valor do documento na moeda original"] || 0);
      const amount = currency !== "BRL" && orig > 0 ? orig : Number(row["Valor total"] || 0);
      const draft = Number(row["Draft DocEntry"] || 0) || null;
      const finalPo = Number(row["Nº pedido de compra"] || 0) || null;
      const days = Number.isFinite(Number(row["Dias em aberto"])) && row["Dias em aberto"] != null
        ? Number(row["Dias em aberto"]) : daysSince(row["Data de criação"], now);
      const keys = [row["Email do aprovador"], row.Aprovador].map(normKey).filter(Boolean);
      docs.push({
        key: `sap::${company.company_db}::${code}`,
        source: "sap", company_db: company.company_db, company_name: company.display_name,
        supplier: String(row["Fornecedor / Parceiro"] || "—"), amount, currency, days_open: days,
        label: finalPo ? `Pedido #${finalPo}` : `Esboço #${draft ?? (row["Nº do documento"] || code)}`,
        link: `${APP_URL}/aprovacoes?doc=${encodeURIComponent(`sap:${code}`)}`,
        cost_centers: costCentersFromLines(row.DocumentLines),
        approver_keys: keys, sap_draft_entry: draft,
      });
    }
    result.pending = docs.length;
    return { docs, result };
  } catch (e) {
    return { docs: [], result: { ...result, status: "error", error: (e as Error).message } };
  } finally {
    await sapLogout(baseUrl, session);
  }
}

// ---------- Handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const auth = await requireSchedulerOrAdmin(req, corsHeaders);
  if (!auth.ok) return auth.response!;
  const blocked = blockIfIntegrationsDisabled(corsHeaders);
  if (blocked) return blocked;
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let body: any = {};
  try { body = await req.json(); } catch { /* sem corpo */ }
  const dryRun = body?.dry_run === true;
  const channels: Channel[] = Array.isArray(body?.channels)
    ? (body.channels as unknown[]).filter((c): c is Channel => c === "email" || c === "whatsapp")
    : ["email"];
  if (!channels.length) return json({ ok: false, error: "channels inválido" }, 400);
  const now = new Date();
  if (!isBusinessDaySaoPaulo(now) && body?.force !== true && !dryRun) {
    return json({ ok: true, skipped: "fim_de_semana" });
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const lockName = `${SOURCE}:${channels.join("+")}`;
  if (!dryRun && !(await tryWatcherLock(sb, lockName, 20))) return json({ ok: true, skipped: "another_run_in_progress" });

  try {
    const { data: companies, error: cErr } = await sb.from("companies")
      .select("company_db, display_name, erp_type, is_active, is_test");
    if (cErr) throw cErr;
    const all = (companies || []) as Array<{ company_db: string; display_name: string; erp_type: string; is_active: boolean; is_test: boolean }>;
    const prod = all.filter((c) => !c.is_test);
    const nameByDb = new Map(all.map((c) => [c.company_db, c.display_name || c.company_db]));
    const prodDbs = new Set(prod.map((c) => c.company_db));

    // Flow
    const { data: exp, error: eErr } = await sb.from("expenses")
      .select("id, company_db, supplier_name, total_amount, currency, created_at, current_approver, cost_center, sap_doc_entry")
      .eq("status", "pendente_aprovacao").limit(MAX_DOCS);
    if (eErr) throw eErr;
    const flowDocs: ReminderDoc[] = ((exp || []) as any[])
      .filter((d) => d.current_approver && prodDbs.has(d.company_db))
      .map((d) => ({
        key: `flow::${d.id}`, source: "flow" as const, company_db: d.company_db,
        company_name: nameByDb.get(d.company_db) || d.company_db,
        supplier: d.supplier_name || "—", amount: Number(d.total_amount || 0), currency: normCurrency(d.currency),
        days_open: daysSince(d.created_at, now), label: `Pedido ERP Flow #${String(d.id).slice(0, 8).toUpperCase()}`,
        link: `${APP_URL}/aprovacoes?doc=${encodeURIComponent(`internal:${d.id}`)}`,
        cost_centers: d.cost_center ? [String(d.cost_center)] : [],
        approver_keys: String(d.current_approver).split("/").map(normKey).filter((v) => v && v !== "administrador"),
        sap_draft_entry: Number(d.sap_doc_entry || 0) || null,
      }));

    // SAP (empresas SAP ativas de produção)
    const sapCos = prod.filter((c) => c.is_active && c.erp_type === "sap");
    const { data: credRows } = await sb.from("system_credentials_v")
      .select("company_db, credential_key, credential_value").eq("system_name", "sap")
      .in("company_db", sapCos.length ? sapCos.map((c) => c.company_db) : [""]);
    const credBy = new Map<string, Record<string, string>>();
    for (const r of (credRows || []) as any[]) {
      if (!r.company_db) continue;
      const m = credBy.get(r.company_db) || {};
      m[r.credential_key] = r.credential_value;
      credBy.set(r.company_db, m);
    }
    const sapPhone = new Map<string, string>();
    const sapRuns = await Promise.all(sapCos.map((c) => collectSap(sb, c, credBy.get(c.company_db) || {}, now, sapPhone)));
    const sapDocs = sapRuns.flatMap((r) => r.docs);
    const docs = dedupeAcrossSources(flowDocs, sapDocs);

    // Diretório de identidades
    const { data: dir } = await sb.from("sap_user_directory").select("user_key, sap_user_code, display_name, is_active").limit(10000);
    const { data: mails } = await sb.from("sap_user_emails").select("user_key, email, is_primary").limit(20000);
    const mailByKey = new Map<string, string>();
    for (const m of (mails || []) as any[]) {
      if (!m.email || !isEmail(m.email)) continue;
      if (!mailByKey.has(m.user_key) || m.is_primary) mailByKey.set(m.user_key, normKey(m.email));
    }
    const personByAlias = new Map<string, Person>();
    for (const row of ((dir || []) as any[]).filter((r) => r.is_active !== false)) {
      const email = row.user_key ? mailByKey.get(row.user_key) || null : null;
      const aliases = new Set<string>([row.sap_user_code, row.display_name, row.user_key, email].map(normKey).filter(Boolean));
      const dn = String(row.display_name || "").trim().split(/\s+/);
      if (dn.length > 1) aliases.add(normKey(`${dn[0]} ${dn[dn.length - 1]}`));
      if (email) aliases.add(email.split("@")[0]);
      const p: Person = { key: email || normKey(row.user_key || row.sap_user_code), email, name: row.display_name || row.sap_user_code || "", codes: Array.from(aliases) };
      for (const a of aliases) {
        const prev = personByAlias.get(a);
        if (!prev || (!prev.email && p.email)) personByAlias.set(a, p);
      }
    }
    const resolve = (k: string): Person | null => {
      const key = normKey(k);
      if (!key) return null;
      const hit = personByAlias.get(key) || (key.includes("@") ? personByAlias.get(key.split("@")[0]) : undefined);
      if (hit) return hit;
      if (isEmail(key)) return { key, email: key, name: key.split("@")[0], codes: [key, key.split("@")[0]] };
      return null;
    };

    const { data: subsRaw } = await sb.from("approver_substitutes")
      .select("company_db, official_email, official_name, substitute_email, substitute_name, cost_center_prefixes, starts_at, ends_at")
      .is("revoked_at", null).lte("starts_at", now.toISOString()).gt("ends_at", now.toISOString());
    const subs = (subsRaw || []) as Substitution[];
    const { recipients, unresolved, redirected } = buildRecipients(docs, resolve, subs);

    // Telefones: user_phones (manual) > SAP MobilePhoneNumber
    const { data: phoneRows } = await sb.from("user_phones").select("user_code, phone").limit(10000);
    const manualPhone = new Map<string, string>();
    for (const r of (phoneRows || []) as any[]) { const p = normalizePhone(r.phone); if (p) manualPhone.set(normKey(r.user_code), p); }
    const phoneFor = (p: Person) => {
      for (const c of p.codes) if (manualPhone.get(c)) return manualPhone.get(c)!;
      for (const c of p.codes) if (sapPhone.get(c)) return sapPhone.get(c)!;
      return "";
    };

    const today = saoPauloDay(now);
    const alreadySent = async (channel: Channel, recipient: string) => {
      const { data } = await sb.from("message_send_log").select("id")
        .eq("source", SOURCE).eq("channel", channel).eq("recipient", recipient).eq("status", "sent")
        .gte("created_at", `${today}T00:00:00-03:00`).limit(1);
      return (data || []).length > 0;
    };

    const stats: Record<string, any> = {
      business_day: isBusinessDaySaoPaulo(now), approvers: recipients.length,
      docs_flow: flowDocs.length, docs_sap: sapDocs.length, docs_total_dedup: docs.length,
      sap_removed_as_flow_duplicate: flowDocs.length + sapDocs.length - docs.length,
      redirected_to_substitute: redirected,
      recipients_with_substitute_docs: recipients.filter((r) => r.docs.some((d) => d.on_behalf_of)).length,
      unresolved_approver_keys: unresolved.length,
      sap_companies: sapRuns.map((r) => r.result),
    };
    if (channels.includes("email")) {
      const noEmail = recipients.filter((r) => !r.person.email);
      stats.email = { would_send: recipients.length - noEmail.length, no_email: noEmail.length, no_email_list: noEmail.map((r) => r.person.name), sent: 0, skipped_already_sent: 0, errors: 0 };
    }
    if (channels.includes("whatsapp")) {
      const noPhone = recipients.filter((r) => !phoneFor(r.person));
      stats.whatsapp = { would_send: recipients.length - noPhone.length, no_phone: noPhone.length, no_phone_list: noPhone.map((r) => r.person.name), sent: 0, skipped_already_sent: 0, errors: 0, token_configured: !!WHATSAPP_TOKEN };
    }

    if (dryRun) {
      const top = [...recipients].sort((a, b) => b.docs.length - a.docs.length)[0];
      const preview: Record<string, unknown> = {};
      if (top) {
        const red = makeRedactor();
        if (channels.includes("email")) { const e = buildEmail(top, red, "Aprovador"); preview.email = { subject: e.subject, text: e.text }; }
        if (channels.includes("whatsapp")) preview.whatsapp = buildWhatsApp(top, red, "Aprovador");
        preview.docs_of_top = top.docs.length;
      }
      return json({ ok: true, dryRun: true, channels, ...stats, preview });
    }

    for (const rec of recipients) {
      const greet = rec.person.name || "aprovador(a)";
      const meta = { docs: rec.docs.length, flow: rec.docs.filter((d) => d.source === "flow").length, sap: rec.docs.filter((d) => d.source === "sap").length, on_behalf: Array.from(new Set(rec.docs.map((d) => d.on_behalf_of).filter(Boolean))) };
      if (channels.includes("email") && rec.person.email) {
        if (await alreadySent("email", rec.person.email)) { stats.email.skipped_already_sent++; }
        else {
          const m = buildEmail(rec, plain, greet);
          try {
            const { error } = await sb.functions.invoke("send-smtp-email", { body: { to: [rec.person.email], subject: m.subject, html: m.html, text: m.text } });
            if (error) throw error;
            stats.email.sent++;
            await logSend({ channel: "email", recipient: rec.person.email, status: "sent", subject: m.subject, source: SOURCE, entityType: "approval_reminder", metadata: meta });
          } catch (e) {
            stats.email.errors++;
            await logSend({ channel: "email", recipient: rec.person.email, status: "failed", subject: m.subject, source: SOURCE, errorMessage: (e as Error).message, entityType: "approval_reminder", metadata: meta });
          }
        }
      }
      if (channels.includes("whatsapp")) {
        const phone = phoneFor(rec.person);
        if (!phone) continue;
        if (await alreadySent("whatsapp", phone)) { stats.whatsapp.skipped_already_sent++; continue; }
        const msg = buildWhatsApp(rec, plain, greet);
        if (!WHATSAPP_TOKEN) { stats.whatsapp.errors++; await logSend({ channel: "whatsapp", recipient: phone, status: "skipped", subject: msg.slice(0, 120), source: SOURCE, errorMessage: "WHATSAPP_TOKEN ausente", entityType: "approval_reminder", metadata: meta }); continue; }
        try {
          const resp = await fetch(WHATSAPP_URL, {
            method: "POST", signal: AbortSignal.timeout(15_000),
            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ to: phone, message: msg }).toString(),
          });
          const txt = await resp.text().catch(() => "");
          if (resp.ok) stats.whatsapp.sent++; else stats.whatsapp.errors++;
          await logSend({ channel: "whatsapp", recipient: phone, status: resp.ok ? "sent" : "failed", subject: msg.slice(0, 120), source: SOURCE, errorMessage: resp.ok ? null : `${resp.status} ${txt.slice(0, 200)}`, entityType: "approval_reminder", metadata: meta });
        } catch (e) {
          stats.whatsapp.errors++;
          await logSend({ channel: "whatsapp", recipient: phone, status: "failed", subject: msg.slice(0, 120), source: SOURCE, errorMessage: (e as Error).message, entityType: "approval_reminder", metadata: meta });
        }
      }
    }

    const sent = (stats.email?.sent || 0) + (stats.whatsapp?.sent || 0);
    const errs = (stats.email?.errors || 0) + (stats.whatsapp?.errors || 0);
    await sb.from("notification_send_runs").insert({
      function_name: `${SOURCE}:${channels.join("+")}`,
      status: errs ? (sent ? "partial" : "error") : "success",
      recipients_count: sent, error_message: null, details: stats,
    });
    await releaseWatcherLock(sb, lockName, errs && !sent ? "error" : "ok", `sent=${sent}`);
    return json({ ok: true, dryRun: false, channels, ...stats });
  } catch (e) {
    if (!dryRun) await releaseWatcherLock(sb, lockName, "error", (e as Error).message);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
