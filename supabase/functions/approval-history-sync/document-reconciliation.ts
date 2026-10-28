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
  const names = [...new Set(String(raw.reconciled_version ? row.approver_name : raw["Aprovador(es)"] ?? row.approver_name ?? "").split(",").map(n => n.trim()).filter(Boolean))];
  const draft = draftOf(row);
  return names.map(name => {
    const person = resolvePerson(index, [name, ...(names.length === 1 ? [row.approver_email, row.approver_code] : [])]);
    const key = person?.key || normIdentity(name);
    const day = row.decision_date ? String(row.decision_date).slice(0, 10) : null;
    const { id: _id, ...withoutId } = row;
    const externalId = `hana::${draft ? `E${draft}` : `N${row.doc_num}`}::${key}`;
    return { ...withoutId, ...(row.external_id === externalId && row.id ? { id: row.id } : {}), external_id: externalId,
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
// ---------------------------------------------------------------------------
// Conciliação por documento (fornecedor + valor + janela) — v2
// ---------------------------------------------------------------------------
const DAY_MS = 86_400_000;
const SAO_PAULO_OFFSET_MS = 3 * 3_600_000; // America/Sao_Paulo sem horário de verão desde 2019
export const vendorKey = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toUpperCase().replace(/[^A-Z0-9]/g, "");
export const isForeignCurrency = (value: unknown) => {
  const c = normIdentity(value);
  return !!c && c !== "brl" && c !== "r$";
};
const localDay = (iso: unknown) => {
  const t = Date.parse(String(iso ?? ""));
  return Number.isFinite(t) ? Math.floor((t - SAO_PAULO_OFFSET_MS) / DAY_MS) : null;
};
const hanaDay = (iso: unknown) => {
  const t = Date.parse(String(iso ?? "").slice(0, 10));
  return Number.isFinite(t) ? Math.floor(t / DAY_MS) : null;
};
export const isLegacyRow = (row: HistoryRecord) => !["audit_log", "hana_view"].includes(String(rawOf(row).source ?? ""));
/** Código do ApprovalRequest nas linhas antigas (`7497::email` ou `7497-82-20`). */
export const legacyRequestCode = (row: HistoryRecord) => positiveInt(String(row.external_id ?? "").split(/::|-/)[0]);
/** Linha de auditoria sem fornecedor, valor e número — não representa um documento. */
export function isEmptyDecision(row: HistoryRecord): boolean {
  const raw = rawOf(row);
  const source = raw.source ?? row.source;
  if (source !== "audit_log") return false;
  const total = Number(row.doc_total ?? raw.docTotal);
  return !String(row.card_name ?? raw.cardName ?? "").trim() && !(Number.isFinite(total) && total !== 0)
    && !positiveInt(raw.docNum ?? raw.provisional_doc_num ?? row.doc_num);
}
function needsDocumentMatch(row: HistoryRecord): boolean {
  const raw = rawOf(row);
  if (raw.superseded_by || raw.reconciliation_method === "document_match") return false;
  if (raw.source === "audit_log") return !draftOf(row) && !positiveInt(raw.po_doc_num);
  return isLegacyRow(row);
}
export function documentCandidates(row: HistoryRecord, hana: HistoryRecord[], index: Map<string, DirectoryIdentity[]>): HistoryRecord[] {
  const person = resolvePerson(index, [row.approver_email, row.approver_code, row.approver_name]);
  const day = localDay(row.decision_date);
  const vendor = vendorKey(row.card_name);
  const amount = Number(row.doc_total);
  if (!person || day == null || !vendor || !Number.isFinite(amount) || amount === 0) return [];
  const foreign = isForeignCurrency(row.currency);
  return hana.filter(h => {
    if (h.company_db !== row.company_db || h.decision !== row.decision || rawOf(h).identity_key !== person.key) return false;
    if (vendorKey(h.card_name) !== vendor || h.doc_total == null) return false;
    // Moeda estrangeira: o total HANA vem convertido em BRL, então o valor não é comparável.
    if (!foreign && Math.abs(Number(h.doc_total) - amount) > 0.01) return false;
    const other = hanaDay(h.decision_date);
    return other != null && other - day >= 0 && other - day <= 15;
  });
}
export interface DocumentMatchResult {
  writes: HistoryRecord[];
  counts: { audit_matched: number; legacy_matched: number; legacy_same_request: number; unresolved: number; ambiguous: number };
}
/** Concilia linhas audit/legadas sem documento com UMA decisão HANA; ambíguo permanece sem documento. */
export function matchDocumentDecisions(rows: HistoryRecord[], index: Map<string, DirectoryIdentity[]>): DocumentMatchResult {
  const active = rows.filter(r => !rawOf(r).superseded_by);
  const hana = active.filter(r => rawOf(r).source === "hana_view" && rawOf(r).identity_key);
  const writes: HistoryRecord[] = [];
  const counts = { audit_matched: 0, legacy_matched: 0, legacy_same_request: 0, unresolved: 0, ambiguous: 0 };
  // 1) Linhas antigas do mesmo ApprovalRequest + aprovador (webhook × Approval Hub) viram uma só.
  const legacyGroups = new Map<string, HistoryRecord[]>();
  for (const row of active.filter(isLegacyRow)) {
    const person = resolvePerson(index, [row.approver_email, row.approver_code, row.approver_name]);
    const code = legacyRequestCode(row);
    if (!person || !code) continue;
    const key = `${row.company_db}|${code}|${person.key}|${row.decision}`;
    legacyGroups.set(key, [...(legacyGroups.get(key) || []), row]);
  }
  const dropped = new Set<string>();
  for (const group of legacyGroups.values()) {
    if (group.length < 2) continue;
    const keep = group.find(r => String(r.external_id).includes("::")) || group[0];
    for (const r of group) if (r !== keep) {
      dropped.add(String(r.external_id));
      writes.push({ ...r, raw: { ...rawOf(r), superseded_by: "legacy_same_request", superseded_keep: keep.external_id } });
      counts.legacy_same_request++;
    }
  }
  // 2) Candidatas HANA por linha pendente.
  const pending = active.filter(r => needsDocumentMatch(r) && !dropped.has(String(r.external_id)) && !isEmptyDecision(r));
  const choice = new Map<string, HistoryRecord | null>();
  const claims = new Map<string, number>();
  for (const row of pending) {
    const candidates = documentCandidates(row, hana, index);
    const drafts = new Set(candidates.map(draftOf).filter(Boolean));
    const pick = drafts.size === 1 ? candidates.find(h => positiveInt(h.doc_num)) || candidates[0] : null;
    if (candidates.length && !pick) counts.ambiguous++;
    choice.set(String(row.external_id), pick);
    if (pick) claims.set(String(pick.external_id), (claims.get(String(pick.external_id)) || 0) + 1);
  }
  for (const row of pending) {
    const raw = rawOf(row);
    const legacy = isLegacyRow(row);
    let pick = choice.get(String(row.external_id)) || null;
    if (pick && (claims.get(String(pick.external_id)) || 0) > 1) { pick = null; counts.ambiguous++; }
    const currency = legacy && (!row.currency || normIdentity(row.currency) === "r$") ? "BRL" : row.currency;
    if (!pick) {
      counts.unresolved++;
      if (legacy) writes.push({ ...row, currency, raw: { ...raw, legacy_source: true, provisional_doc_num: raw.provisional_doc_num ?? row.doc_num ?? null,
        reconciliation_method: "unresolved" } });
      continue;
    }
    const draft = draftOf(pick);
    const finalNumber = positiveInt(pick.doc_num);
    writes.push({ ...row, currency, doc_entry: draft, doc_num: finalNumber, requester_name: pick.requester_name ?? row.requester_name ?? null,
      raw: { ...raw, ...(legacy ? { legacy_source: true } : {}), provisional_doc_num: raw.provisional_doc_num ?? raw.docNum ?? row.doc_num ?? null,
        draft_entry: draft, po_doc_num: finalNumber, requester_name: pick.requester_name ?? null,
        matched_hana_external_id: pick.external_id, reconciliation_method: "document_match", decision_precision: "individual" } });
    writes.push({ ...pick, raw: { ...rawOf(pick), superseded_by: legacy ? "legacy_document_match" : "audit_document_match", superseded_keep: row.external_id } });
    if (legacy) counts.legacy_matched++; else counts.audit_matched++;
  }
  return { writes, counts };
}
