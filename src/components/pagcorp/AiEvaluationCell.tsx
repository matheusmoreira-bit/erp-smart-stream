import { FileCheck2, Scale } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { evaluatePagCorpAi, type AiCheck, type AiCheckStatus } from "@/lib/pagcorp-ai-evaluation";
import type { PagCorpTransaction } from "@/hooks/usePagCorp";

const STATUS_CLASS: Record<AiCheckStatus, string> = {
  ok: "border-success/40 bg-success/10 text-success",
  warning: "border-warning/40 bg-warning/10 text-warning",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  idle: "border-border bg-muted/40 text-muted-foreground",
};

const STATUS_LABEL: Record<AiCheckStatus, string> = {
  ok: "OK",
  warning: "Atenção",
  error: "Erro",
  idle: "Não realizado",
};

const ICONS = {
  fiscal_document: FileCheck2,
  amount_match: Scale,
} as const;

function CheckIcon({ check }: { check: AiCheck }) {
  const Icon = ICONS[check.key];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          tabIndex={0}
          aria-label={`${check.title}: ${STATUS_LABEL[check.status]} — ${check.detail}`}
          className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${STATUS_CLASS[check.status]}`}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px]">
        <p className="text-xs font-medium">
          {check.title} — {STATUS_LABEL[check.status]}
        </p>
        <p className="text-xs text-muted-foreground">{check.detail}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function AiEvaluationCell({ transaction }: { transaction: PagCorpTransaction }) {
  const checks = evaluatePagCorpAi(transaction);
  return (
    <div className="flex items-center justify-center gap-1.5">
      {checks.map((check) => (
        <CheckIcon key={check.key} check={check} />
      ))}
    </div>
  );
}
