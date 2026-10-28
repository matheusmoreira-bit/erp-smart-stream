// Lógica pura dos lembretes diários de aprovação (e-mail + WhatsApp).
// Sem dependências Deno para poder ser testada no vitest.

export type ReminderSource = "flow" | "sap";

export interface ReminderDoc {
  key: string; // único por documento+fonte
  source: ReminderSource;
  company_db: string;
  company_name: string;
  supplier: string;
  amount: number;
  currency: string;
  days_open: number;
  label: string; // "Pedido #123" / "Esboço #45" / "Pedido Flow"
  link: string;
  cost_centers: string[];
  approver_keys: string[]; // e-mails/códigos/nomes normalizados do aprovador oficial
  sap_draft_entry?: number | null;
}

export interface Person {
  key: string; // e-mail quando conhecido
  email: string | null;
  name: string;
  codes: string[]; // aliases normalizados
}

export interface Substitution {
  company_db: string | null;
  official_email: string;
  official_name: string | null;
  substitute_email: string;
  substitute_name: string | null;
  cost_center_prefixes: string[] | null;
  reason?: string | null;
}

export interface Recipient {
  person: Person;
  docs: Array<ReminderDoc & { on_behalf_of: string | null }>;
}

export function normKey(v: unknown): string {
  return String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

/** Dia útil (seg–sex) em America/Sao_Paulo. */
export function isBusinessDaySaoPaulo(now: Date): boolean {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(now);
  return !["Sat", "Sun"].includes(wd);
}

export function daysSince(iso: string | null | undefined, now: Date): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

/** Remove SAP que já aparece como pedido do Flow (mesmo esboço na mesma empresa). */
export function dedupeAcrossSources(flow: ReminderDoc[], sap: ReminderDoc[]): ReminderDoc[] {
  const flowDrafts = new Set(
    flow.filter((d) => d.sap_draft_entry).map((d) => `${d.company_db}::${d.sap_draft_entry}`),
  );
  const out = [...flow];
  const seen = new Set<string>();
  for (const d of sap) {
    if (d.sap_draft_entry && flowDrafts.has(`${d.company_db}::${d.sap_draft_entry}`)) continue;
    if (seen.has(d.key)) {
      const prev = out.find((x) => x.key === d.key);
      if (prev) prev.approver_keys = Array.from(new Set([...prev.approver_keys, ...d.approver_keys]));
      continue;
    }
    seen.add(d.key);
    out.push(d);
  }
  return out;
}

function personMatches(person: Person, ref: string): boolean {
  const r = normKey(ref);
  if (!r) return false;
  if (person.codes.includes(r)) return true;
  const local = r.includes("@") ? r.split("@")[0] : r;
  return person.codes.some((c) => (c.includes("@") ? c.split("@")[0] : c) === local);
}

function substitutionApplies(s: Substitution, doc: ReminderDoc): boolean {
  if (s.company_db && s.company_db !== doc.company_db) return false;
  const prefixes = (s.cost_center_prefixes || []).map((p) => p.trim()).filter(Boolean);
  if (!prefixes.length) return true;
  return doc.cost_centers.some((cc) => prefixes.some((p) => cc.startsWith(p)));
}

/** Ausência explícita no cadastro existente (não há campo separado de ausência). */
function isAbsence(s: Substitution): boolean {
  return /\b(ferias|ausencia|ausente|afastamento|afastado|licenca)\b/.test(normKey(s.reason));
}

/** Reciprocidade só vale quando as duas direções cobrem o mesmo documento. */
function isReciprocal(s: Substitution, official: Person, substitute: Person, doc: ReminderDoc, substitutions: Substitution[]): boolean {
  return substitutions.some((reverse) => personMatches(substitute, reverse.official_email)
    && personMatches(official, reverse.substitute_email) && substitutionApplies(reverse, doc));
}

/** Agrupa por destinatário, preservando titulares presentes e deduplicando documentos. */
export function buildRecipients(
  docs: ReminderDoc[],
  resolve: (approverKey: string) => Person | null,
  substitutions: Substitution[],
): { recipients: Recipient[]; unresolved: string[]; redirected: number } {
  const map = new Map<string, Recipient>();
  const unresolved = new Set<string>();
  const officialsByDoc = new Map<ReminderDoc, Map<string, Person>>();
  const activeByCompany = new Map<string, Set<string>>();
  for (const doc of docs) {
    const officials = new Map<string, Person>();
    for (const k of doc.approver_keys) {
      const p = resolve(k);
      if (!p) { unresolved.add(k); continue; }
      officials.set(p.key, p);
      const active = activeByCompany.get(doc.company_db) || new Set<string>();
      active.add(p.key);
      activeByCompany.set(doc.company_db, active);
    }
    officialsByDoc.set(doc, officials);
  }
  const addDoc = (target: Person, doc: ReminderDoc, onBehalf: string | null) => {
    const r = map.get(target.key) || { person: target, docs: [] };
    const existing = r.docs.find((d) => d.key === doc.key && d.company_db === doc.company_db);
    if (!existing) r.docs.push({ ...doc, on_behalf_of: onBehalf });
    // A pendência própria prevalece, independentemente da ordem de coleta.
    else if (onBehalf === null) existing.on_behalf_of = null;
    map.set(target.key, r);
  };
  let redirected = 0;
  for (const doc of docs) {
    const officials = officialsByDoc.get(doc);
    if (!officials) continue;
    for (const official of officials.values()) {
      const sub = substitutions.find((s) => personMatches(official, s.official_email) && substitutionApplies(s, doc));
      if (sub) {
        const sp = resolve(normKey(sub.substitute_email)) || {
          key: normKey(sub.substitute_email),
          email: isEmail(sub.substitute_email) ? normKey(sub.substitute_email) : null,
          name: sub.substitute_name || sub.substitute_email,
          codes: [normKey(sub.substitute_email)],
        };
        const reciprocal = isReciprocal(sub, official, sp, doc, substitutions);
        const substituteAbsent = substitutions.some((s) => personMatches(sp, s.official_email)
          && substitutionApplies(s, doc) && isAbsence(s));
        const activePresentSubstitute = activeByCompany.get(doc.company_db)?.has(sp.key)
          && !substituteAbsent && !isAbsence(sub);
        if (reciprocal || activePresentSubstitute) addDoc(official, doc, null);
        addDoc(sp, doc, sub.official_name || official.name);
        redirected++;
      } else {
        addDoc(official, doc, null);
      }
    }
  }
  for (const r of map.values()) r.docs.sort((a, b) => b.days_open - a.days_open);
  return { recipients: Array.from(map.values()), unresolved: Array.from(unresolved), redirected };
}
