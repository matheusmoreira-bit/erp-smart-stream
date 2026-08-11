import { useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, ShieldAlert, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { usePayFraudSignals, useRunPayAgent, useUpdateSignalStatus, type PayFraudSignal } from "@/hooks/useAuditPay";
import { PaySeverityBadge, SIGNAL_LABELS, SIGNAL_STATUS_LABELS } from "./badges";

const STATUS_FLOW: PayFraudSignal["status"][] = ["aberto", "em_analise", "confirmado_erro", "confirmado_fraude", "descartado"];

export function PayFraudSignals() {
  const [status, setStatus] = useState<string>("aberto");
  const { data, isLoading } = usePayFraudSignals(status || undefined);
  const runAgent = useRunPayAgent();
  const update = useUpdateSignalStatus();

  const sorted = [...(data ?? [])].sort((a, b) => Number(b.confidence) - Number(a.confidence));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Central de sinais de fraude</h2>
          <p className="text-sm text-muted-foreground">Padrões detectados por regra e priorizados pelo agente de IA.</p>
        </div>
        <Button
          onClick={() =>
            runAgent.mutate(90, {
              onSuccess: (r: any) => toast({ title: "Análise concluída", description: `${r?.signals ?? 0} sinais sobre ${r?.analyzed ?? 0} documentos.` }),
              onError: (e: any) => toast({ title: "Falha na análise", description: e.message, variant: "destructive" }),
            })
          }
          disabled={runAgent.isPending}
        >
          {runAgent.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
          Rodar agente (90 dias)
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {["", ...STATUS_FLOW].map((s) => (
          <button
            key={s || "all"}
            onClick={() => setStatus(s)}
            className={`rounded-full border px-3 py-1 text-xs ${
              status === s ? "border-primary/30 bg-primary/15 text-primary" : "border-transparent bg-muted/40 text-muted-foreground"
            }`}
          >
            {s ? SIGNAL_STATUS_LABELS[s as PayFraudSignal["status"]] : "Todos"}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}</div>
      ) : sorted.length === 0 ? (
        <p className="rounded-xl border border-border bg-card/60 p-10 text-center text-sm text-muted-foreground">
          Nenhum sinal neste status. Rode o agente após auditar documentos.
        </p>
      ) : (
        <ul className="space-y-3">
          {sorted.map((s) => (
            <li key={s.id} className="rounded-xl border border-border bg-card/60 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-destructive" />
                <span className="text-sm font-semibold text-foreground">{SIGNAL_LABELS[s.signal_type] ?? s.signal_type}</span>
                <PaySeverityBadge severity={s.severity} />
                <span className="text-[11px] text-muted-foreground">confiança {Math.round(Number(s.confidence) * 100)}%</span>
                <span className="ml-auto text-[11px] text-muted-foreground">{new Date(s.detected_at).toLocaleDateString("pt-BR")}</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{s.narrative}</p>
              <div className="mt-2 text-[11px] text-muted-foreground">
                {s.entity_type}: <span className="font-mono text-foreground">{s.entity_ref}</span>
              </div>

              {(s.related_audit_result_ids ?? []).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(s.related_audit_result_ids ?? []).slice(0, 12).map((id) => (
                    <Link
                      key={id}
                      to={`../results/${id}`}
                      relative="path"
                      className="rounded border border-border bg-muted/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      {id.slice(0, 8)}
                    </Link>
                  ))}
                  {(s.related_audit_result_ids ?? []).length > 12 && (
                    <span className="text-[10px] text-muted-foreground">+{(s.related_audit_result_ids ?? []).length - 12}</span>
                  )}
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-1.5">
                {STATUS_FLOW.filter((st) => st !== s.status).map((st) => (
                  <Button key={st} size="sm" variant="outline" onClick={() => update.mutate({ id: s.id, status: st })}>
                    {SIGNAL_STATUS_LABELS[st]}
                  </Button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
