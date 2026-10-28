// Leitura "Minhas decisões": identidade, empresas e período resolvidos no
// servidor. Os aliases NUNCA vêm do cliente — saem do JWT/sessão SAP.
import { readDirectory } from "./document-backfill.ts";
import { rawOf, reconcileDecisions } from "./document-reconciliation.ts";
import type { createClient } from "npm:@supabase/supabase-js@2";

type Db = ReturnType<typeof createClient>;
export const MY_DECISIONS_MAX_ROWS = 5000;
const PAGE = 1000;

const norm = (v: unknown) => (v == null ? "" : String(v)).trim().toLowerCase();
// Remove caracteres com significado no filtro or()/in() do PostgREST.
const safe = (v: string) => v.replace(/[,()*%"\\]/g, "");

export interface ResolvedIdentity { emails: string[]; aliases: string[] }

/** Une e-mails, partes locais, códigos SAP e nomes em listas sem duplicatas. */
export function buildAliases(emails: string[], codes: string[], names: string[]): ResolvedIdentity {
  const e = Array.from(new Set(emails.map(norm).filter((x) => x.includes("@")).map(safe)));
  const all = new Set<string>(e);
  for (const x of e) all.add(x.split("@")[0]);
  for (const x of [...codes, ...names].map(norm).map(safe)) if (x) all.add(x);
  return { emails: e, aliases: Array.from(all) };
}

export async function resolveIdentity(db: Db, email: string | null, sapUser: string | null): Promise<ResolvedIdentity> {
  const seeds = [email, sapUser].map(norm).filter(Boolean);
  const keys = new Set<string>();
  for (const s of seeds) {
    const { data } = await db.rpc("canonical_user_key", { _value: s });
    if (typeof data === "string" && data) keys.add(data);
  }
  const seedEmails = seeds.filter((s) => s.includes("@"));
  if (seedEmails.length) {
    const { data } = await db.from("sap_user_emails").select("user_key").in("email", seedEmails);
    for (const r of (data || []) as Array<{ user_key: string }>) keys.add(r.user_key);
  }
  if (sapUser) {
    const { data } = await db.from("sap_user_directory").select("user_key").ilike("sap_user_code", safe(norm(sapUser)));
    for (const r of (data || []) as Array<{ user_key: string }>) keys.add(r.user_key);
  }
  const emails = [...seedEmails];
  const codes: string[] = sapUser ? [sapUser] : [];
  const names: string[] = [];
  if (keys.size) {
    const k = Array.from(keys);
    const [{ data: em }, { data: dir }] = await Promise.all([
      db.from("sap_user_emails").select("email").in("user_key", k),
      db.from("sap_user_directory").select("sap_user_code,display_name").in("user_key", k),
    ]);
    for (const r of (em || []) as Array<{ email: string }>) emails.push(r.email);
    for (const r of (dir || []) as Array<{ sap_user_code: string | null; display_name: string | null }>) {
      if (r.sap_user_code) codes.push(r.sap_user_code);
      if (r.display_name) names.push(r.display_name);
    }
  }
  return buildAliases(emails, codes, names);
}

/** Valida datas ISO vindas do cliente (somente o intervalo; nunca identidade). */
export function parseRange(from: unknown, to: unknown): { from: string | null; to: string | null } {
  const ok = (v: unknown) => {
    if (typeof v !== "string" || !v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };
  return { from: ok(from), to: ok(to) };
}

async function paged<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, cap: number) {
  const out: T[] = [];
  for (let off = 0; off < cap + 1; off += PAGE) {
    const { data, error } = await build(off, Math.min(off + PAGE, cap + 1) - 1);
    if (error) throw new Error(error.message);
    const rows = (data || []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function listMyDecisions(db: Db, opts: {
  identity: ResolvedIdentity; companies: string[]; from: string | null; to: string | null; decision: "all" | "Y" | "N";
}) {
  const { identity, companies, from, to, decision } = opts;
  if (!identity.aliases.length || !companies.length) {
    return { sapRows: [], logRows: [], expenses: [], auditRows: [], truncated: false };
  }
  const cap = MY_DECISIONS_MAX_ROWS;
  const sapOr = ["approver_email", "approver_code", "approver_name"]
    .flatMap((f) => identity.aliases.map((a) => `${f}.ilike.${a}`)).join(",");

  const sapRows = await paged<Record<string, unknown>>((a, b) => {
    let q = db.from("approval_history").select("*").in("company_db", companies).is("raw->>superseded_by", null)
      .in("decision", decision === "all" ? ["Y", "N"] : [decision]).or(sapOr)
      .order("decision_date", { ascending: false, nullsFirst: false }).order("id").range(a, b);
    if (from) q = q.gte("decision_date", from);
    if (to) q = q.lte("decision_date", to);
    return q;
  }, cap);

  const emailOr = identity.emails.map((e) => `approver_email.ilike.${e}`).join(",");
  const logRows = identity.emails.length ? await paged<Record<string, unknown>>((a, b) => {
    let q = db.from("expense_approval_log").select("*").or(emailOr)
      .in("decision", decision === "Y" ? ["approved"] : decision === "N" ? ["rejected"] : ["approved", "rejected"])
      .order("decided_at", { ascending: false, nullsFirst: false }).order("id").range(a, b);
    if (from) q = q.gte("decided_at", from);
    if (to) q = q.lte("decided_at", to);
    return q;
  }, cap) : [];

  const ids = Array.from(new Set(logRows.map((l) => l.expense_id as string).filter(Boolean)));
  const expenses: Record<string, unknown>[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from("expenses")
      .select("id, supplier_code, supplier_name, total_amount, currency, sap_doc_entry, sap_doc_num, doc_type, requester_name, requester_email, company_db, created_at")
      .in("id", ids.slice(i, i + 200)).in("company_db", companies);
    if (error) throw new Error(error.message);
    expenses.push(...((data || []) as Record<string, unknown>[]));
  }
  const inCompany = new Set(expenses.map((e) => e.id as string));
  const scopedLog = logRows.filter((l) => inCompany.has(l.expense_id as string));

  const actorOr = identity.emails.map((e) => `actor_email.ilike.${e}`).join(",");
  const auditRows = identity.emails.length ? await paged<Record<string, unknown>>((a, b) => {
    let q = db.from("audit_log").select("id, action, entity_id, actor_email, created_at, details, company_db")
      .eq("entity_type", "approval_request").or(actorOr).in("company_db", companies)
      .in("action", decision === "Y" ? ["approve"] : decision === "N" ? ["reject"] : ["approve", "reject"])
      .order("created_at", { ascending: false }).order("id").range(a, b);
    if (from) q = q.gte("created_at", from);
    if (to) q = q.lte("created_at", to);
    return q;
  }, cap) : [];

  const directory = await readDirectory(db);
  const canonicalSap = reconcileDecisions(sapRows, directory);
  const knownAudit = new Set(canonicalSap.filter(r => rawOf(r).source === "audit_log").map(r => String(r.external_id)));
  const remainingAudit = auditRows.filter(r => !knownAudit.has(`${r.entity_id}::${norm(r.actor_email)}`));
  const truncated = sapRows.length > cap || scopedLog.length > cap || auditRows.length > cap;
  return {
    sapRows: canonicalSap.slice(0, cap), logRows: scopedLog.slice(0, cap), expenses,
    auditRows: remainingAudit.slice(0, cap), truncated,
  };
}
