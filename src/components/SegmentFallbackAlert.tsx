import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";


export interface FallbackSegmentRow {
  id: string;
  cost_center: string | null;
  project: string | null;
  amount: number;
  resolution: string;
  rule_name: string | null;
  fallback_branch: string | null;
  fallback_from_rule_name: string | null;
  resolution_note: string | null;
  current_approver: string | null;
  current_approver_email: string | null;
}

const RESOLUTION_LABEL: Record<string, string> = {
  branch_fallback: "Alçada herdada do ramo do centro de custo",
  rule_without_levels: "Regra sem aprovador — alçada do ramo aplicada",
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
}

/**
 * Alerta exibido quando a alçada de um segmento (CC + projeto) não veio de uma
 * regra própria, mas de um fallback hierárquico — ex.: CC 1.8.1.8 sem regra
 * (ou com regra "BLOQUEADO" sem níveis) roteado pela alçada do ramo 1.8.
 */
export function SegmentFallbackAlert({
  expenseId,
  formatCostCenter = (c?: string | null) => c || "",
}: {
  expenseId?: string | null;
  formatCostCenter?: (code?: string | null) => string;
}) {
  const [rows, setRows] = useState<FallbackSegmentRow[]>([]);

  useEffect(() => {
    if (!expenseId) {
      setRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("expense_approval_segments")
        .select(
          "id,cost_center,project,amount,resolution,rule_name,fallback_branch,fallback_from_rule_name,resolution_note,current_approver,current_approver_email",
        )
        .eq("expense_id", expenseId)
        .neq("resolution", "direct");
      if (!cancelled) setRows((data || []) as FallbackSegmentRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [expenseId]);

  if (rows.length === 0) return null;

  return (
    <div className="border border-amber-500/40 bg-amber-500/5 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        <h4 className="text-sm font-semibold text-foreground">
          Alçada resolvida por fallback
        </h4>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">
          {rows.length} segmento{rows.length > 1 ? "s" : ""}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Um ou mais segmentos deste documento não encontraram regra de aprovação própria. Para não
        travar o fluxo, o sistema aplicou a alçada do ramo mais próximo do centro de custo.
      </p>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.id} className="rounded-lg border border-amber-500/30 bg-background/40 p-2.5 text-xs space-y-1">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-medium text-foreground">
                {r.cost_center ? formatCostCenter(r.cost_center) : "Sem centro de custo"}
                {r.project ? ` · ${r.project}` : ""}
              </span>
              <span className="font-mono font-semibold text-foreground">{formatCurrency(Number(r.amount))}</span>
            </div>
            <div className="text-[11px] text-amber-700 dark:text-amber-300 font-medium">
              {RESOLUTION_LABEL[r.resolution] || r.resolution}
            </div>
            <div className="text-[11px] text-muted-foreground">
              Regra aplicada: <span className="text-foreground">{r.rule_name || "—"}</span>
              {r.fallback_branch ? ` · ramo ${r.fallback_branch}` : ""}
              {r.fallback_from_rule_name ? ` · regra original sem aprovador: ${r.fallback_from_rule_name}` : ""}
            </div>
            <div className="text-[11px] text-muted-foreground">
              Aprovador atual: <span className="text-foreground">{r.current_approver || r.current_approver_email || "—"}</span>
            </div>
            {r.resolution_note && (
              <p className="text-[11px] text-muted-foreground leading-relaxed">{r.resolution_note}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
