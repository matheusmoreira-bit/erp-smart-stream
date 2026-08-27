export interface PagCorpAccountabilityDetails {
  id: string | number | null;
  date: string | null;
  description: string | null;
  status: string | null;
  approvedAt: string | null;
  approverName: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstValue(records: Array<Record<string, unknown> | null>, keys: string[]): unknown {
  for (const record of records) {
    if (!record) continue;
    for (const key of keys) {
      const value = record[key];
      if (value != null && value !== "") return value;
    }
  }
  return null;
}

function firstText(records: Array<Record<string, unknown> | null>, keys: string[]): string | null {
  const value = firstValue(records, keys);
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function personLabel(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  const person = asRecord(value);
  if (!person) return null;
  return firstText([person], [
    "displayName",
    "fullName",
    "name",
    "userName",
    "email",
    "login",
  ]);
}

export function extractPagCorpAccountability(
  transaction: Record<string, unknown>,
): PagCorpAccountabilityDetails {
  const receipts = Array.isArray(transaction.receipts)
    ? transaction.receipts.map(asRecord).filter((item): item is Record<string, unknown> => !!item)
    : [];
  const approvedReceipt = receipts.find((receipt) => Number(receipt.statusId) === 3);
  const isApproved = Number(transaction.statusId) === 3 || !!approvedReceipt;
  const receipt = approvedReceipt || receipts[0] || null;
  const accountability = asRecord(transaction.accountability)
    || asRecord(transaction.expenseAccountability);
  const approval = asRecord(transaction.approval)
    || asRecord(accountability?.approval)
    || asRecord(receipt?.approval);

  const approverDirect = firstValue(
    [transaction, accountability, receipt, approval],
    [
      "approvedByName",
      "approverName",
      "approvalUserName",
      "expenseApprovalUserName",
      "responsibleName",
      "approvedBy",
      "approver",
      "approvalUser",
      "user",
    ],
  );

  return {
    id: (firstValue([transaction, accountability], [
      "accountabilityId",
      "expenseAccountabilityId",
    ]) || firstValue([accountability, receipt], [
      "receiptId",
      "id",
    ])) as string | number | null,
    date: firstText([transaction, accountability, receipt], [
      "accountabilityDate",
      "accountabilityCreatedAt",
      "expenseAccountabilityDate",
      "submittedAt",
      "submissionDate",
      "receiptDate",
    ]) || firstText([accountability, receipt], [
      "createdAt",
      "date",
    ]),
    description: firstText([transaction, accountability, receipt], [
      "accountabilityDescription",
      "accountabilityObservation",
      "accountabilityJustification",
      "expenseAccountabilityDescription",
      "receiptDescription",
    ]) || firstText([accountability, receipt], [
      "justification",
      "observation",
      "observations",
      "note",
      "notes",
      "comments",
      "description",
    ]),
    status: firstText([accountability, receipt, transaction], [
      "accountabilityStatusDescription",
      "statusDescription",
      "statusName",
      "status",
    ]),
    approvedAt: firstText([transaction, accountability, receipt, approval], [
      "accountabilityApprovedAt",
      "approvedAt",
      "approvalDate",
      "expenseApprovalDate",
      "approvedDate",
      "decisionDate",
    ]) || (isApproved
      ? firstText([approvedReceipt, accountability, transaction], ["statusUpdatedAt", "updatedAt"])
      : null),
    approverName: personLabel(approverDirect)
      || personLabel(firstValue([approval], ["actor", "decidedBy"])),
  };
}
