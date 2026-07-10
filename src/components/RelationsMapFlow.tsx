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
  User,
  CheckCircle2,
  Clock,
  XCircle,
  Ban,
  Building2,
} from "lucide-react";
import type { NfEntradaLink, ContaPagarLink } from "@/hooks/useRelationsMapDerived";
import type { RelationsMapExpense } from "./RelationsMap";

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

interface Props {
  expense: RelationsMapExpense;
  approverRows: ChainRow[];
  nfLinks: NfEntradaLink[];
  apPayables: ContaPagarLink[];
  enriched: boolean;
  onNodeClick?: (id: string, kind: string) => void;
}

function formatCurrency(value?: number | null, currency?: string | null) {
  if (value === undefined || value === null) return "—";
  const code = currency && /^[A-Z]{3}$/.test(currency) ? currency : "BRL";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(value);
}

/* ────────────────────────────── Nodes ────────────────────────────── */

type NodeTone = "amber" | "green" | "blue" | "violet" | "rose" | "slate" | "success" | "warn";

const TONE_STYLES: Record<NodeTone, string> = {
  amber: "border-cactus-amber/60 bg-cactus-amber/10 text-foreground",
  green: "border-cactus-green/60 bg-cactus-green/10 text-foreground",
  blue: "border-primary/50 bg-primary/5 text-foreground",
  violet: "border-purple-400/60 bg-purple-400/10 text-foreground",
  rose: "border-rose-400/60 bg-rose-400/10 text-foreground",
  slate: "border-border bg-muted/40 text-muted-foreground",
  success: "border-success/60 bg-success/10 text-foreground",
  warn: "border-destructive/60 bg-destructive/10 text-foreground",
};

interface PillData extends Record<string, unknown> {
  tone: NodeTone;
  icon?: React.ComponentType<{ className?: string }>;
  title?: string;
  subtitle?: string | null;
  extra?: string | null;
  meta?: string | null;
  badge?: string | null;
  hasSource?: boolean;
  hasTarget?: boolean;
}

const PillNode = memo(function PillNode({ data }: NodeProps) {
  const d = data as PillData;
  const Icon = d.icon;
  return (
    <div
      className={`rounded-2xl border-2 shadow-sm backdrop-blur-sm px-3.5 py-2.5 min-w-[180px] max-w-[260px] transition-all hover:shadow-lg hover:-translate-y-0.5 ${TONE_STYLES[d.tone]}`}
    >
      {d.hasTarget !== false && (
        <Handle type="target" position={Position.Left} className="!bg-transparent !border-0 !w-2 !h-2" />
      )}
      <div className="flex items-start gap-2">
        {Icon && (
          <div className="mt-0.5 shrink-0">
            <Icon className="w-4 h-4" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-widest opacity-70 leading-tight">
            {d.badge || d.title}
          </div>
          <div className="text-sm font-semibold leading-tight truncate">
            {d.subtitle ?? d.title}
          </div>
          {d.extra && (
            <div className="text-[11px] opacity-80 mt-0.5 truncate font-mono">{d.extra}</div>
          )}
          {d.meta && (
            <div className="text-[10px] opacity-60 mt-1 truncate">{d.meta}</div>
          )}
        </div>
      </div>
      {d.hasSource !== false && (
        <Handle type="source" position={Position.Right} className="!bg-transparent !border-0 !w-2 !h-2" />
      )}
    </div>
  );
});

const RootNode = memo(function RootNode({ data }: NodeProps) {
  const d = data as {
    docNum?: number | null;
    supplier?: string | null;
    amount?: number | null;
    currency?: string | null;
    status?: string | null;
  };
  return (
    <div className="relative rounded-3xl border-2 border-cactus-amber shadow-xl bg-gradient-to-br from-cactus-amber/20 to-cactus-amber/5 px-5 py-4 min-w-[220px]">
      <Handle type="target" position={Position.Left} className="!bg-transparent !border-0 !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-transparent !border-0 !w-2 !h-2" />
      <Handle type="target" position={Position.Top} id="top" className="!bg-transparent !border-0 !w-2 !h-2" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="!bg-transparent !border-0 !w-2 !h-2" />
      <div className="flex items-center gap-2 mb-1.5">
        <FileCheck2 className="w-5 h-5 text-cactus-amber" />
        <span className="text-[10px] uppercase tracking-widest font-semibold text-cactus-amber">
          Pedido de compra
        </span>
      </div>
      <div className="text-lg font-bold leading-tight">
        {d.docNum ? `SAP #${d.docNum}` : "Sem número SAP"}
      </div>
      {d.supplier && (
        <div className="text-xs text-muted-foreground mt-1 truncate max-w-[240px]">{d.supplier}</div>
      )}
      {d.amount !== undefined && d.amount !== null && (
        <div className="text-sm font-mono font-semibold mt-1.5">
          {formatCurrency(d.amount, d.currency)}
        </div>
      )}
    </div>
  );
});

const nodeTypes = { pill: PillNode, root: RootNode };

/* ────────────────────────────── Build graph ────────────────────────────── */

function buildGraph(props: Props): { nodes: Node[]; edges: Edge[] } {
  const { expense, approverRows, nfLinks, apPayables, enriched } = props;
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const ROOT_X = 480;
  const ROOT_Y = 320;

  // Root PC
  nodes.push({
    id: "root",
    type: "root",
    position: { x: ROOT_X, y: ROOT_Y },
    data: {
      docNum: expense.sap_doc_num,
      supplier: expense.supplier_name,
      amount: expense.total_amount,
      currency: expense.currency,
      status: expense.status,
    },
    draggable: true,
  });

  // Solicitante (top)
  if (expense.requester_name || expense.requester_email) {
    nodes.push({
      id: "requester",
      type: "pill",
      position: { x: ROOT_X + 20, y: ROOT_Y - 200 },
      data: {
        tone: "blue",
        icon: User,
        badge: "Solicitante",
        subtitle: expense.requester_name || expense.requester_email,
        meta: enriched ? expense.requester_email : null,
        hasSource: true,
        hasTarget: false,
      } as PillData,
    });
    edges.push({
      id: "e-req",
      source: "requester",
      target: "root",
      targetHandle: "top",
      type: "smoothstep",
      style: { stroke: "hsl(var(--primary))", strokeWidth: 2 },
      animated: false,
    });
  }

  // Status (bottom)
  const statusTone: NodeTone =
    expense.status === "rejeitado" || expense.status === "cancelado"
      ? "warn"
      : expense.status === "integrado" || expense.status === "aprovado"
        ? "success"
        : "amber";
  const statusIcon =
    expense.status === "rejeitado"
      ? XCircle
      : expense.status === "cancelado"
        ? Ban
        : expense.status === "integrado" || expense.status === "aprovado"
          ? CheckCircle2
          : Clock;
  nodes.push({
    id: "status",
    type: "pill",
    position: { x: ROOT_X + 20, y: ROOT_Y + 180 },
    data: {
      tone: statusTone,
      icon: statusIcon,
      badge: "Situação atual",
      subtitle: (expense.status || "—").replace(/_/g, " "),
      meta: enriched && expense.updated_at ? new Date(expense.updated_at).toLocaleString("pt-BR") : null,
      hasSource: false,
    } as PillData,
  });
  edges.push({
    id: "e-status",
    source: "root",
    sourceHandle: "bottom",
    target: "status",
    type: "smoothstep",
    style: { stroke: "hsl(var(--muted-foreground))", strokeWidth: 2, strokeDasharray: "4 4" },
  });

  // Approvers (left branch, vertical)
  const APP_X = ROOT_X - 320;
  const appCount = approverRows.length;
  const appSpacing = 90;
  const appTotalH = Math.max(appCount, 1) * appSpacing;
  const appStartY = ROOT_Y + 20 - appTotalH / 2;
  approverRows.forEach((r, i) => {
    const id = `app-${i}`;
    const tone: NodeTone = r.rejected ? "warn" : r.done ? "success" : r.isCurrent ? "amber" : "slate";
    const icon = r.rejected ? XCircle : r.done ? CheckCircle2 : r.isCurrent ? Clock : ShieldCheck;
    nodes.push({
      id,
      type: "pill",
      position: { x: APP_X, y: appStartY + i * appSpacing },
      data: {
        tone,
        icon,
        badge: `Nível ${r.level_order}${r.isCurrent ? " · atual" : r.done ? " · aprovado" : r.rejected ? " · rejeitado" : " · pendente"}`,
        subtitle: r.approver_name,
        meta: enriched ? r.approver_email || (r.decidedAt ? new Date(r.decidedAt).toLocaleString("pt-BR") : null) : null,
        extra: enriched && r.remarks ? r.remarks.slice(0, 60) : null,
        hasSource: true,
        hasTarget: false,
      } as PillData,
    });
    edges.push({
      id: `e-${id}`,
      source: id,
      target: "root",
      type: "smoothstep",
      style: {
        stroke: r.rejected
          ? "hsl(var(--destructive))"
          : r.done
            ? "hsl(var(--success))"
            : r.isCurrent
              ? "hsl(var(--cactus-amber))"
              : "hsl(var(--muted-foreground))",
        strokeWidth: r.isCurrent ? 2.5 : 1.75,
      },
      animated: r.isCurrent,
      markerEnd: { type: MarkerType.ArrowClosed, color: r.done ? "hsl(var(--success))" : "hsl(var(--muted-foreground))" },
    });
  });

  if (approverRows.length > 0) {
    nodes.push({
      id: "app-hub",
      type: "pill",
      position: { x: APP_X - 200, y: ROOT_Y + 20 },
      data: {
        tone: "blue",
        icon: ShieldCheck,
        badge: "Aprovação",
        subtitle: `${approverRows.length} nível${approverRows.length > 1 ? "eis" : ""}`,
        meta: `${approverRows.filter((r) => r.done).length} concluído(s)`,
        hasTarget: false,
      } as PillData,
    });
    // fan-out label edges from hub to each approver
    approverRows.forEach((_, i) => {
      edges.push({
        id: `e-hub-${i}`,
        source: "app-hub",
        target: `app-${i}`,
        type: "smoothstep",
        style: { stroke: "hsl(var(--primary) / 0.4)", strokeWidth: 1.25, strokeDasharray: "3 3" },
      });
    });
  }

  // NFs (right branch upper), APs (right branch lower)
  const RIGHT_X = ROOT_X + 320;
  const AP_X = RIGHT_X + 300;

  // NFs with their AP links as sub-children
  const nfCount = nfLinks.length;
  const nfSpacing = 110;
  const nfStartY = ROOT_Y - (nfCount * nfSpacing) / 2 - 60;

  nfLinks.forEach((nf, i) => {
    const id = `nf-${nf.id}`;
    nodes.push({
      id,
      type: "pill",
      position: { x: RIGHT_X, y: nfStartY + i * nfSpacing },
      data: {
        tone: "green",
        icon: Receipt,
        badge: `NF ${nf.numero_nf || "—"}${nf.serie ? `/${nf.serie}` : ""}`,
        subtitle: nf.nome_fornecedor || "Fornecedor —",
        extra: formatCurrency(nf.valor_total, expense.currency),
        meta: enriched ? nf.status : null,
      } as PillData,
    });
    edges.push({
      id: `e-${id}`,
      source: "root",
      target: id,
      type: "smoothstep",
      style: { stroke: "hsl(var(--cactus-green))", strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--cactus-green))" },
    });

    // AP children of this NF
    const links = nf.ap_links || [];
    const linkCount = links.length;
    const linkStartY = nfStartY + i * nfSpacing - (linkCount - 1) * 30;
    links.forEach((ap, j) => {
      const apId = `nf-ap-${nf.id}-${ap.source}-${ap.ap_doc_entry}`;
      nodes.push({
        id: apId,
        type: "pill",
        position: { x: AP_X, y: linkStartY + j * 70 },
        data: {
          tone: "violet",
          icon: Wallet,
          badge: `${ap.source.toUpperCase()} · Doc ${ap.ap_doc_num || ap.ap_doc_entry}`,
          subtitle: formatCurrency(ap.ap_total, expense.currency),
          meta: enriched && ap.ap_paid ? `Pago: ${formatCurrency(ap.ap_paid, expense.currency)}` : null,
        } as PillData,
      });
      edges.push({
        id: `e-${apId}`,
        source: id,
        target: apId,
        type: "smoothstep",
        style: { stroke: "hsl(var(--purple-400, 270 70% 60%))", strokeWidth: 1.5 },
      });
    });
  });

  // Standalone AP payables not linked to any NF (direct from PC)
  const linkedAp = new Set<string>();
  nfLinks.forEach((nf) =>
    (nf.ap_links || []).forEach((ap) => linkedAp.add(`${ap.source}:${ap.ap_doc_entry}`)),
  );
  const orphanAp = apPayables.filter((ap) => {
    const key = String(ap.id).replace(":", ":");
    return !linkedAp.has(key.replace(/^(sap|omie):/, "$1:"));
  });

  if (orphanAp.length > 0) {
    const orphanStartY = ROOT_Y + 140 + (nfCount > 0 ? 0 : -80);
    orphanAp.forEach((ap, i) => {
      const apId = `orphan-ap-${ap.id}`;
      nodes.push({
        id: apId,
        type: "pill",
        position: { x: RIGHT_X, y: orphanStartY + i * 90 },
        data: {
          tone: "violet",
          icon: Wallet,
          badge: `${ap.source.toUpperCase()} · Doc ${ap.numero_documento || ap.id}`,
          subtitle: formatCurrency(ap.valor_documento, expense.currency),
          meta: enriched && ap.data_vencimento ? `Venc: ${new Date(ap.data_vencimento).toLocaleDateString("pt-BR")}` : ap.status,
        } as PillData,
      });
      edges.push({
        id: `e-${apId}`,
        source: "root",
        target: apId,
        type: "smoothstep",
        style: { stroke: "hsl(var(--muted-foreground))", strokeWidth: 1.5, strokeDasharray: "5 3" },
        markerEnd: { type: MarkerType.ArrowClosed },
      });
    });
  }

  // Company badge (top-left)
  if (expense.company_db) {
    nodes.push({
      id: "company",
      type: "pill",
      position: { x: APP_X - 200, y: ROOT_Y - 180 },
      data: {
        tone: "amber",
        icon: Building2,
        badge: "Base ativa",
        subtitle: expense.company_db,
        hasTarget: false,
        hasSource: false,
      } as PillData,
    });
  }

  return { nodes, edges };
}

/* ────────────────────────────── Component ────────────────────────────── */

export function RelationsMapFlow(props: Props) {
  const { nodes, edges } = useMemo(() => buildGraph(props), [props]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (!props.onNodeClick) return;
      const kind = node.id.startsWith("nf-ap-")
        ? "nf-ap"
        : node.id.startsWith("nf-")
          ? "nf"
          : node.id.startsWith("app-")
            ? "approver"
            : node.id.startsWith("orphan-ap-")
              ? "ap"
              : node.id;
      props.onNodeClick(node.id, kind);
    },
    [props],
  );

  return (
    <div className="w-full h-[65vh] rounded-xl border border-border bg-[radial-gradient(circle_at_center,hsl(var(--muted)/0.35),transparent_70%)] overflow-hidden">
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
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} className="opacity-40" />
        <MiniMap
          pannable
          zoomable
          className="!bg-background/80 !border !border-border rounded-md"
          nodeColor={(n) => {
            const t = (n.data as PillData | undefined)?.tone;
            if (t === "success" || t === "green") return "hsl(var(--cactus-green))";
            if (t === "amber") return "hsl(var(--cactus-amber))";
            if (t === "warn") return "hsl(var(--destructive))";
            if (t === "violet") return "rgb(192, 132, 252)";
            return "hsl(var(--muted-foreground))";
          }}
        />
        <Controls className="!bg-background !border !border-border rounded-md [&>button]:!bg-background [&>button]:!border-border [&>button]:!text-foreground" />
      </ReactFlow>
    </div>
  );
}
