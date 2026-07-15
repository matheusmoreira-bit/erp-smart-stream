import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  Loader2,
  FileText,
  FileCheck2,
  Send,
  Calendar,
  Wallet,
  AlertTriangle,
  Flame,
} from "lucide-react";

export interface SapPoDetailsProps {
  companyDb?: string | null;
  sapDocEntry?: number | null;
  sapDocNum?: number | null;
  /** Data de criação do documento (fallback quando o cache HANA não trouxe data de esboço). */
  createdAt?: string | null;
}

interface ApprovalRow {
  id: string;
  approver_name: string | null;
  approver_email: string | null;
  decision: string | null;
  decision_date: string | null;
  step: number | null;
  stage_name: string | null;
  remarks: string | null;
}

interface FluxoRow {
  data_atualizacao_esboco: string | null;
  data_aprovacao: string | null;
  data_lancamento: string | null;
  data_vencimento: string | null;
  data_pagamento: string | null;
  solicitante: string | null;
  aprovador: string | null;
  descricao: string | null;
  centro_custo: string | null;
  marca: string | null;
  departamento: string | null;
  id_pedido: string | null;
}

function fmtDateTime(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso || "—";
  }
}

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return iso || "—";
  }
}

function diffDays(a?: string | null, b?: string | null): number | null {
  if (!a || !b) return null;
  const t1 = new Date(a).getTime();
  const t2 = new Date(b).getTime();
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return null;
  return (t2 - t1) / (1000 * 60 * 60 * 24);
}

function fmtDeltaDays(d: number | null): string {
  if (d == null) return "—";
  const abs = Math.abs(d);
  if (abs < 1) {
    const hrs = Math.round(abs * 24);
    return `${hrs} h`;
  }
  return `${abs.toFixed(abs < 10 ? 1 : 0)} d`;
}

function decisionMeta(decision?: string | null) {
  const d = String(decision || "").toUpperCase();
  if (d === "Y" || d === "APPROVED") {
    return { label: "Aprovado", icon: CheckCircle2, tone: "text-success", bg: "bg-success/10 border-success/30" };
  }
  if (d === "N" || d === "REJECTED") {
    return { label: "Rejeitado", icon: XCircle, tone: "text-destructive", bg: "bg-destructive/10 border-destructive/30" };
  }
  return { label: "Pendente", icon: Clock, tone: "text-cactus-amber", bg: "bg-cactus-amber/10 border-cactus-amber/30" };
}

interface Stage {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  at: string | null;
}

/**
 * Painel de detalhes SAP para um pedido de compra:
 *  - Histórico de aprovações (approval_history alimentado por VW_PEDIDOS_COMPRA_APROVACOES)
 *  - Tempos do fluxo (VW_FIN_ANALISE_FLUXO via sap_fluxo_analise_cache): esboço → aprovação → lançamento → vencimento → pagamento
 *  - Destaca o maior gargalo entre marcos.
 */
export function SapPoDetails({ companyDb, sapDocEntry, sapDocNum, createdAt }: SapPoDetailsProps) {
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<ApprovalRow[]>([]);
  const [fluxo, setFluxo] = useState<FluxoRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyDb || (sapDocEntry == null && sapDocNum == null)) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Histórico: approval_history por doc_entry OR doc_num
        let historyQuery = supabase
          .from("approval_history")
          .select("id, approver_name, approver_email, decision, decision_date, step, stage_name, remarks")
          .eq("company_db", companyDb)
          .order("decision_date", { ascending: true, nullsFirst: true });
        if (sapDocEntry != null) historyQuery = historyQuery.eq("doc_entry", sapDocEntry);
        else if (sapDocNum != null) historyQuery = historyQuery.eq("doc_num", sapDocNum);

        // Fluxo: sap_fluxo_analise_cache por id_pedido (docNum ou docEntry como string)
        const pedidoCandidates = [
          sapDocNum != null ? String(sapDocNum) : null,
          sapDocEntry != null ? String(sapDocEntry) : null,
        ].filter((v): v is string => !!v);

        const fluxoPromise = pedidoCandidates.length
          ? supabase
              .from("sap_fluxo_analise_cache")
              .select(
                "data_atualizacao_esboco, data_aprovacao, data_lancamento, data_vencimento, data_pagamento, solicitante, aprovador, descricao, centro_custo, marca, departamento, id_pedido",
              )
              .eq("company_db", companyDb)
              .in("id_pedido", pedidoCandidates)
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null } as any);

        const [historyRes, fluxoRes] = await Promise.all([historyQuery, fluxoPromise]);
        if (cancelled) return;

        if ((historyRes as any).error) throw (historyRes as any).error;
        if ((fluxoRes as any).error) {
          // fluxo é opcional — não bloqueia histórico
          console.warn("SapPoDetails fluxo error", (fluxoRes as any).error);
        }
        setHistory(((historyRes as any).data || []) as ApprovalRow[]);
        setFluxo(((fluxoRes as any).data ?? null) as FluxoRow | null);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Falha ao carregar detalhes do SAP");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyDb, sapDocEntry, sapDocNum]);

  const stages: Stage[] = useMemo(() => {
    const startDate = fluxo?.data_atualizacao_esboco || createdAt || null;
    return [
      { key: "esboco", label: "Esboço", icon: FileText, at: startDate },
      { key: "aprovacao", label: "Aprovação", icon: ShieldCheck, at: fluxo?.data_aprovacao ?? null },
      { key: "lancamento", label: "Lançamento", icon: FileCheck2, at: fluxo?.data_lancamento ?? null },
      { key: "vencimento", label: "Vencimento", icon: Calendar, at: fluxo?.data_vencimento ?? null },
      { key: "pagamento", label: "Pagamento", icon: Wallet, at: fluxo?.data_pagamento ?? null },
    ];
  }, [fluxo, createdAt]);

  const deltas = useMemo(() => {
    const arr: Array<{ from: Stage; to: Stage; days: number | null }> = [];
    for (let i = 0; i < stages.length - 1; i++) {
      arr.push({ from: stages[i], to: stages[i + 1], days: diffDays(stages[i].at, stages[i + 1].at) });
    }
    return arr;
  }, [stages]);

  const bottleneckIdx = useMemo(() => {
    let idx = -1;
    let max = -1;
    deltas.forEach((d, i) => {
      if (d.days != null && d.days > max) {
        max = d.days;
        idx = i;
      }
    });
    return max > 0 ? idx : -1;
  }, [deltas]);

  const hasFluxo = !!fluxo && stages.some((s) => s.at);
  const hasHistory = history.length > 0;

  if (!companyDb || (sapDocEntry == null && sapDocNum == null)) return null;

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 sm:p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-primary" aria-hidden="true" />
          <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
            Detalhes do SAP
          </span>
        </div>
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded bg-destructive/10 border border-destructive/30 p-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-destructive shrink-0" />
          <p className="text-xs text-destructive flex-1 break-words">{error}</p>
        </div>
      )}

      {/* Tempos do fluxo */}
      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Tempos do fluxo
        </div>
        {!hasFluxo && !loading ? (
          <p className="text-xs text-muted-foreground italic">
            Sem dados de fluxo no cache HANA para este pedido.
          </p>
        ) : (
          <div className="space-y-1.5">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {stages.map((s) => {
                const Icon = s.icon;
                const reached = !!s.at;
                return (
                  <div
                    key={s.key}
                    className={[
                      "rounded-md border px-2 py-1.5",
                      reached ? "border-border bg-background" : "border-dashed border-border/60 bg-muted/10 opacity-60",
                    ].join(" ")}
                  >
                    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <Icon className="w-3 h-3" />
                      {s.label}
                    </div>
                    <div className="mt-0.5 text-xs font-medium text-foreground">
                      {reached ? fmtDate(s.at) : "—"}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Deltas / gargalos */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {deltas.map((d, i) => {
                const isBottleneck = i === bottleneckIdx;
                const isNeg = d.days != null && d.days < 0;
                return (
                  <span
                    key={`${d.from.key}-${d.to.key}`}
                    className={[
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                      isBottleneck
                        ? "border-destructive/40 bg-destructive/10 text-destructive"
                        : isNeg
                          ? "border-cactus-amber/40 bg-cactus-amber/10 text-cactus-amber"
                          : d.days == null
                            ? "border-border bg-muted/30 text-muted-foreground"
                            : "border-border bg-background text-foreground/80",
                    ].join(" ")}
                    title={`${d.from.label} → ${d.to.label}: ${fmtDeltaDays(d.days)}${isNeg ? " (invertido)" : ""}`}
                  >
                    {isBottleneck && <Flame className="w-3 h-3" />}
                    <span className="text-muted-foreground">{d.from.label} →</span>
                    <span>{d.to.label}</span>
                    <span className="font-mono">{fmtDeltaDays(d.days)}</span>
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Histórico de aprovações */}
      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Histórico de aprovações
        </div>
        {!hasHistory && !loading ? (
          <p className="text-xs text-muted-foreground italic">
            Nenhum registro de aprovação sincronizado para este pedido.
          </p>
        ) : (
          <ol className="space-y-1.5">
            {history.map((h, i) => {
              const meta = decisionMeta(h.decision);
              const Icon = meta.icon;
              const prevAt = i > 0 ? history[i - 1].decision_date : fluxo?.data_atualizacao_esboco || createdAt;
              const delta = diffDays(prevAt, h.decision_date);
              return (
                <li
                  key={h.id}
                  className={`flex items-start gap-2 rounded border ${meta.bg} px-2.5 py-1.5`}
                >
                  <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${meta.tone}`} />
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="text-xs font-medium text-foreground truncate">
                        {h.approver_name || h.approver_email || "—"}
                        {h.step != null && (
                          <span className="ml-1.5 text-[10px] text-muted-foreground font-mono">
                            nível {h.step}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className={`text-[10px] ${meta.tone}`}>
                          {meta.label}
                        </Badge>
                        {delta != null && (
                          <span className="text-[10px] text-muted-foreground font-mono">
                            +{fmtDeltaDays(delta)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {h.decision_date ? fmtDateTime(h.decision_date) : "Sem data de decisão"}
                      {h.stage_name && <span className="ml-2">· {h.stage_name}</span>}
                    </div>
                    {h.remarks && (
                      <div className="text-[11px] text-foreground/80 mt-1 whitespace-pre-wrap break-words">
                        {h.remarks}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* Metadados extras do fluxo */}
      {hasFluxo && (fluxo?.centro_custo || fluxo?.marca || fluxo?.departamento || fluxo?.descricao) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[11px] pt-1 border-t border-border/60">
          {fluxo?.centro_custo && (
            <div>
              <span className="text-muted-foreground">Centro de custo: </span>
              <span className="text-foreground">{fluxo.centro_custo}</span>
            </div>
          )}
          {fluxo?.departamento && (
            <div>
              <span className="text-muted-foreground">Departamento: </span>
              <span className="text-foreground">{fluxo.departamento}</span>
            </div>
          )}
          {fluxo?.marca && (
            <div>
              <span className="text-muted-foreground">Marca: </span>
              <span className="text-foreground">{fluxo.marca}</span>
            </div>
          )}
          {fluxo?.descricao && (
            <div className="sm:col-span-2">
              <span className="text-muted-foreground">Descrição: </span>
              <span className="text-foreground">{fluxo.descricao}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
