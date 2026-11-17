import { excludeRequesterLevels, type ApprovalLevel } from "./approval-skip.ts";

interface UnifiedRuleReader {
  from(table: "approval_rules"): {
    select(columns: "id"): {
      eq(column: string, value: string | boolean): {
        eq(column: string, value: string | boolean): {
          eq(column: string, value: string | boolean): {
            maybeSingle(): PromiseLike<{ data: { id: string } | null; error: { message: string } | null }>;
          };
        };
      };
    };
  };
}

export const SINGLE_PURCHASE_MODE = "single_purchase";

export function isPurchaseApprovalScope(docType: unknown): boolean {
  return ["purchase", "advance"].includes(String(docType || "purchase").toLowerCase());
}

export function unifiedApprovalTargets(
  levels: ApprovalLevel[], requesterName: string | null, requesterEmail: string | null,
): ApprovalLevel[] {
  const eligible = excludeRequesterLevels(levels, requesterName, requesterEmail);
  if (eligible.length === 0) throw new Error("Alçada única sem aprovador elegível.");
  if (levels.length !== 2 || levels.some((level) => level.level_order !== 1 || level.require_all === true)) {
    throw new Error("Alçada única inválida: deve conter duas alternativas em um nível.");
  }
  return eligible.sort((a, b) =>
    Number(b.approver_email?.startsWith("juliana.gavineli@")) - Number(a.approver_email?.startsWith("juliana.gavineli@"))
  );
}

export async function loadUnifiedPurchaseRule(admin: UnifiedRuleReader, companyDb: string, docType: unknown): Promise<string | null> {
  if (!companyDb || !isPurchaseApprovalScope(docType)) return null;
  const { data, error } = await admin.from("approval_rules")
    .select("id").eq("company_db", companyDb).eq("is_active", true)
    .eq("approval_mode", SINGLE_PURCHASE_MODE).maybeSingle();
  if (error) throw new Error(`Falha ao verificar alçada única: ${error.message}`);
  return data?.id || null;
}