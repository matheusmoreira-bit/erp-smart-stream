import { useEffect, useState } from "react";
import { CheckCircle2, Clock, History, Loader2, XOctagon } from "lucide-react";
import { useSap } from "@/contexts/SapContext";
import { sapQuery, type SapSession } from "@/lib/sap-client";
import type { ApprovalHistoryEntry } from "@/hooks/useMyRequests";

/**
 * Histórico de aprovação de um documento diretamente no ERP (SAP B1),
 * consultando ApprovalRequests via Service Layer. Reutiliza o mesmo visual
 * usado em "Meus Pedidos" para manter consistência com o histórico do ERP Flow.
 */

interface SLUser {
  InternalKey?: number;
  UserCode?: string;
  UserName?: string;
  eMail?: string;
}
interface SLDecision {
  Status?: string;
  UserID?: number;
  ApprovalRequestStep?: number;
  CreateDate?: string;
  UpdateDate?: string;
  Remarks?: string;
}
interface SLRequestLine {
  Status?: string;
  UserID?: number;
  StageCode?: number;
  ApprovalRequestStep?: number;
}
interface SLApprovalRequest {
  Code?: number;
  OriginatorID?: number;
  DraftEntry?: number;
  DocumentEntry?: number;
  ObjectType?: string;
  Status?: string;
  CreationDate?: string;
  UpdateDate?: string;
  ApprovalTemplatesID?: number;
  ApprovalRequestDecisions?: SLDecision[];
  ApprovalRequestLines?: SLRequestLine[];
}
interface SLTemplate { Code?: number; Name?: string }
interface SLStage { Code?: number; Name?: string }

const REQUEST_STATUS_LABEL: Record<string, string> = {
  arsPending: "Pendente",
  arsApproved: "Aprovado",
  arsWasNotApproved: "Rejeitado",
  arsNotApproved: "Rejeitado",
  arsCancelled: "Cancelado",
  arsGenerated: "Gerado",
};

const DECISION_STATUS_MAP: Record<string, { key: ApprovalHistoryEntry["status"]; label: string }> = {
  ardApproved: { key: "approved", label: "Aprovado" },
  ardNotApproved: { key: "rejected", label: "Rejeitado" },
  ardWasNotApproved: { key: "rejected", label: "Rejeitado" },
  arsNotApproved: { key: "rejected", label: "Rejeitado" },
  arsWasNotApproved: { key: "rejected", label: "Rejeitado" },
  arsApproved: { key: "approved", label: "Aprovado" },
  ardPending: { key: "pending", label: "Pendente" },
  asPending: { key: "pending", label: "Pendente" },
  asWithoutDecision: { key: "without_decision", label: "Sem decisão" },
};

async function fetchUsersByIds(session: SapSession, ids: number[]): Promise<Map<number, SLUser>> {
  const map = new Map<number, SLUser>();
  const unique = Array.from(new Set(ids.filter((id) => Number.isFinite(id) && id > 0)));
  await Promise.all(
    unique.map(async (id) => {
      try {
        const res = await sapQuery(
          session,
          `Users(${id})?$select=InternalKey,UserCode,UserName,eMail`,
          undefined,
          true,
        );
        const u = res.data as SLUser;
        if (u && typeof u.InternalKey === "number") map.set(u.InternalKey, u);
      } catch { /* ignore */ }
    }),
  );
  return map;
}

async function fetchTemplate(session: SapSession, id: number): Promise<SLTemplate | null> {
  try {
    const res = await sapQuery(session, `ApprovalTemplates(${id})?$select=Code,Name`, undefined, true);
    return res.data as SLTemplate;
  } catch { return null; }
}

async function fetchStage(session: SapSession, code: number): Promise<SLStage | null> {
  try {
    const res = await sapQuery(session, `ApprovalStages(${code})?$select=Code,Name`, undefined, true);
    return res.data as SLStage;
  } catch { return null; }
}

async function fetchApprovalRequests(
  session: SapSession,
  docEntry: number,
  objectType: string,
): Promise<SLApprovalRequest[]> {
  // Primeiro tenta pelo documento gerado; se vazio, tenta pelo draft de origem.
  const tryFilter = async (filter: string): Promise<SLApprovalRequest[]> => {
    const path = `ApprovalRequests?$filter=${encodeURIComponent(filter)}&$orderby=CreationDate desc&$top=20`;
    const res = await sapQuery(session, path, undefined, false);
    const data = res.data as { value?: SLApprovalRequest[] } | SLApprovalRequest[];
    return Array.isArray(data) ? data : (data?.value || []);
  };

  try {
    let raw = await tryFilter(`DocumentEntry eq ${docEntry} and ObjectType eq '${objectType}'`);
    if (raw.length === 0) {
      raw = await tryFilter(`DraftEntry eq ${docEntry} and ObjectType eq '${objectType}'`);
    }
    return raw;
  } catch {
    return [];
  }
}

interface SapDocApprovalHistoryProps {
  /** DocEntry do documento no SAP (PurchaseOrders, Invoices, etc.). */
  docEntry?: number | null;
  /** ObjectType do documento no SAP. Padrão: "22" (Pedido de Compra). */
  objectType?: string;
}

interface ResolvedRequest {
  code: number;
  statusLabel: string;
  templateName: string;
  history: ApprovalHistoryEntry[];
}

function formatDate(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch { return iso; }
}

function StatusPill({ status, label }: { status: ApprovalHistoryEntry["status"]; label: string }) {
  const cls =
    status === "approved" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
    : status === "rejected" ? "bg-destructive/10 text-destructive border-destructive/30"
    : status === "without_decision" ? "bg-muted text-muted-foreground border-border"
    : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30";
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wider border rounded px-1.5 py-0.5 ${cls}`}>
      {label}
    </span>
  );
}

export function SapDocApprovalHistory({ docEntry, objectType = "22" }: SapDocApprovalHistoryProps) {
  const { session } = useSap();
  const [loading, setLoading] = useState(false);
  const [requests, setRequests] = useState<ResolvedRequest[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session || session.erpType !== "sap" || !docEntry) {
      setRequests([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const raw = await fetchApprovalRequests(session as SapSession, docEntry, objectType);
        if (cancelled) return;
        if (raw.length === 0) { setRequests([]); return; }

        // Enrich: users, stages, templates
        const userIds = new Set<number>();
        const stageCodes = new Set<number>();
        const templateIds = new Set<number>();
        for (const r of raw) {
          if (r.ApprovalTemplatesID) templateIds.add(r.ApprovalTemplatesID);
          for (const d of r.ApprovalRequestDecisions || []) {
            if (d.UserID) userIds.add(d.UserID);
          }
          for (const l of r.ApprovalRequestLines || []) {
            if (l.UserID) userIds.add(l.UserID);
            const s = l.StageCode || l.ApprovalRequestStep;
            if (s) stageCodes.add(Number(s));
          }
        }

        const [usersMap, templateEntries, stageEntries] = await Promise.all([
          fetchUsersByIds(session as SapSession, Array.from(userIds)),
          Promise.all(Array.from(templateIds).map(async (id) => [id, await fetchTemplate(session as SapSession, id)] as const)),
          Promise.all(Array.from(stageCodes).map(async (code) => [code, await fetchStage(session as SapSession, code)] as const)),
        ]);
        if (cancelled) return;

        const templatesMap = new Map<number, SLTemplate>();
        for (const [id, t] of templateEntries) if (t) templatesMap.set(id, t);
        const stagesMap = new Map<number, SLStage>();
        for (const [code, s] of stageEntries) if (s) stagesMap.set(code, s);

        const resolved: ResolvedRequest[] = raw.map((r) => {
          const templateName = r.ApprovalTemplatesID
            ? templatesMap.get(r.ApprovalTemplatesID)?.Name || ""
            : "";
          const statusLabel = REQUEST_STATUS_LABEL[r.Status || ""] || r.Status || "—";

          const linesByStep = new Map<number, SLRequestLine>();
          for (const l of r.ApprovalRequestLines || []) {
            const step = Number(l.ApprovalRequestStep || 0);
            if (step) linesByStep.set(step, l);
          }
          const decisions = (r.ApprovalRequestDecisions || []).slice().sort((a, b) => {
            const sa = Number(a.ApprovalRequestStep || 0);
            const sb = Number(b.ApprovalRequestStep || 0);
            if (sa !== sb) return sa - sb;
            return (a.UpdateDate || "").localeCompare(b.UpdateDate || "");
          });

          const history: ApprovalHistoryEntry[] = decisions.map((d) => {
            const step = Number(d.ApprovalRequestStep || 0);
            const line = linesByStep.get(step);
            const stageCode = line?.StageCode ? Number(line.StageCode) : undefined;
            const stage = stageCode ? stagesMap.get(stageCode) : undefined;
            const user = d.UserID ? usersMap.get(d.UserID) : (line?.UserID ? usersMap.get(line.UserID) : undefined);
            const info = DECISION_STATUS_MAP[d.Status || ""] || { key: "pending" as const, label: d.Status || "—" };
            return {
              step,
              stageName: stage?.Name || templateName || "—",
              approverName: user?.UserName || user?.UserCode || "—",
              approverEmail: user?.eMail || "",
              status: info.key,
              statusLabel: info.label,
              date: d.UpdateDate || d.CreateDate || "",
              remarks: d.Remarks || "",
            };
          });

          if (history.length === 0 && (r.ApprovalRequestLines || []).length > 0) {
            const lines = (r.ApprovalRequestLines || []).slice().sort(
              (a, b) => Number(a.ApprovalRequestStep || 0) - Number(b.ApprovalRequestStep || 0),
            );
            for (const l of lines) {
              const step = Number(l.ApprovalRequestStep || 0);
              const stageCode = l.StageCode ? Number(l.StageCode) : undefined;
              const stage = stageCode ? stagesMap.get(stageCode) : undefined;
              const user = l.UserID ? usersMap.get(l.UserID) : undefined;
              const info = DECISION_STATUS_MAP[l.Status || ""] || { key: "pending" as const, label: "Pendente" };
              history.push({
                step,
                stageName: stage?.Name || templateName || "—",
                approverName: user?.UserName || user?.UserCode || "—",
                approverEmail: user?.eMail || "",
                status: info.key,
                statusLabel: info.label,
                date: "",
                remarks: "",
              });
            }
          }

          return { code: Number(r.Code || 0), statusLabel, templateName, history };
        });

        setRequests(resolved);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Falha ao carregar histórico do ERP");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [session, docEntry, objectType]);

  if (!session || session.erpType !== "sap" || !docEntry) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <History className="w-3.5 h-3.5" aria-hidden="true" /> Histórico de Aprovação (ERP)
      </p>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Carregando histórico do ERP…
        </div>
      ) : error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : requests.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">Nenhum fluxo de aprovação encontrado no ERP para este documento.</p>
      ) : (
        <div className="space-y-4">
          {requests.map((req) => {
            const currentStep = req.history.find((h) => h.status === "pending")?.step;
            return (
              <div key={req.code} className="space-y-2">
                {(req.templateName || req.statusLabel) && (
                  <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                    {req.templateName && (
                      <span className="text-foreground font-medium">{req.templateName}</span>
                    )}
                    {req.statusLabel && (
                      <span className="text-[10px] font-semibold uppercase tracking-wider bg-muted border border-border rounded px-1.5 py-0.5">
                        {req.statusLabel}
                      </span>
                    )}
                    <span className="font-mono">#{req.code}</span>
                  </div>
                )}
                {req.history.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">Sem etapas registradas.</p>
                ) : (
                  <div className="space-y-2">
                    {req.history.map((h, i) => {
                      const isCurrent = h.status === "pending" && h.step === currentStep;
                      return (
                        <div
                          key={i}
                          className={`flex items-start gap-3 border rounded-lg p-3 ${
                            isCurrent
                              ? "border-amber-500/50 bg-amber-500/5 ring-1 ring-amber-500/30"
                              : "border-border bg-muted/20"
                          }`}
                        >
                          <div className="mt-0.5">
                            {h.status === "approved" ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-500" aria-hidden="true" />
                            ) : h.status === "rejected" ? (
                              <XOctagon className="w-4 h-4 text-destructive" aria-hidden="true" />
                            ) : (
                              <Clock className="w-4 h-4 text-amber-500" aria-hidden="true" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium text-foreground">{h.stageName}</span>
                              <StatusPill status={h.status} label={h.statusLabel} />
                              {isCurrent && (
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">
                                  Aprovador atual
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              <span className="text-foreground font-medium">{h.approverName}</span>
                              {h.approverEmail && <span> · {h.approverEmail}</span>}
                            </p>
                            {h.date && (
                              <p className="text-xs text-muted-foreground mt-0.5 font-mono">{formatDate(h.date)}</p>
                            )}
                            {h.remarks && (
                              <p className="text-xs text-foreground bg-background/60 rounded p-2 mt-2">{h.remarks}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
