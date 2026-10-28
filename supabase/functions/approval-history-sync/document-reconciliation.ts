export type HistoryRecord = Record<string, unknown>;
export const normIdentity = (value: unknown) => String(value ?? "").trim().toLowerCase();
export const positiveInt = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
export const rawOf = (row: HistoryRecord): HistoryRecord =>
  row.raw && typeof row.raw === "object" && !Array.isArray(row.raw) ? row.raw as HistoryRecord : {};

export interface DirectoryIdentity { key: string; name: string; code: string | null; email: string | null; aliases: string[] }
export function identityIndex(directory: HistoryRecord[], emails: HistoryRecord[]) {
  const index = new Map<string, DirectoryIdentity[]>();
  for (const d of directory) {
    const key = String(d.user_key);
    const ownEmails = emails.filter(e => e.user_key === d.user_key).map(e => normIdentity(e.email)).filter(Boolean);
    const aliases = [...new Set([d.display_name, d.sap_user_code, ...ownEmails, ...ownEmails.map(e => e.split("@")[0])].map(normIdentity).filter(Boolean))];
    const identity: DirectoryIdentity = { key, name: String(d.display_name || d.sap_user_code || key), code: d.sap_user_code ? String(d.sap_user_code) : null, email: ownEmails.sort()[0] || null, aliases };
    for (const alias of aliases) index.set(alias, [...(index.get(alias) || []), identity]);
  }
  return index;
}
export function resolvePerson(index: Map<string, DirectoryIdentity[]>, values: unknown[]): DirectoryIdentity | null {
  const matches = new Map<string, DirectoryIdentity>();
  for (const value of values) for (const person of index.get(normIdentity(value)) || []) matches.set(person.key, person);
  return matches.size === 1 ? [...matches.values()][0] : null;
}
export function draftOf(row: HistoryRecord): number | null {
  const raw = rawOf(row);
  return positiveInt(raw.draft_entry ?? raw.draftEntry ?? raw["Nº do Esboço"] ?? raw["Draft DocEntry"])
    ?? (raw.source === "hana_view" ? positiveInt(row.doc_entry) : null);
}
export function splitHanaPeople(row: HistoryRecord, index: Map<string, DirectoryIdentity[]>): HistoryRecord[] {
  const raw = rawOf(row);
  const names = [...new Set(String(raw["Aprovador(es)"] ?? row.approver_name ?? "").split(",").map(n => n.trim()).filter(Boolean))];
  const draft = draftOf(row);
  return names.map(name => {
    const person = resolvePerson(index, [name, ...(names.length === 1 ? [row.approver_email, row.approver_code] : [])]);
    const key = person?.key || normIdentity(name);
    const day = row.decision_date ? String(row.decision_date).slice(0, 10) : null;
    const { id: _id, ...withoutId } = row;
    return { ...withoutId, external_id: `hana::${draft ? `E${draft}` : `N${row.doc_num}`}::${key}`,
      approver_name: name, approver_email: person?.email || null, approver_code: person?.code || null,
      decision_date: day ? `${day}T00:00:00.000Z` : null,
      raw: { ...raw, source: "hana_view", draft_entry: draft, po_doc_num: positiveInt(row.doc_num), identity_key: person?.key || null,
        decision_precision: "document", document_decision_at: raw.document_decision_at ?? row.decision_date, reconciled_version: 1 },
    };
  });
}
export function uniqueHanaMatch(audit: HistoryRecord, hana: HistoryRecord[], requestedDraft?: number | null): HistoryRecord | null {
  const draft = requestedDraft ?? draftOf(audit);
  const sameCompany = hana.filter(h => h.company_db === audit.company_db && String(h.doc_object_type || "22") === String(audit.doc_object_type || "22"));
  if (draft) {
    const exact = sameCompany.filter(h => draftOf(h) === draft);
    const numbers = new Set(exact.map(h => positiveInt(h.doc_num)).filter(Boolean));
    return exact.length && numbers.size <= 1 ? exact.find(h => positiveInt(h.doc_num)) || exact[0] : null;
  }
  const day = Date.parse(String(audit.decision_date || "").slice(0, 10));
  if (!Number.isFinite(day) || !normIdentity(audit.card_name) || audit.doc_total == null) return null;
  const candidates = sameCompany.filter(h => {
    const otherDay = Date.parse(String(h.decision_date || "").slice(0, 10));
    return normIdentity(h.card_name) === normIdentity(audit.card_name) && h.doc_total != null
      && Math.abs(Number(h.doc_total) - Number(audit.doc_total)) < 0.005
      && Number.isFinite(otherDay) && Math.abs(otherDay - day) <= 86400000;
  });
  const drafts = new Set(candidates.map(draftOf).filter(Boolean));
  const numbers = new Set(candidates.map(h => positiveInt(h.doc_num)).filter(Boolean));
  return drafts.size === 1 && numbers.size <= 1 ? candidates.find(h => positiveInt(h.doc_num)) || candidates[0] : null;
}
export function enrichAudit(row: HistoryRecord, hana: HistoryRecord | null, request?: HistoryRecord | null): HistoryRecord {
  const raw = rawOf(row);
  const draft = positiveInt(request?.draftEntry) ?? draftOf(row) ?? (hana ? draftOf(hana) : null);
  const finalNumber = positiveInt(request?.finalDocNum) ?? positiveInt(raw.po_doc_num ?? raw.finalDocNum) ?? (hana ? positiveInt(hana.doc_num) : null);
  return { ...row, doc_entry: draft, doc_num: finalNumber, requester_name: hana?.requester_name ?? row.requester_name ?? null,
    doc_object_type: String(request?.objectType ?? row.doc_object_type ?? "22"),
    raw: { ...raw, source: "audit_log", provisional_doc_num: raw.provisional_doc_num ?? raw.docNum ?? row.doc_num,
      draft_entry: draft, po_doc_num: finalNumber, requester_name: hana?.requester_name ?? row.requester_name ?? null,
      final_doc_entry: positiveInt(request?.finalDocEntry) ?? positiveInt(raw.final_doc_entry),
      reconciliation_method: request?.draftEntry ? "approval_request" : hana ? "unique_hana_match" : "unresolved",
      reconciled_version: 1, decision_precision: "individual" },
  };
}
/** Suppress only proven duplicate source rows; never erase the original audit. */
export function reconcileDecisions(rows: HistoryRecord[], index: Map<string, DirectoryIdentity[]>): HistoryRecord[] {
  const expanded = rows.flatMap(row => rawOf(row).source === "hana_view" ? splitHanaPeople(row, index) : [row]);
  const audit = expanded.filter(r => rawOf(r).source === "audit_log" && draftOf(r));
  return expanded.filter(row => {
    if (rawOf(row).superseded_by) return false;
    if (rawOf(row).source !== "hana_view") return true;
    const person = resolvePerson(index, [row.approver_name, row.approver_email, row.approver_code]);
    return !audit.some(a => {
      if (a.company_db !== row.company_db || draftOf(a) !== draftOf(row) || a.decision !== row.decision
        || String(a.doc_object_type || "22") !== String(row.doc_object_type || "22")) return false;
      const actor = resolvePerson(index, [a.approver_email, a.approver_code, a.approver_name]);
      const raw = rawOf(a);
      const official = resolvePerson(index, [raw.substitutedForEmail, raw.substitutedForName]);
      return !!person && ((actor?.key === person.key) || (!!raw.actedAsSubstitute && official?.key === person.key));
    });
  });
}