import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  CheckCircle2,
  XCircle,
  UserCog,
  Clock,
  Loader2,
  History,
  FileText,
  RotateCcw,
  Pencil,
  Send,
  CalendarClock,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type DelegationStatus = "ativa" | "revogada" | "substituida" | "consumida" | "expirada";
type SubstituteStatus = "ativa" | "expirada" | "agendada" | "revogada";

interface DelegationBadge {
  kind: "delegation";
  status: DelegationStatus;
}

interface SubstitutePeriod {
  kind: "substitute";
  status: SubstituteStatus;
  startsAt: string;
  endsAt: string;
  revokedAt?: string | null;
  reason?: string | null;
}

interface HistoryEvent {
  id: string;
  at: string;
  kind: "delegate" | "approve" | "reject" | "created" | "updated" | "cancelled" | "reverted" | "transfer" | "other";
  actorLabel: string;
  actorEmail?: string;
  title: string;
  detail?: string;
  reason?: string;
  source: "audit_log" | "expense_approval_log";
  badge?: DelegationBadge | SubstitutePeriod;
}

interface Props {
  expenseId: string;
}

const norm = (s?: string | null) => (s || "").toLowerCase().trim();
const emailPrefix = (e?: string | null) => {
  const n = norm(e);
  const i = n.indexOf("@");
  return i > 0 ? n.slice(0, i) : n;
};

function computeSubstituteStatus(row: {
  starts_at: string;
  ends_at: string;
  revoked_at?: string | null;
}): SubstituteStatus {
  if (row.revoked_at) return "revogada";
  const now = Date.now();
  const s = new Date(row.starts_at).getTime();
  const e = new Date(row.ends_at).getTime();
  if (now < s) return "agendada";
  if (now > e) return "expirada";
  return "ativa";
}

const delegationStatusLabel: Record<DelegationStatus, string> = {
  ativa: "Delegação ativa",
  revogada: "Delegação revogada",
  substituida: "Delegação substituída",
  consumida: "Delegação consumida",
  expirada: "Delegação expirada",
};

const delegationStatusStyle: Record<DelegationStatus, string> = {
  ativa: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  revogada: "bg-destructive/15 text-destructive border-destructive/30",
  substituida: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  consumida: "bg-muted text-muted-foreground border-border",
  expirada: "bg-muted text-muted-foreground border-border",
};

const substituteStatusLabel: Record<SubstituteStatus, string> = {
  ativa: "Substituição ativa",
  agendada: "Substituição agendada",
  expirada: "Substituição expirada",
  revogada: "Substituição revogada",
};

const substituteStatusStyle: Record<SubstituteStatus, string> = {
  ativa: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  agendada: "bg-primary/15 text-primary border-primary/30",
  expirada: "bg-muted text-muted-foreground border-border",
  revogada: "bg-destructive/15 text-destructive border-destructive/30",
};

/**
 * Detailed timeline for INTERNAL approval documents. Merges audit_log +
 * expense_approval_log, and enriches events with:
 * - Delegation status (ativa/revogada/substituída/consumida) so you can see
 *   whether a past delegation is still in effect.
 * - Substitute grant period (starts_at → ends_at) and current status for
 *   any decision taken "em nome de" someone, so you know when the on-behalf
 *   authorization was valid.
 */
export function InternalApprovalHistory({ expenseId }: Props) {
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!expenseId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [auditRes, decRes, expRes] = await Promise.all([
        supabase
          .from("audit_log")
          .select("id, action, actor_email, details, created_at")
          .eq("entity_type", "expense")
          .eq("entity_id", expenseId)
          .order("created_at", { ascending: true }),
        supabase
          .from("expense_approval_log")
          .select(
            "id, level_order, approver_name, approver_email, decision, remarks, decided_at, created_at, substituted_for_email, substituted_for_name, action_role",
          )
          .eq("expense_id", expenseId)
          .order("created_at", { ascending: true }),
        supabase
          .from("expenses")
          .select("status")
          .eq("id", expenseId)
          .maybeSingle(),
      ]);

      if (cancelled) return;

      const auditRows = auditRes.data || [];
      const decRows = decRes.data || [];
      const expenseStatus = (expRes.data as { status?: string } | null)?.status || null;

      // ── Load substitute grants that could match any "on behalf of" decision
      // in this expense (by substitute_email <-> approver_email and
      // official_email <-> substituted_for_email). We fetch all candidates
      // and pick per-decision by validity around decided_at.
      const substCandidates = new Set<string>();
      for (const r of decRows) {
        if (r.substituted_for_email || r.substituted_for_name) {
          const sub = norm(r.approver_email);
          const off = norm(r.substituted_for_email);
          if (sub) substCandidates.add(sub);
          if (off) substCandidates.add(off);
        }
      }
      let substituteRows: Array<{
        id: string;
        substitute_email: string;
        official_email: string;
        starts_at: string;
        ends_at: string;
        revoked_at: string | null;
        reason: string | null;
      }> = [];
      if (substCandidates.size > 0) {
        const arr = Array.from(substCandidates);
        const { data: subs } = await supabase
          .from("approver_substitutes")
          .select("id, substitute_email, official_email, starts_at, ends_at, revoked_at, reason")
          .or(
            [
              `substitute_email.in.(${arr.map((e) => `"${e}"`).join(",")})`,
              `official_email.in.(${arr.map((e) => `"${e}"`).join(",")})`,
            ].join(","),
          );
        substituteRows = (subs as typeof substituteRows) || [];
      }

      const findGrantForDecision = (
        approverEmail: string | null,
        officialEmail: string | null,
        decidedAt: string,
      ) => {
        const sub = norm(approverEmail);
        const subPrefix = emailPrefix(approverEmail);
        const off = norm(officialEmail);
        const offPrefix = emailPrefix(officialEmail);
        const t = new Date(decidedAt).getTime();
        // Prefer a grant that was valid at decidedAt; otherwise any grant
        // that connects the two identities.
        const matches = substituteRows.filter((g) => {
          const gs = norm(g.substitute_email);
          const gsP = emailPrefix(g.substitute_email);
          const go = norm(g.official_email);
          const goP = emailPrefix(g.official_email);
          const subHit = !!sub && (gs === sub || gsP === subPrefix);
          const offHit = !!off && (go === off || goP === offPrefix);
          return subHit && offHit;
        });
        if (matches.length === 0) return null;
        const validAtDecision = matches.find((g) => {
          const s = new Date(g.starts_at).getTime();
          const e = new Date(g.ends_at).getTime();
          const notRevokedYet = !g.revoked_at || new Date(g.revoked_at).getTime() > t;
          return t >= s && t <= e && notRevokedYet;
        });
        return validAtDecision || matches[0];
      };

      // ── Build map: for each delegate_approval audit row, when did it stop
      // being the effective delegation? We look at subsequent audit rows.
      const auditByIndex = auditRows.map((r, i) => ({ r, i }));
      const finalDecided = decRows.find(
        (d) => d.decision === "approve" || d.decision === "aprovado" || d.decision === "reject" || d.decision === "rejeitado",
      );
      const isTerminal = expenseStatus === "aprovado" || expenseStatus === "rejeitado" || expenseStatus === "cancelado";

      const list: HistoryEvent[] = [];

      for (const { r, i } of auditByIndex) {
        const d = (r.details || {}) as Record<string, unknown>;
        const action = r.action || "";
        const actor = (d.delegatedBy as string) || r.actor_email || "—";

        if (action === "delegate_approval") {
          const from = (d.previousApprover as string) || "";
          const to = (d.newApproverName as string) || (d.newApproverEmail as string) || "";

          // Determine current status of THIS delegation.
          let status: DelegationStatus = "ativa";
          const later = auditRows.slice(i + 1);
          const laterRevoke = later.find((x) => x.action === "revoke_delegation");
          const laterDelegate = later.find((x) => x.action === "delegate_approval");
          const decisionAfter = decRows.find(
            (dec) => new Date(dec.created_at).getTime() > new Date(r.created_at).getTime(),
          );
          if (laterRevoke && (!laterDelegate || new Date(laterRevoke.created_at) < new Date(laterDelegate.created_at))) {
            status = "revogada";
          } else if (laterDelegate) {
            status = "substituida";
          } else if (decisionAfter) {
            status = "consumida";
          } else if (isTerminal) {
            status = "expirada";
          }

          list.push({
            id: `au-${r.id}`,
            at: r.created_at,
            kind: "delegate",
            actorLabel: actor,
            actorEmail: r.actor_email || undefined,
            title: `Delegou aprovação${from ? ` de ${from}` : ""}${to ? ` para ${to}` : ""}`,
            reason: (d.reason as string) || undefined,
            source: "audit_log",
            badge: { kind: "delegation", status },
          });
        } else if (action === "revoke_delegation") {
          const from = (d.revokedFrom as string) || "";
          const to = (d.restoredApprover as string) || "";
          list.push({
            id: `au-${r.id}`,
            at: r.created_at,
            kind: "transfer",
            actorLabel: (d.revokedBy as string) || r.actor_email || "—",
            actorEmail: r.actor_email || undefined,
            title: `Revogou delegação${from ? ` de ${from}` : ""}${to ? ` — aprovação devolvida para ${to}` : ""}`,
            reason: (d.reason as string) || undefined,
            source: "audit_log",
          });
        } else if (action === "transfer_approval") {
          const from = (d.fromApprover as string) || (d.previousApprover as string) || "";
          const to = (d.toApprover as string) || (d.newApproverName as string) || "";
          list.push({
            id: `au-${r.id}`,
            at: r.created_at,
            kind: "transfer",
            actorLabel: actor,
            actorEmail: r.actor_email || undefined,
            title: `Transferiu aprovação${from ? ` de ${from}` : ""}${to ? ` para ${to}` : ""}`,
            reason: (d.reason as string) || undefined,
            source: "audit_log",
          });
        } else if (action === "sap_document_created") {
          list.push({
            id: `au-${r.id}`,
            at: r.created_at,
            kind: "created",
            actorLabel: actor,
            actorEmail: r.actor_email || undefined,
            title: `Documento criado no SAP${d.sap_doc_num ? ` (Nº ${d.sap_doc_num})` : ""}`,
            source: "audit_log",
          });
        } else if (action === "expense_cancelled_manual_sap") {
          list.push({
            id: `au-${r.id}`,
            at: r.created_at,
            kind: "cancelled",
            actorLabel: actor,
            actorEmail: r.actor_email || undefined,
            title: "Despesa cancelada manualmente (SAP)",
            reason: (d.reason as string) || undefined,
            source: "audit_log",
          });
        } else if (action === "expense_reverted_audit") {
          list.push({
            id: `au-${r.id}`,
            at: r.created_at,
            kind: "reverted",
            actorLabel: actor,
            actorEmail: r.actor_email || undefined,
            title: "Decisão revertida por auditoria",
            reason: (d.reason as string) || undefined,
            source: "audit_log",
          });
        } else if (action === "update_expense") {
          const fields = Array.isArray(d.changedFields) ? (d.changedFields as string[]).join(", ") : "";
          list.push({
            id: `au-${r.id}`,
            at: r.created_at,
            kind: "updated",
            actorLabel: actor,
            actorEmail: r.actor_email || undefined,
            title: `Despesa atualizada${fields ? ` (${fields})` : ""}`,
            source: "audit_log",
          });
        } else {
          list.push({
            id: `au-${r.id}`,
            at: r.created_at,
            kind: "other",
            actorLabel: actor,
            actorEmail: r.actor_email || undefined,
            title: action.replace(/_/g, " "),
            source: "audit_log",
          });
        }
      }

      // Reference finalDecided to satisfy noUnusedLocals when configured strict.
      void finalDecided;

      for (const r of decRows) {
        const isApprove = r.decision === "approve" || r.decision === "aprovado";
        const isReject = r.decision === "reject" || r.decision === "rejeitado";
        const kind: HistoryEvent["kind"] = isApprove ? "approve" : isReject ? "reject" : "other";
        const title =
          kind === "approve"
            ? `Aprovou (nível ${r.level_order ?? "—"})`
            : kind === "reject"
              ? `Rejeitou (nível ${r.level_order ?? "—"})`
              : `Ação: ${r.decision ?? "—"}`;
        const onBehalfOf = r.substituted_for_name || r.substituted_for_email;
        const substLabel = onBehalfOf ? ` em nome de ${onBehalfOf}` : "";

        let badge: HistoryEvent["badge"] | undefined;
        if (onBehalfOf) {
          const decidedAt = r.decided_at || r.created_at;
          const grant = findGrantForDecision(r.approver_email, r.substituted_for_email, decidedAt);
          if (grant) {
            badge = {
              kind: "substitute",
              status: computeSubstituteStatus(grant),
              startsAt: grant.starts_at,
              endsAt: grant.ends_at,
              revokedAt: grant.revoked_at,
              reason: grant.reason,
            };
          }
        }

        list.push({
          id: `dec-${r.id}`,
          at: r.decided_at || r.created_at,
          kind,
          actorLabel: r.approver_name || r.approver_email || "—",
          actorEmail: r.approver_email || undefined,
          title: title + substLabel,
          reason: r.remarks || undefined,
          source: "expense_approval_log",
          badge,
        });
      }

      list.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
      setEvents(list);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [expenseId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Carregando histórico...
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-2">
        Nenhuma decisão ou delegação registrada ainda.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <History className="w-3.5 h-3.5 text-primary" />
        Histórico
      </div>
      <ol className="relative border-l border-border/60 pl-4 space-y-3">
        {events.map((ev) => {
          const iconMap: Record<HistoryEvent["kind"], typeof CheckCircle2> = {
            approve: CheckCircle2,
            reject: XCircle,
            delegate: UserCog,
            transfer: Send,
            created: FileText,
            updated: Pencil,
            cancelled: XCircle,
            reverted: RotateCcw,
            other: Clock,
          };
          const colorMap: Record<HistoryEvent["kind"], string> = {
            approve: "text-emerald-500",
            reject: "text-destructive",
            delegate: "text-primary",
            transfer: "text-primary",
            created: "text-emerald-500",
            updated: "text-amber-500",
            cancelled: "text-destructive",
            reverted: "text-amber-500",
            other: "text-muted-foreground",
          };
          const Icon = iconMap[ev.kind];
          const iconColor = colorMap[ev.kind];
          return (
            <li key={ev.id} className="relative">
              <span
                className={`absolute -left-[22px] top-0.5 flex items-center justify-center w-4 h-4 rounded-full bg-background border border-border ${iconColor}`}
              >
                <Icon className="w-3 h-3" />
              </span>
              <div className="text-xs">
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className="text-foreground font-medium">{ev.title}</span>
                  <span className="text-muted-foreground">
                    {format(new Date(ev.at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                  </span>
                  {ev.badge?.kind === "delegation" && (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${delegationStatusStyle[ev.badge.status]}`}
                    >
                      {delegationStatusLabel[ev.badge.status]}
                    </span>
                  )}
                  {ev.badge?.kind === "substitute" && (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${substituteStatusStyle[ev.badge.status]}`}
                    >
                      {substituteStatusLabel[ev.badge.status]}
                    </span>
                  )}
                </div>
                <div className="text-muted-foreground">
                  por{" "}
                  <span className="text-foreground">{ev.actorLabel}</span>
                  {ev.actorEmail && ev.actorEmail !== ev.actorLabel && (
                    <span className="text-muted-foreground/80"> · {ev.actorEmail}</span>
                  )}
                </div>
                {ev.badge?.kind === "substitute" && (
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <CalendarClock className="w-3 h-3 text-primary/70" />
                    <span>
                      Validade:{" "}
                      <span className="text-foreground">
                        {format(new Date(ev.badge.startsAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                      </span>{" "}
                      →{" "}
                      <span className="text-foreground">
                        {format(new Date(ev.badge.endsAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                      </span>
                      {ev.badge.revokedAt && (
                        <>
                          {" "}· revogada em{" "}
                          <span className="text-foreground">
                            {format(new Date(ev.badge.revokedAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                          </span>
                        </>
                      )}
                    </span>
                  </div>
                )}
                {ev.reason && (
                  <div className="mt-1 rounded-md bg-muted/40 border border-border/40 px-2 py-1 text-[11px] text-muted-foreground">
                    “{ev.reason}”
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
