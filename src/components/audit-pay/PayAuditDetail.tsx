import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { usePayFindings, usePayResult, usePayFraudSignals, useRunPayAudit } from "@/hooks/useAuditPay";
import { FINDING_LABELS, PaySeverityBadge, SIGNAL_LABELS, formatBRL } from "./badges";

function val(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function Row({ label, before, after, diverged }: { label: string; before: unknown; after: unknown; diverged: boolean }) {
  return (
    <div className={`grid grid-cols-1 gap-2 rounded-lg border p-3 sm:grid-cols-[160px_1fr_1fr] ${diverged ? "border-amber-500/40 bg-amber-500/5" : "border-border/60 bg-background/40"}`}>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="break-words text-sm text-foreground">{val(before)}</div>
      <div className={`break-words text-sm ${diverged ? "font-medium text-amber-400" : "text-foreground"}`}>{val(after)}</div>
    </div>
  );
}

export function PayAuditDetail(props: { resultId?: string } = {}) {
  const { resultId: paramResultId } = useParams();
  const resultId = props.resultId ?? paramResultId;
  const { data: result, isLoading } = usePayResult(resultId);
  const { data: findings } = usePayFindings(resultId);
  const { data: signals } = usePayFraudSignals();
  const rerun = useRunPayAudit();

  if (isLoading) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (!result) return <p className="p-10 text-center text-sm text-muted-foreground">Resultado não encontrado.</p>;

  const baseline = (result.baseline_snapshot ?? {}) as any;
  const settlement = (result.settlement_snapshot ?? {}) as any;
  const relatedSignals = (signals ?? []).filter((s) => (s.related_audit_result_ids ?? []).includes(result.id));
  const divergedFields = new Set((findings ?? []).map((f) => f.field_name ?? ""));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/auditoria/geral/pay-results" className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Resultados
          </Link>
          <h2 className="truncate text-2xl font-bold tracking-tight text-foreground">{result.document_ref}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <PaySeverityBadge severity={result.overall_severity} />
            <span>risco {result.risk_score}</span>
            <span>auditado em {new Date(result.audited_at).toLocaleString("pt-BR")}</span>
            <span>baseline: {result.baseline_source === "erp_flow_approval" ? "aprovação ERP Flow" : "pedido de compra SAP"}</span>
          </div>
        </div>
        <Button
          variant="outline"
          disabled={rerun.isPending}
          onClick={() =>
            rerun.mutate(
              { documentRef: result.document_ref, documentType: result.document_type, baselineSource: result.baseline_source },
              {
                onSuccess: () => toast({ title: "Auditoria reexecutada" }),
                onError: (e: any) => toast({ title: "Falha", description: e.message, variant: "destructive" }),
              },
            )
          }
        >
          {rerun.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Auditar novamente
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card/60 p-4">
        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-[160px_1fr_1fr] text-[11px] uppercase tracking-wider text-muted-foreground">
          <span>Campo</span>
          <span>Baseline (aprovação)</span>
          <span>Settlement (pagamento)</span>
        </div>
        <div className="space-y-2">
          <Row label="Fornecedor" before={`${baseline.fornecedor_code ?? "—"} · ${baseline.fornecedor_name ?? "—"}`} after={`${settlement.fornecedor_code ?? "—"} · ${settlement.fornecedor_name ?? "—"}`} diverged={divergedFields.has("fornecedor_code")} />
          <Row label="Valor" before={formatBRL(result.valor_baseline)} after={formatBRL(result.valor_pago)} diverged={divergedFields.has("valor")} />
          <Row label="Centro de custo" before={baseline.cost_center} after={settlement.cost_center} diverged={divergedFields.has("cost_center")} />
          <Row label="Projeto" before={baseline.project} after={settlement.project} diverged={divergedFields.has("project")} />
          <Row label="Solicitante" before={baseline.solicitante} after={settlement.solicitante} diverged={divergedFields.has("solicitante")} />
          <Row label="Aprovadores" before={(baseline.aprovadores ?? []).join(", ")} after="—" diverged={false} />
          <Row label="Dados bancários" before={baseline.bank} after={settlement.bank} diverged={divergedFields.has("dados_bancarios")} />
          <Row label="Itens" before={`${(baseline.lines ?? []).length} linha(s)`} after={`${(settlement.lines ?? []).length} linha(s)`} diverged={[...divergedFields].some((f) => f.startsWith("item"))} />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card/60 p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Divergências encontradas</h3>
        {!findings || findings.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma divergência — documento conforme.</p>
        ) : (
          <ul className="space-y-2">
            {findings.map((f) => (
              <li key={f.id} className="rounded-lg border border-border/60 bg-background/40 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <PaySeverityBadge severity={f.severity} />
                  <span className="text-sm font-medium text-foreground">{FINDING_LABELS[f.finding_type] ?? f.finding_type}</span>
                  {f.field_name && <span className="font-mono text-[11px] text-muted-foreground">{f.field_name}</span>}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{f.explanation}</p>
                <div className="mt-2 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2">
                  <div className="rounded border border-border/60 p-2"><span className="text-muted-foreground">Antes: </span>{val(f.value_before)}</div>
                  <div className="rounded border border-border/60 p-2"><span className="text-muted-foreground">Depois: </span>{val(f.value_after)}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {relatedSignals.length > 0 && (
        <div className="rounded-xl border border-border bg-card/60 p-4">
          <div className="mb-3 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-destructive" />
            <h3 className="text-sm font-semibold text-foreground">Sinais de fraude relacionados</h3>
          </div>
          <ul className="space-y-2">
            {relatedSignals.map((s) => (
              <li key={s.id} className="rounded-lg border border-border/60 bg-background/40 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <PaySeverityBadge severity={s.severity} />
                  <span className="text-sm font-medium text-foreground">{SIGNAL_LABELS[s.signal_type] ?? s.signal_type}</span>
                  <span className="text-[11px] text-muted-foreground">confiança {Math.round(Number(s.confidence) * 100)}%</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{s.narrative}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
