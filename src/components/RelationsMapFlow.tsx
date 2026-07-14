import { useMemo, useCallback, memo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  FileCheck2,
  ShieldCheck,
  Receipt,
  Wallet,
  CheckCircle2,
  Clock,
  XCircle,
  Ban,
  CreditCard,
  FileText,
  Paperclip,
} from "lucide-react";
import type { NfEntradaLink, ContaPagarLink } from "@/hooks/useRelationsMapDerived";
import type { RelationsMapExpense } from "./RelationsMap";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type ChainRow = {
  level_order: number;
  approver_name: string;
  approver_email: string | null;
  done: boolean;
  isCurrent: boolean;
  rejected?: boolean;
  decidedAt?: string | null;
  remarks?: string | null;
};

export type RelationsFlowType = "compras" | "pagcorp";

interface Props {
  expense: RelationsMapExpense;
  approverRows: ChainRow[];
  nfLinks: NfEntradaLink[];
  apPayables: ContaPagarLink[];
  enriched: boolean;
  flowType?: RelationsFlowType;
  onNodeClick?: (id: string, kind: string) => void;
}

function formatCurrency(value?: number | null, currency?: string | null) {
  if (value === undefined || value === null) return "—";
  const code = currency && /^[A-Z]{3}$/.test(currency) ? currency : "BRL";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(value);
}

function formatDateShort(iso?: string | null) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return null;
  }
}

/* ────────────────────────────── Layout constants ────────────────────────────── */

const COL_WIDTH = 300;         // horizontal spacing between columns (center-to-center)
const CARD_WIDTH = 240;
const CARD_SPACING = 28;       // vertical gap between stacked cards
const CARD_ROW_H = 118;        // approx card height + gap
const HEADER_Y = 24;
const FIRST_CARD_Y = 100;

/* ────────────────────────────── Tones ────────────────────────────── */

type NodeTone = "amber" | "blue" | "green" | "violet" | "success" | "warn" | "muted";

const TONE_STYLES: Record<NodeTone, { border: string; bg: string; accent: string; edge: string }> = {
  amber:   { border: "border-cactus-amber/60",  bg: "bg-cactus-amber/10",  accent: "text-cactus-amber",  edge: "hsl(var(--cactus-amber))" },
  blue:    { border: "border-primary/50",       bg: "bg-primary/5",        accent: "text-primary",       edge: "hsl(var(--primary))" },
  green:   { border: "border-cactus-green/60",  bg: "bg-cactus-green/10",  accent: "text-cactus-green",  edge: "hsl(var(--cactus-green))" },
  violet:  { border: "border-purple-400/60",    bg: "bg-purple-400/10",    accent: "text-purple-400",    edge: "rgb(192, 132, 252)" },
  success: { border: "border-success/60",       bg: "bg-success/10",       accent: "text-success",       edge: "hsl(var(--success))" },
  warn:    { border: "border-destructive/60",   bg: "bg-destructive/10",   accent: "text-destructive",   edge: "hsl(var(--destructive))" },
  muted:   { border: "border-border",           bg: "bg-muted/30",         accent: "text-muted-foreground", edge: "hsl(var(--muted-foreground))" },
};

/* ────────────────────────────── Node components ────────────────────────────── */

interface StageHeaderData extends Record<string, unknown> {
  label: string;
  count: number;
  tone: NodeTone;
  icon: React.ComponentType<{ className?: string }>;
}

const StageHeaderNode = memo(function StageHeaderNode({ data }: NodeProps) {
  const d = data as StageHeaderData;
  const Icon = d.icon;
  const t = TONE_STYLES[d.tone];
  return (
    <div
      className={`pointer-events-none select-none rounded-lg border ${t.border} ${t.bg} px-3 py-1.5 flex items-center gap-2`}
      style={{ width: CARD_WIDTH }}
    >
      <Icon className={`w-3.5 h-3.5 ${t.accent}`} />
      <span className="text-[10px] uppercase tracking-widest font-semibold text-foreground/80">
        {d.label}
      </span>
      {d.count > 0 && (
        <span className="ml-auto text-[10px] font-mono text-muted-foreground">{d.count}</span>
      )}
    </div>
  );
});

interface DocCardData extends Record<string, unknown> {
  tone: NodeTone;
  icon: React.ComponentType<{ className?: string }>;
  kind: string;         // ex.: "Pedido de Compra", "NF"
  identifier: string;   // ex.: "SAP #7350", "NF 10147/9"
  amount?: number | null;
  currency?: string | null;
  status?: string | null;
  statusTone?: NodeTone;
  who?: string | null;      // launched by / requester / approver
  when?: string | null;     // ISO date
  attachmentsCount?: number;
  extra?: string | null;    // optional secondary line (e.g. supplier)
  state?: "current" | "done" | "rejected" | "pending" | "neutral";
  hasSource?: boolean;
  hasTarget?: boolean;
  edgeAnimated?: boolean;
}

const stateBadge = (state: DocCardData["state"]) => {
  switch (state) {
    case "current":
      return { icon: Clock, cls: "text-cactus-amber" };
    case "done":
      return { icon: CheckCircle2, cls: "text-success" };
    case "rejected":
      return { icon: XCircle, cls: "text-destructive" };
    case "pending":
      return { icon: Clock, cls: "text-muted-foreground" };
    default:
      return null;
  }
};

const DocCardNode = memo(function DocCardNode({ data }: NodeProps) {
  const d = data as DocCardData;
  const Icon = d.icon;
  const t = TONE_STYLES[d.tone];
  const badge = stateBadge(d.state);
  const isCurrent = d.state === "current";
  const statusTone = TONE_STYLES[d.statusTone ?? d.tone];
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={[
              "rounded-xl border-2 shadow-sm bg-background/60 backdrop-blur-sm transition-all",
              t.border,
              t.bg,
              "hover:shadow-lg hover:-translate-y-0.5",
              isCurrent ? "ring-2 ring-cactus-amber/50 ring-offset-1 ring-offset-background" : "",
              d.state === "pending" ? "opacity-70" : "",
            ].join(" ")}
            style={{ width: CARD_WIDTH }}
          >
            {d.hasTarget !== false && (
              <Handle type="target" position={Position.Left} className="!bg-transparent !border-0 !w-2 !h-2" />
            )}

            <div className="px-3 py-2.5">
              <div className="flex items-start gap-2">
                <div className={`shrink-0 mt-0.5 ${t.accent}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground leading-tight">
                    {d.kind}
                  </div>
                  <div className="text-sm font-semibold leading-tight truncate">{d.identifier}</div>
                </div>
                {badge && (
                  <badge.icon className={`w-4 h-4 shrink-0 ${badge.cls}`} />
                )}
              </div>

              {(d.amount !== undefined && d.amount !== null) && (
                <div className="mt-1.5 font-mono text-sm font-semibold">
                  {formatCurrency(d.amount, d.currency)}
                </div>
              )}

              {d.extra && (
                <div className="mt-0.5 text-[11px] text-muted-foreground truncate">{d.extra}</div>
              )}

              <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                <div className="min-w-0 truncate">
                  {d.who ? d.who : ""}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {!!d.attachmentsCount && d.attachmentsCount > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-foreground/70">
                      <Paperclip className="w-3 h-3" />
                      {d.attachmentsCount}
                    </span>
                  )}
                  {d.when && <span className="font-mono">{formatDateShort(d.when)}</span>}
                </div>
              </div>

              {d.status && (
                <div className="mt-1.5">
                  <span
                    className={[
                      "inline-block text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded",
                      "border",
                      statusTone.border,
                      statusTone.bg,
                      statusTone.accent,
                    ].join(" ")}
                  >
                    {d.status.replace(/_/g, " ")}
                  </span>
                </div>
              )}
            </div>

            {d.hasSource !== false && (
              <Handle type="source" position={Position.Right} className="!bg-transparent !border-0 !w-2 !h-2" />
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-1 text-xs">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {d.kind}
            </div>
            <div className="font-semibold text-sm">{d.identifier}</div>
            {(d.amount !== undefined && d.amount !== null) && (
              <div className="font-mono">{formatCurrency(d.amount, d.currency)}</div>
            )}
            {d.status && (
              <div>
                <span className="text-muted-foreground">Status: </span>
                <span className="font-medium">{d.status.replace(/_/g, " ")}</span>
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});

const nodeTypes = { stageHeader: StageHeaderNode, docCard: DocCardNode };

/* ────────────────────────────── Types for internal graph ────────────────────────────── */

type StageKey =
  | "pedido"
  | "despesa_pagcorp"
  | "aprovacao"
  | "pc_sap"
  | "nf_entrada"
  | "contas_pagar";

interface StageDef {
  key: StageKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: NodeTone;
}

const STAGE_DEFS: Record<StageKey, StageDef> = {
  pedido:          { key: "pedido",          label: "Pedido de Compra", icon: FileText,    tone: "amber"  },
  despesa_pagcorp: { key: "despesa_pagcorp", label: "Despesa PagCorp",  icon: CreditCard,  tone: "amber"  },
  aprovacao:       { key: "aprovacao",       label: "Aprovação",        icon: ShieldCheck, tone: "blue"   },
  pc_sap:          { key: "pc_sap",          label: "PC lançado no SAP",icon: FileCheck2,  tone: "amber"  },
  nf_entrada:      { key: "nf_entrada",      label: "NF de Entrada",    icon: Receipt,     tone: "green"  },
  contas_pagar:    { key: "contas_pagar",    label: "Contas a Pagar",   icon: Wallet,      tone: "violet" },
};

const FLOW_STAGES: Record<RelationsFlowType, StageKey[]> = {
  compras: ["pedido", "aprovacao", "pc_sap", "nf_entrada", "contas_pagar"],
  pagcorp: ["despesa_pagcorp", "pc_sap", "nf_entrada", "contas_pagar"],
};

/* ────────────────────────────── Build graph ────────────────────────────── */

interface StageBucket {
  stage: StageDef;
  colIndex: number;
  items: Array<{ id: string; data: DocCardData }>;
}

function buildTimelineGraph(props: Props): { nodes: Node[]; edges: Edge[]; width: number } {
  const { expense, approverRows, nfLinks, apPayables, flowType = "compras" } = props;

  const stageKeys = FLOW_STAGES[flowType];
  const buckets: Record<StageKey, StageBucket> = {} as Record<StageKey, StageBucket>;
  stageKeys.forEach((key, idx) => {
    buckets[key] = { stage: STAGE_DEFS[key], colIndex: idx, items: [] };
  });

  const edges: Edge[] = [];
  const nodes: Node[] = [];

  const statusRaw = (expense.status || "").toLowerCase();
  const isFailed = statusRaw === "rejeitado" || statusRaw === "cancelado";
  const integrated = !!expense.sap_doc_num || statusRaw === "integrado" || statusRaw === "aprovado";

  /* ── Stage 1: Pedido / Despesa ── */
  const rootKey: StageKey = flowType === "pagcorp" ? "despesa_pagcorp" : "pedido";
  const rootStage = STAGE_DEFS[rootKey];
  const rootState: DocCardData["state"] = isFailed ? "rejected" : "done";
  const rootId = "root";
  buckets[rootKey].items.push({
    id: rootId,
    data: {
      tone: rootStage.tone,
      icon: rootStage.icon,
      kind: rootStage.label,
      identifier: expense.sap_doc_num ? `SAP #${expense.sap_doc_num}` : expense.id.slice(0, 8),
      amount: expense.total_amount,
      currency: expense.currency,
      who: expense.requester_name || expense.requester_email || undefined,
      when: expense.created_at,
      extra: expense.supplier_name || null,
      state: rootState,
      hasTarget: false,
    },
  });

  /* ── Stage 2 (compras only): Aprovadores empilhados ── */
  const approverIds: string[] = [];
  if (flowType === "compras") {
    approverRows.forEach((r, i) => {
      const id = `app-${i}`;
      approverIds.push(id);
      const state: DocCardData["state"] = r.rejected
        ? "rejected"
        : r.done
          ? "done"
          : r.isCurrent
            ? "current"
            : "pending";
      buckets.aprovacao.items.push({
        id,
        data: {
          tone: "blue",
          icon: ShieldCheck,
          kind: `Nível ${r.level_order}`,
          identifier: r.approver_name,
          who: r.approver_email || undefined,
          when: r.decidedAt || null,
          status: r.rejected ? "rejeitado" : r.done ? "aprovado" : r.isCurrent ? "atual" : "pendente",
          statusTone: r.rejected ? "warn" : r.done ? "success" : r.isCurrent ? "amber" : "muted",
          state,
          extra: r.remarks || null,
        },
      });

      // fan-out from root → each approver
      edges.push({
        id: `e-root-${id}`,
        source: rootId,
        target: id,
        type: "smoothstep",
        animated: r.isCurrent,
        style: {
          stroke: TONE_STYLES[rootStage.tone].edge,
          strokeWidth: r.isCurrent ? 2.25 : 1.75,
        },
      });
    });
  }

  /* ── Stage: PC lançado no SAP ── */
  const pcSapId = "pc-sap";
  const pcSapState: DocCardData["state"] = isFailed
    ? "rejected"
    : integrated
      ? "done"
      : approverRows.some((r) => r.isCurrent)
        ? "pending"
        : "pending";
  buckets.pc_sap.items.push({
    id: pcSapId,
    data: {
      tone: "amber",
      icon: FileCheck2,
      kind: "PC no SAP",
      identifier: expense.sap_doc_num ? `SAP #${expense.sap_doc_num}` : "Aguardando integração",
      amount: expense.total_amount,
      currency: expense.currency,
      extra: expense.company_db || null,
      when: expense.updated_at,
      status: integrated ? "integrado" : isFailed ? statusRaw : "pendente",
      statusTone: integrated ? "success" : isFailed ? "warn" : "muted",
      state: pcSapState,
    },
  });

  // fan-in from approvers → PC SAP (compras) OR direct from root (pagcorp)
  if (flowType === "compras" && approverIds.length > 0) {
    approverIds.forEach((aid) => {
      const app = approverRows[Number(aid.slice(4))];
      const dashed = !(app?.done);
      edges.push({
        id: `e-${aid}-pcsap`,
        source: aid,
        target: pcSapId,
        type: "smoothstep",
        style: {
          stroke: app?.done ? TONE_STYLES.success.edge : TONE_STYLES.blue.edge,
          strokeWidth: 1.75,
          strokeDasharray: dashed ? "5 4" : undefined,
        },
      });
    });
  } else {
    // pagcorp OR compras without approvers: root → PC SAP direct
    edges.push({
      id: `e-root-pcsap`,
      source: rootId,
      target: pcSapId,
      type: "smoothstep",
      style: {
        stroke: TONE_STYLES[rootStage.tone].edge,
        strokeWidth: 2,
        strokeDasharray: integrated ? undefined : "5 4",
      },
    });
  }

  /* ── Stage: NF de Entrada ── */
  const nfById: Record<string, { id: string; apChildren: string[] }> = {};
  nfLinks.forEach((nf) => {
    const id = `nf-${nf.id}`;
    nfById[nf.id] = { id, apChildren: [] };
    const statusOk = /close|paga/i.test(nf.status);
    buckets.nf_entrada.items.push({
      id,
      data: {
        tone: "green",
        icon: Receipt,
        kind: `NF ${nf.numero_nf || "—"}${nf.serie ? `/${nf.serie}` : ""}`,
        identifier: nf.nome_fornecedor || "Fornecedor —",
        amount: nf.valor_total,
        currency: expense.currency,
        when: nf.created_at,
        status: nf.status,
        statusTone: statusOk ? "success" : "muted",
        state: statusOk ? "done" : "pending",
      },
    });
    edges.push({
      id: `e-pcsap-${id}`,
      source: pcSapId,
      target: id,
      type: "smoothstep",
      style: { stroke: TONE_STYLES.green.edge, strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: TONE_STYLES.green.edge },
    });
  });

  /* ── Stage: Contas a Pagar ── */
  // AP nodes: prefer the ones already linked to NFs; add orphan ones connected directly to PC SAP.
  const linkedApKey = new Set<string>();
  nfLinks.forEach((nf) => {
    (nf.ap_links || []).forEach((ap) => {
      const apId = `ap-${nf.id}-${ap.source}-${ap.ap_doc_entry}`;
      linkedApKey.add(`${ap.source}:${ap.ap_doc_entry}`);
      const paidFully = ap.ap_paid !== null && ap.ap_total !== null && Math.abs((ap.ap_paid || 0) - (ap.ap_total || 0)) < 0.01;
      buckets.contas_pagar.items.push({
        id: apId,
        data: {
          tone: "violet",
          icon: Wallet,
          kind: `${ap.source.toUpperCase()} · Doc ${ap.ap_doc_num || ap.ap_doc_entry}`,
          identifier: ap.ap_doc_num ? `#${ap.ap_doc_num}` : `#${ap.ap_doc_entry}`,
          amount: ap.ap_total,
          currency: expense.currency,
          when: ap.payment_date || ap.linked_at,
          status: paidFully ? "pago" : "em aberto",
          statusTone: paidFully ? "success" : "muted",
          state: paidFully ? "done" : "pending",
          extra: ap.ap_paid !== null && ap.ap_paid !== undefined ? `Pago: ${formatCurrency(ap.ap_paid, expense.currency)}` : null,
        },
      });
      nfById[nf.id]?.apChildren.push(apId);
      edges.push({
        id: `e-${nfById[nf.id].id}-${apId}`,
        source: nfById[nf.id].id,
        target: apId,
        type: "smoothstep",
        style: { stroke: TONE_STYLES.violet.edge, strokeWidth: 1.75 },
        markerEnd: { type: MarkerType.ArrowClosed, color: TONE_STYLES.violet.edge },
      });
    });
  });

  // orphan APs (not linked to any NF): connect from PC SAP directly, dashed
  apPayables.forEach((ap) => {
    const idStr = String(ap.id);
    const parts = idStr.split(":");
    const entry = parts[parts.length - 1];
    const key1 = `sap:${entry}`;
    const key2 = `omie:${entry}`;
    if (linkedApKey.has(key1) || linkedApKey.has(key2)) return;

    const apId = `orphan-ap-${ap.id}`;
    const paidFully = ap.status?.toLowerCase() === "pago";
    buckets.contas_pagar.items.push({
      id: apId,
      data: {
        tone: "violet",
        icon: Wallet,
        kind: `${ap.source.toUpperCase()} · Doc ${ap.numero_documento || ap.id}`,
        identifier: ap.numero_documento ? `#${ap.numero_documento}` : `#${ap.id}`,
        amount: ap.valor_documento,
        currency: expense.currency,
        when: ap.data_pagamento || ap.data_vencimento || ap.data_registro,
        status: ap.status || (paidFully ? "pago" : "em aberto"),
        statusTone: paidFully ? "success" : "muted",
        state: paidFully ? "done" : "pending",
        extra: ap.data_vencimento ? `Venc: ${formatDateShort(ap.data_vencimento)}` : null,
      },
    });
    edges.push({
      id: `e-pcsap-${apId}`,
      source: pcSapId,
      target: apId,
      type: "smoothstep",
      style: {
        stroke: TONE_STYLES.violet.edge,
        strokeWidth: 1.5,
        strokeDasharray: "5 4",
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: TONE_STYLES.violet.edge },
    });
  });

  /* ── Convert buckets into positioned nodes ── */
  // Determine vertical extents to vertically center each column.
  const maxCount = Math.max(1, ...stageKeys.map((k) => buckets[k].items.length));
  const totalH = maxCount * CARD_ROW_H;

  stageKeys.forEach((key) => {
    const bucket = buckets[key];
    const x = bucket.colIndex * COL_WIDTH;
    const count = bucket.items.length;
    const colHeight = count * CARD_ROW_H;
    const startY = FIRST_CARD_Y + (totalH - colHeight) / 2;

    // Column header
    nodes.push({
      id: `head-${key}`,
      type: "stageHeader",
      position: { x, y: HEADER_Y },
      draggable: false,
      selectable: false,
      data: {
        label: bucket.stage.label,
        count,
        tone: bucket.stage.tone,
        icon: bucket.stage.icon,
      } as StageHeaderData,
    });

    if (count === 0) {
      // Placeholder ghost card so the column reads as "empty"
      nodes.push({
        id: `empty-${key}`,
        type: "docCard",
        position: { x, y: FIRST_CARD_Y + totalH / 2 - CARD_ROW_H / 2 },
        draggable: false,
        data: {
          tone: "muted",
          icon: bucket.stage.icon,
          kind: bucket.stage.label,
          identifier: "—",
          extra: "Sem registros",
          state: "pending",
          hasSource: false,
          hasTarget: false,
        } as DocCardData,
      });
      return;
    }

    bucket.items.forEach((it, i) => {
      nodes.push({
        id: it.id,
        type: "docCard",
        position: { x, y: startY + i * CARD_ROW_H },
        data: it.data,
      });
    });
  });

  const width = stageKeys.length * COL_WIDTH + CARD_WIDTH;
  return { nodes, edges, width };
}

/* ────────────────────────────── Legend ────────────────────────────── */

const LEGEND_ITEMS: Array<{ tone: NodeTone; label: string }> = [
  { tone: "amber",  label: "Pedido / PC SAP" },
  { tone: "blue",   label: "Aprovação" },
  { tone: "green",  label: "NF de Entrada" },
  { tone: "violet", label: "Contas a Pagar" },
];

function FlowLegend() {
  return (
    <div className="absolute top-3 right-3 z-10 flex flex-wrap gap-1.5 rounded-md border border-border bg-background/80 backdrop-blur px-2 py-1.5 shadow-sm">
      {LEGEND_ITEMS.map((it) => (
        <div key={it.tone} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span
            className={`inline-block w-2.5 h-2.5 rounded-sm border ${TONE_STYLES[it.tone].border} ${TONE_STYLES[it.tone].bg}`}
          />
          <span>{it.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ────────────────────────────── Component ────────────────────────────── */

export function RelationsMapFlow(props: Props) {
  const { nodes, edges } = useMemo(() => buildTimelineGraph(props), [props]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (!props.onNodeClick) return;
      const id = node.id;
      let kind = id;
      if (id === "root") kind = "root";
      else if (id === "pc-sap") kind = "pc-sap";
      else if (id.startsWith("head-")) return;
      else if (id.startsWith("empty-")) return;
      else if (id.startsWith("app-")) kind = "approver";
      else if (id.startsWith("nf-")) kind = "nf";
      else if (id.startsWith("ap-")) kind = "nf-ap";
      else if (id.startsWith("orphan-ap-")) kind = "ap";
      props.onNodeClick(id, kind);
    },
    [props],
  );

  return (
    <div className="relative w-full h-[65vh] rounded-xl border border-border bg-[radial-gradient(circle_at_center,hsl(var(--muted)/0.35),transparent_70%)] overflow-hidden">
      <FlowLegend />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.3}
        maxZoom={1.75}
        onNodeClick={onNodeClick}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        panOnDrag
        zoomOnScroll
        defaultEdgeOptions={{ type: "smoothstep" }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} className="opacity-40" />
        <MiniMap
          pannable
          zoomable
          className="!bg-background/80 !border !border-border rounded-md"
          nodeColor={(n) => {
            const t = (n.data as { tone?: NodeTone } | undefined)?.tone;
            if (!t) return "hsl(var(--muted-foreground))";
            return TONE_STYLES[t].edge;
          }}
        />
        <Controls
          position="bottom-left"
          className="!bg-background !border !border-border rounded-md [&>button]:!bg-background [&>button]:!border-border [&>button]:!text-foreground"
        />
      </ReactFlow>
    </div>
  );
}
