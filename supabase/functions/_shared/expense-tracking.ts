export interface ExpenseTrackingExpense {
  id: string;
  company_db: string;
  supplier_code: string | null;
  supplier_name: string;
  sap_doc_entry: number | null;
  sap_doc_num: number | null;
  doc_date: string | null;
  created_at: string;
  due_date: string | null;
  total_amount: number | string;
  currency: string;
  cost_center: string | null;
  project: string | null;
  remarks: string | null;
  current_approver: string | null;
  current_level_order: number;
  status: string;
}

export interface ExpenseTrackingLine {
  expense_id: string;
  line_total: number | string;
  description: string | null;
  cost_center: string | null;
  project: string | null;
}

export interface ExpenseTrackingApprovalSegment {
  expense_id: string;
  cost_center: string | null;
  project: string | null;
  current_approver: string | null;
  current_approver_email: string | null;
  current_level: number;
  status: string;
}

export interface ExpenseTrackingPendingApprover {
  name: string | null;
  email: string | null;
  level: number | null;
  costCenter: string | null;
  project: string | null;
}

export interface ExpenseTrackingItem {
  supplierCode: string | null;
  supplierName: string;
  supplierTaxId: string | null;
  erpFlowId: string;
  sapDocumentId: number | null;
  invoiceDate: string | null;
  createdAt: string;
  dueDate: string | null;
  totalAmount: number;
  currency: string;
  description: string | null;
  observation: string | null;
  costCenters: string[];
  projects: string[];
  status: string;
  pendingApprovers: ExpenseTrackingPendingApprover[];
}

export function normalizeProjectCode(value: unknown): string {
  return String(value ?? "").trim().toLocaleUpperCase("pt-BR");
}

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const clean = String(value ?? "").trim();
    const key = normalizeProjectCode(clean);
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
}

function money(value: number | string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function isPendingApprovalStatus(value: unknown): boolean {
  return ["pendente_aprovacao", "pending_approval", "in_approval", "submitted"]
    .includes(String(value ?? "").trim().toLocaleLowerCase("pt-BR"));
}

function scopedPendingApprovers(
  expense: ExpenseTrackingExpense,
  segments: ExpenseTrackingApprovalSegment[],
  allowed: Set<string>,
  scopedLines: ExpenseTrackingLine[],
): ExpenseTrackingPendingApprover[] {
  if (!isPendingApprovalStatus(expense.status)) return [];

  const scopedSegments = segments.filter((segment) => {
    const effectiveProject = segment.project || expense.project;
    if (normalizeProjectCode(effectiveProject)) {
      return allowed.has(normalizeProjectCode(effectiveProject));
    }
    const segmentCostCenter = String(segment.cost_center ?? "").trim();
    return Boolean(segmentCostCenter) && scopedLines.some((line) =>
      String(line.cost_center ?? expense.cost_center ?? "").trim() === segmentCostCenter
    );
  });
  const pendingSegments = scopedSegments.filter((segment) =>
    String(segment.status ?? "").trim().toLocaleLowerCase("pt-BR") === "pendente"
  );

  if (segments.length > 0) {
    const seen = new Set<string>();
    return pendingSegments.flatMap((segment) => {
      const name = String(segment.current_approver ?? "").trim() || null;
      const email = String(segment.current_approver_email ?? "").trim() || null;
      if (!name && !email) return [];
      const key = `${normalizeProjectCode(email || name)}\u0000${segment.current_level}\u0000${normalizeProjectCode(segment.project)}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{
        name,
        email,
        level: Number.isFinite(Number(segment.current_level)) ? Number(segment.current_level) : null,
        costCenter: segment.cost_center,
        project: segment.project || expense.project,
      }];
    });
  }

  const name = String(expense.current_approver ?? "").trim() || null;
  if (!name) return [];
  return [{
    name,
    email: null,
    level: Number.isFinite(Number(expense.current_level_order)) ? Number(expense.current_level_order) : null,
    costCenter: expense.cost_center,
    project: expense.project,
  }];
}

export function shapeScopedExpense(
  expense: ExpenseTrackingExpense,
  lines: ExpenseTrackingLine[],
  allowedProjectCodes: Iterable<string>,
  supplierTaxId: string | null = null,
  approvalSegments: ExpenseTrackingApprovalSegment[] = [],
): ExpenseTrackingItem | null {
  const allowed = new Set(Array.from(allowedProjectCodes, normalizeProjectCode).filter(Boolean));
  if (allowed.size === 0) return null;

  const scopedLines = lines.filter((line) => {
    const effectiveProject = line.project || expense.project;
    return allowed.has(normalizeProjectCode(effectiveProject));
  });

  if (lines.length > 0 && scopedLines.length === 0) return null;

  const hasItemLines = lines.length > 0;
  if (!hasItemLines && !allowed.has(normalizeProjectCode(expense.project))) return null;

  const totalAmount = hasItemLines
    ? money(scopedLines.reduce((sum, line) => sum + money(line.line_total), 0))
    : money(expense.total_amount);
  const costCenters = hasItemLines
    ? unique(scopedLines.map((line) => line.cost_center || expense.cost_center))
    : unique([expense.cost_center]);
  const projects = hasItemLines
    ? unique(scopedLines.map((line) => line.project || expense.project))
    : unique([expense.project]);
  const descriptions = hasItemLines
    ? unique(scopedLines.map((line) => line.description))
    : [];

  return {
    supplierCode: expense.supplier_code,
    supplierName: expense.supplier_name,
    supplierTaxId,
    erpFlowId: expense.id,
    sapDocumentId: expense.sap_doc_num ?? expense.sap_doc_entry,
    invoiceDate: expense.doc_date,
    createdAt: expense.created_at,
    dueDate: expense.due_date,
    totalAmount,
    currency: expense.currency,
    description: descriptions.join(" | ") || expense.remarks,
    observation: expense.remarks,
    costCenters,
    projects,
    status: expense.status,
    pendingApprovers: scopedPendingApprovers(expense, approvalSegments, allowed, scopedLines),
  };
}
