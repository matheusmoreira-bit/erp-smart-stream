import type { Usr5Record } from "@/hooks/useUserActivity";
import { getActionLabel, getSourceLabel, isFailedLogin } from "@/hooks/useUserActivity";
import type { FlowActivityRecord } from "@/hooks/useFlowActivity";
import { getFlowActionLabel, isFlowNegativeAction } from "@/hooks/useFlowActivity";

export type ActivitySystem = "sap" | "flow";

export interface UnifiedActivityEvent {
  id: string;
  system: ActivitySystem;
  /** ISO-ish sortable key: YYYY-MM-DDTHH:mm:ss */
  sortKey: string;
  date: Date | null;
  user: string;
  actionLabel: string;
  /** Chave crua da ação (Action do USR5 ou action do Flow) */
  actionKey: string;
  negative: boolean;
  sourceLabel: string;
  ip: string;
  machine: string;
  detail: string;
  durationMinutes: number;
}

function usr5DateTime(r: Usr5Record): { date: Date | null; sortKey: string } {
  const m = (r.Date || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  const t = String(r.Time ?? 0).padStart(6, "0");
  if (!m) return { date: null, sortKey: `0000-00-00T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}` };
  const date = new Date(
    +m[1],
    +m[2] - 1,
    +m[3],
    +t.slice(0, 2),
    +t.slice(2, 4),
    +t.slice(4, 6)
  );
  return { date, sortKey: `${m[1]}-${m[2]}-${m[3]}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}` };
}

export function sapEventFrom(r: Usr5Record, index: number): UnifiedActivityEvent {
  const { date, sortKey } = usr5DateTime(r);
  const failed = isFailedLogin(r);
  return {
    id: `sap-${r.UserCode}-${r.Date}-${r.Time}-${index}`,
    system: "sap",
    sortKey,
    date,
    user: r.UserCode || "—",
    actionLabel: failed ? "Falha de Login" : getActionLabel(r.Action),
    actionKey: r.Action,
    negative: failed || r.Action === "K",
    sourceLabel: getSourceLabel(r.Source),
    ip: r.ClientIP || "",
    machine: r.ClientName || "",
    detail: r.ReasonDesc || "",
    durationMinutes: r.AliveDurtn || 0,
  };
}

export function flowEventFrom(r: FlowActivityRecord, index: number): UnifiedActivityEvent {
  const d = r.ts ? new Date(r.ts) : null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const sortKey = d
    ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    : "0000-00-00T00:00:00";
  return {
    id: `flow-${r.entity_id ?? "x"}-${r.ts}-${index}`,
    system: "flow",
    sortKey,
    date: d,
    user: r.actor_name || r.actor_email || "—",
    actionLabel: getFlowActionLabel(r.action),
    actionKey: r.action,
    negative: isFlowNegativeAction(r.action),
    sourceLabel: "ERP Flow",
    ip: "",
    machine: "",
    detail: (r.detail || "").slice(0, 160),
    durationMinutes: 0,
  };
}

export function mergeActivity(
  sap: Usr5Record[],
  flow: FlowActivityRecord[]
): UnifiedActivityEvent[] {
  const events = [
    ...sap.map((r, i) => sapEventFrom(r, i)),
    ...flow.map((r, i) => flowEventFrom(r, i)),
  ];
  return events.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
}

export function formatEventDateTime(e: UnifiedActivityEvent): string {
  if (!e.date) return e.sortKey.replace("T", " ");
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(e.date.getDate())}/${pad(e.date.getMonth() + 1)}/${e.date.getFullYear()} ${pad(e.date.getHours())}:${pad(e.date.getMinutes())}`;
}
