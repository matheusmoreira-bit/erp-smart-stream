import type { createClient } from "npm:@supabase/supabase-js@2";
import { enrichAudit, identityIndex, positiveInt, rawOf, reconcileDecisions, splitHanaPeople, uniqueHanaMatch, type HistoryRecord } from "./document-reconciliation.ts";
type Db = ReturnType<typeof createClient>;
export async function readCompanyHistory(db: Db, company: string): Promise<HistoryRecord[]> {
  const rows: HistoryRecord[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from("approval_history").select("*").eq("company_db", company).order("id").range(offset, offset + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if ((data || []).length < 1000) return rows;
  }
}
export async function readDirectory(db: Db) {
  const read = async (table: "sap_user_directory" | "sap_user_emails") => {
    const rows: HistoryRecord[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db.from(table).select("*").order("user_key").range(offset, offset + 999);
      if (error) throw new Error(error.message);
      rows.push(...(data || []));
      if ((data || []).length < 1000) return rows;
    }
  };
  const [dir, emails] = await Promise.all([read("sap_user_directory"), read("sap_user_emails")]);
  return identityIndex(dir, emails);
}
export async function writeHistory(db: Db, rows: HistoryRecord[]) {
  const unique = [...new Map(rows.map(r => [String(r.external_id), r])).values()];
  for (let offset = 0; offset < unique.length; offset += 800) {
    await Promise.all(Array.from({ length: 4 }, async (_, slot) => {
      const batch = unique.slice(offset + slot * 200, offset + (slot + 1) * 200).map(row => {
        const { id: _id, ...rest } = row;
        return rest;
      });
      if (!batch.length) return;
      const { error } = await db.from("approval_history").upsert(batch, { onConflict: "company_db,external_id" });
      if (error) throw new Error(error.message);
    }));
  }
}
export async function backfillDocuments(db: Db, company: string, cursor: number,
  lookup: (codes: number[]) => Promise<Map<number, HistoryRecord>>) {
  const [history, index] = await Promise.all([readCompanyHistory(db, company), readDirectory(db)]);
  const hana = history.filter(r => rawOf(r).source === "hana_view" && !rawOf(r).superseded_by);
  const audit = history.filter(r => rawOf(r).source === "audit_log").sort((a,b) => String(a.external_id).localeCompare(String(b.external_id)));
  const batch = audit.slice(cursor, cursor + 40);
  const codes = [...new Set(batch.map(r => positiveInt(String(r.external_id).split("::")[0])).filter((n): n is number => n !== null))];
  const requests = codes.length ? await lookup(codes) : new Map<number, HistoryRecord>();
  const corrected = batch.map(row => {
    const request = requests.get(Number(String(row.external_id).split("::")[0]));
    const match = uniqueHanaMatch(row, hana, positiveInt(request?.draftEntry));
    return enrichAudit(row, match, request);
  });
  await writeHistory(db, corrected);
  const correctedMap = new Map(corrected.map(r => [String(r.external_id), r]));
  const fullAudit = audit.map(r => correctedMap.get(String(r.external_id)) || r);
  const nextCursor = cursor + batch.length;
  const done = nextCursor >= audit.length;
  let splitCount = 0;
  let deduplicated = 0;
  if (done) {
    const individual = hana.flatMap(row => splitHanaPeople(row, index));
    const retained = reconcileDecisions([...fullAudit, ...individual], index);
    const retainedIds = new Set(retained.map(r => String(r.external_id)));
    const writes = individual.map(row => retainedIds.has(String(row.external_id)) ? row : {
      ...row, raw: { ...rawOf(row), superseded_by: "audit_same_draft_approver" },
    });
    const individualIds = new Set(individual.map(r => String(r.external_id)));
    for (const original of hana) if (!individualIds.has(String(original.external_id))) {
      writes.push({ ...original, raw: { ...rawOf(original), superseded_by: "individual_hana_decisions", reconciled_version: 1 } });
    }
    await writeHistory(db, writes);
    splitCount = individualIds.size;
    deduplicated = individual.filter(r => !retainedIds.has(String(r.external_id))).length;
  }
  return { companyDb: company, processed: batch.length, corrected: corrected.filter(r => r.doc_num || rawOf(r).draft_entry).length,
    without_final: corrected.filter(r => !r.doc_num).length, total_audit: audit.length, nextCursor, done, hana_individuals: splitCount, deduplicated,
    sap_resolved: requests.size };
}