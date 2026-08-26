import { CheckCircle2, Clock, GitBranch, Ban, XCircle } from "lucide-react";
import type { ApprovalTrackSegment } from "@/hooks/useApprovals";

export type TrackSegmentRow = ApprovalTrackSegment;

type ChainLevel = { level_order?: number; approver_name?: string | null; approver_email?: string | null };

const REEMBOLSO_KEY = "__reembolso__";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
}

function chainOf(raw: unknown): ChainLevel[] {
  if (Array.isArray(raw)) return raw as ChainLevel[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as ChainLevel[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

const STATUS_META: Record<string, { label: string; className: string; Icon: typeof Clock }> = {
  pendente: { label: "Em avaliação", className: "text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-500/10", Icon: Clock },
  aprovado: { label: "Aprovada", className: "text-emerald-600 dark:text-emerald-400 border-emerald-500/40 bg-emerald-500/10", Icon: CheckCircle2 },
  rejeitado: { label: "Reprovada", className: "text-destructive border-destructive/40 bg-destructive/10", Icon: XCircle },
  bloqueado: { label: "Bloqueada", className: "text-muted-foreground border-border bg-muted/40", Icon: Ban },
};

/**
 * Mostra, lado a lado, o status de avaliação de CADA trilha do documento —
 * a(s) trilha(s) da regra padrão (CC + projeto) e a trilha paralela de
 * reembolso — com o que ainda falta para liberar a aprovação final.
 */
export function ParallelTracksPanel({
  segments = [],
  restrictedSegmentCount = 0,
  formatCostCenter = (c?: string | null) => c || "",
}: {
  segments?: TrackSegmentRow[];
  restrictedSegmentCount?: number;
  formatCostCenter?: (code?: string | null) => string;
}) {
  const rows = segments;

  const hasReembolso = rows.some((r) => r.segment_key === REEMBOLSO_KEY);
  // Só faz sentido exibir quando há mais de uma trilha correndo em paralelo.
  if (rows.length + restrictedSegmentCount < 2) return null;

  const pending = rows.filter((r) => r.status === "pendente");
  const approved = rows.filter((r) => r.status === "aprovado");

  const standard = rows.filter((r) => r.segment_key !== REEMBOLSO_KEY);
  const reembolso = rows.filter((r) => r.segment_key === REEMBOLSO_KEY);

  const renderTrack = (r: TrackSegmentRow) => {
    const meta = STATUS_META[r.status] || STATUS_META.pendente;
    const chain = chainOf(r.chain);
    const levels = Array.from(new Set(chain.map((l) => Number(l.level_order) || 1))).sort((a, b) => a - b);
    const currentLevel = Number(r.current_level) || 1;
    const doneLevels = r.status === "aprovado" ? levels.length : levels.filter((l) => l < currentLevel).length;
    const remaining = r.status === "pendente"
      ? levels.filter((l) => l >= currentLevel)
      : [];
    const remainingApprovers = remaining.map((lvl) => {
      const names = chain
        .filter((l) => (Number(l.level_order) || 1) === lvl)
        .map((l) => l.approver_name || l.approver_email)
        .filter(Boolean);
      return `N${lvl}: ${names.join(" ou ") || "—"}`;
    });

    return (
      <div key={r.id} className="rounded-lg border border-border bg-background/60 p-3 text-xs space-y-1.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="font-medium text-foreground">
            {r.segment_key === REEMBOLSO_KEY
              ? "Regra de reembolso (paralela)"
              : `${r.cost_center ? formatCostCenter(r.cost_center) : "Sem centro de custo"}${r.project ? ` · ${r.project}` : ""}`}
          </span>
          <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${meta.className}`}>
            <meta.Icon className="w-3 h-3" />
            {meta.label}
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground">
          Regra: <span className="text-foreground">{r.rule_name || "—"}</span>
          {" · "}Valor: <span className="text-foreground font-mono">{formatCurrency(Number(r.amount))}</span>
        </div>
        <div className="text-[11px] text-muted-foreground">
          Progresso: <span className="text-foreground">{doneLevels}/{levels.length || 1} níveis</span>
          {r.status === "pendente" && (
            <> · Aguardando <span className="text-foreground">{r.current_approver || r.current_approver_email || "—"}</span> (nível {currentLevel})</>
          )}
          {r.status !== "pendente" && r.decided_by && (
            <> · Decidido por <span className="text-foreground">{r.decided_by}</span></>
          )}
        </div>
        {remainingApprovers.length > 0 && (
          <div className="text-[11px] text-muted-foreground">
            Falta: <span className="text-foreground">{remainingApprovers.join(" → ")}</span>
          </div>
        )}
        {r.status !== "pendente" && r.resolution_note && (
          <p className="text-[11px] text-muted-foreground leading-relaxed">{r.resolution_note}</p>
        )}
      </div>
    );
  };

  return (
    <div className="border border-primary/30 bg-primary/5 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <GitBranch className="w-4 h-4 text-primary" />
        <h4 className="text-sm font-semibold text-foreground">
          Avaliação em paralelo {hasReembolso ? "— regra padrão + reembolso" : "— trilhas por rateio"}
        </h4>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary/10 border border-primary/30 rounded px-1.5 py-0.5">
          {restrictedSegmentCount > 0
            ? `${rows.length} visível${rows.length === 1 ? "" : "is"} · ${restrictedSegmentCount} restrita${restrictedSegmentCount === 1 ? "" : "s"}`
            : `${approved.length}/${rows.length} concluídas`}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {restrictedSegmentCount > 0
          ? `Você visualiza somente as ${rows.length} ramificações da sua alçada. ${restrictedSegmentCount} ramificação${restrictedSegmentCount > 1 ? "ões" : ""} de outros aprovadores permanece${restrictedSegmentCount > 1 ? "m" : ""} restrita${restrictedSegmentCount > 1 ? "s" : ""}.`
          : pending.length > 0
          ? `A aprovação final só é liberada quando TODAS as trilhas concluírem. Faltam ${pending.length} trilha${pending.length > 1 ? "s" : ""}.`
          : rows.some((r) => r.status === "rejeitado")
            ? "Uma das trilhas reprovou — o documento fica bloqueado, mesmo com as demais aprovadas."
            : "Todas as trilhas concluíram a avaliação."}
      </p>

      {standard.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Regra padrão
          </div>
          {standard.map(renderTrack)}
        </div>
      )}
      {reembolso.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Regra de reembolso
          </div>
          {reembolso.map(renderTrack)}
        </div>
      )}
      {restrictedSegmentCount > 0 && (
        <div className="space-y-1.5">
          {Array.from({ length: restrictedSegmentCount }, (_, index) => (
            <div
              key={`restricted-${index}`}
              className="rounded-lg border border-border bg-muted/20 p-3"
              aria-label="Ramificação de outro aprovador, detalhes restritos"
            >
              <div className="h-4 w-2/5 rounded bg-muted-foreground/15" />
              <div className="mt-2 h-3 w-3/5 rounded bg-muted-foreground/10" />
              <p className="mt-2 text-[10px] font-semibold uppercase text-muted-foreground">
                Detalhes de outra ramificação ofuscados
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
