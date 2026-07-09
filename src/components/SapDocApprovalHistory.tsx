import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Clock, History, RefreshCw, XOctagon } from "lucide-react";
import { useSap } from "@/contexts/SapContext";
import { sapQuery, type SapSession } from "@/lib/sap-client";
import type { ApprovalHistoryEntry } from "@/hooks/useMyRequests";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

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
  Remarks?: string;
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
  Remarks?: string;
  RemarksFromOriginator?: string;
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

/**
 * ObjectTypes de documentos de compra no SAP B1 que podem ter aprovação:
 *  - 22   PurchaseOrders (Pedido de Compra)
 *  - 20   PurchaseDeliveryNotes (Entrada de Mercadoria / GRPO)
 *  - 18   PurchaseInvoices (Nota Fiscal de Entrada)
 *  - 19   PurchaseCreditNotes (Devolução / Nota de Crédito de Compra)
 *  - 204  DownPayments A/P (Adiantamento a Fornecedor)
 *  - 1470000113  PurchaseRequests (Solicitação de Compra)
 *  - 540000006   PurchaseQuotations (Cotação de Compra)
 */
export const DEFAULT_PURCHASE_OBJECT_TYPES = [
  "22",
  "20",
  "18",
  "19",
  "204",
  "1470000113",
  "540000006",
] as const;

async function fetchApprovalRequests(
  session: SapSession,
  docEntry: number,
  objectTypes: string[],
): Promise<SLApprovalRequest[]> {
  const tryFilter = async (filter: string): Promise<SLApprovalRequest[]> => {
    // Ordenamos por AbsoluteEntry desc para trazer a solicitação mais recente
    // primeiro (útil quando o documento foi reenviado para aprovação após
    // rejeição — cada envio gera uma nova ApprovalRequest para o mesmo
    // ObjectEntry, e queremos manter todas em ordem cronológica invertida).
    const path = `ApprovalRequests?$filter=${encodeURIComponent(filter)}&$orderby=AbsoluteEntry desc&$top=20`;
    try {
      const res = await sapQuery(session, path, undefined, false);
      const data = res.data as { value?: SLApprovalRequest[] } | SLApprovalRequest[];
      return Array.isArray(data) ? data : (data?.value || []);
    } catch {
      return [];
    }
  };

  const dedupe = (arr: SLApprovalRequest[]): SLApprovalRequest[] => {
    const seen = new Set<number>();
    const out: SLApprovalRequest[] = [];
    for (const r of arr) {
      const code = Number(r.Code || 0);
      if (code && !seen.has(code)) { seen.add(code); out.push(r); }
    }
    return out;
  };

  const types = objectTypes.length > 0 ? objectTypes : [...DEFAULT_PURCHASE_OBJECT_TYPES];

  // 1) ObjectEntry — nome canônico do vínculo doc → ApprovalRequest no Service
  //    Layer (a ligação é lógica, via ObjectType + ObjectEntry — não FK direta).
  const objResults = await Promise.all(
    types.map((t) => tryFilter(`ObjectEntry eq ${docEntry} and ObjectType eq '${t}'`)),
  );
  let raw = dedupe(objResults.flat());

  // 2) Fallback: DocumentEntry (algumas versões do SL expõem esse alias)
  if (raw.length === 0) {
    const docResults = await Promise.all(
      types.map((t) => tryFilter(`DocumentEntry eq ${docEntry} and ObjectType eq '${t}'`)),
    );
    raw = dedupe(docResults.flat());
  }

  // 3) Fallback: DraftEntry (documento ainda como rascunho ODRF)
  if (raw.length === 0) {
    const draftResults = await Promise.all(
      types.map((t) => tryFilter(`DraftEntry eq ${docEntry} and ObjectType eq '${t}'`)),
    );
    raw = dedupe(draftResults.flat());
  }

  // 4) Último fallback: sem filtro de ObjectType (cobre tipos não listados
  //    e variações de patch level onde o campo do vínculo é outro).
  if (raw.length === 0) {
    const [byObj, byDoc, byDraft] = await Promise.all([
      tryFilter(`ObjectEntry eq ${docEntry}`),
      tryFilter(`DocumentEntry eq ${docEntry}`),
      tryFilter(`DraftEntry eq ${docEntry}`),
    ]);
    raw = dedupe([...byObj, ...byDoc, ...byDraft]);
  }

  return raw;
}

interface SapDocApprovalHistoryProps {
  /** DocEntry ou DraftEntry do documento no SAP. */
  docEntry?: number | null;
  /**
   * ObjectType(s) do documento no SAP. Aceita string (compat) ou array.
   * Padrão: tipos comuns de documentos de compra (PO, GRPO, Invoice, Credit, Downpayment,
   * Purchase Request, Purchase Quotation).
   */
  objectType?: string | string[];
}

interface ResolvedRequest {
  code: number;
  statusLabel: string;
  templateName: string;
  /** Observação enviada pelo originador do pedido no SAP (nível da request). */
  originatorRemarks: string;
  history: ApprovalHistoryEntry[];
}

function formatDate(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch { return iso; }
}

// Cache em memória para reduzir chamadas repetidas ao Service Layer
// ao reabrir o mesmo pedido durante a sessão.
const RESOLVED_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
const resolvedCache = new Map<string, { at: number; data: ResolvedRequest[] }>();
const inflightCache = new Map<string, Promise<ResolvedRequest[]>>();

function cacheKey(session: SapSession, docEntry: number, objectType: string): string {
  return `${session.companyDB || "default"}::${objectType}::${docEntry}`;
}

export function invalidateSapDocApprovalCache(docEntry?: number) {
  if (docEntry == null) {
    resolvedCache.clear();
    inflightCache.clear();
    return;
  }
  for (const key of Array.from(resolvedCache.keys())) {
    if (key.endsWith(`::${docEntry}`)) resolvedCache.delete(key);
  }
  for (const key of Array.from(inflightCache.keys())) {
    if (key.endsWith(`::${docEntry}`)) inflightCache.delete(key);
  }
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

export function SapDocApprovalHistory({ docEntry, objectType }: SapDocApprovalHistoryProps) {
  const { session } = useSap();
  const [loading, setLoading] = useState(false);
  const [requests, setRequests] = useState<ResolvedRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const handleRetry = () => {
    if (docEntry) invalidateSapDocApprovalCache(docEntry);
    setReloadKey((k) => k + 1);
  };

  // Normaliza objectType para array; usa defaults de compra quando não informado.
  const objectTypes: string[] = Array.isArray(objectType)
    ? objectType
    : objectType
      ? [objectType]
      : [...DEFAULT_PURCHASE_OBJECT_TYPES];
  const objectTypesKey = objectTypes.join(",");

  useEffect(() => {
    if (!session || session.erpType !== "sap" || !docEntry) {
      setRequests([]);
      return;
    }
    let cancelled = false;
    const key = cacheKey(session as SapSession, docEntry, objectTypesKey);

    // Cache hit: sirva imediatamente sem tocar o Service Layer.
    const cached = resolvedCache.get(key);
    if (cached && Date.now() - cached.at < RESOLVED_CACHE_TTL_MS) {
      setRequests(cached.data);
      setLoading(false);
      setError(null);
      return () => { cancelled = true; };
    }

    const loader = inflightCache.get(key) ?? (async (): Promise<ResolvedRequest[]> => {
      const raw = await fetchApprovalRequests(session as SapSession, docEntry, objectTypes);
      if (raw.length === 0) return [];

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
          // Combina observações da decisão + linha (se distintas) para não perder nenhum comentário.
          const decisionRemarks = (d.Remarks || "").trim();
          const lineRemarks = (line?.Remarks || "").trim();
          const remarks = decisionRemarks && lineRemarks && decisionRemarks !== lineRemarks
            ? `${decisionRemarks}\n\n${lineRemarks}`
            : (decisionRemarks || lineRemarks);
          return {
            step,
            stageName: stage?.Name || templateName || "—",
            approverName: user?.UserName || user?.UserCode || "—",
            approverEmail: user?.eMail || "",
            status: info.key,
            statusLabel: info.label,
            date: d.UpdateDate || d.CreateDate || "",
            remarks,
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
              remarks: (l.Remarks || "").trim(),
            });
          }
        }

        const originatorRemarks = (r.RemarksFromOriginator || r.Remarks || "").trim();
        return { code: Number(r.Code || 0), statusLabel, templateName, originatorRemarks, history };
      });

      return resolved;
    })();

    // Deduplica chamadas concorrentes para o mesmo pedido.
    if (!inflightCache.has(key)) inflightCache.set(key, loader);

    setLoading(true);
    setError(null);
    loader
      .then((resolved) => {
        resolvedCache.set(key, { at: Date.now(), data: resolved });
        if (!cancelled) setRequests(resolved);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Falha ao carregar histórico do ERP");
      })
      .finally(() => {
        inflightCache.delete(key);
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [session, docEntry, objectTypesKey, reloadKey]);

  if (!session || session.erpType !== "sap" || !docEntry) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <History className="w-3.5 h-3.5" aria-hidden="true" /> Histórico de Aprovação (ERP)
      </p>
      {loading ? (
        <div className="space-y-3" role="status" aria-live="polite" aria-label="Carregando histórico do ERP">
          <div className="flex items-center gap-2 flex-wrap">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-20 rounded" />
            <Skeleton className="h-4 w-12 rounded" />
          </div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-start gap-3 border border-border rounded-lg p-3 bg-muted/20">
              <Skeleton className="w-4 h-4 rounded-full mt-0.5" />
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-16 rounded" />
                </div>
                <Skeleton className="h-3 w-48" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="flex items-start gap-2 border border-destructive/30 bg-destructive/5 rounded-lg p-3">
          <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-destructive">Não foi possível carregar o histórico do ERP</p>
            <p className="text-xs text-muted-foreground mt-0.5 break-words">{error}</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleRetry}
            className="h-7 px-2 text-xs shrink-0"
          >
            <RefreshCw className="w-3 h-3 mr-1" aria-hidden="true" />
            Tentar novamente
          </Button>
        </div>
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
                {req.originatorRemarks && (
                  <p className="text-xs text-foreground bg-muted/40 border border-border rounded p-2 whitespace-pre-wrap">
                    <span className="font-medium text-muted-foreground">Observação do solicitante:</span>{" "}
                    {req.originatorRemarks}
                  </p>
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
                              <p className="text-xs text-foreground bg-background/60 rounded p-2 mt-2 whitespace-pre-wrap">{h.remarks}</p>
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
