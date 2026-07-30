import { useMemo, useState } from "react";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CATEGORY_LABELS,
  FLOW_LABELS,
  amountRangeLabel,
  type MatrixRow,
} from "@/lib/approval-matrix";

/**
 * Visualização em teia (mapa mental) das regras de aprovação.
 * Hierarquia: Empresa → Fluxo → Categoria → Regra → Nível de aprovação.
 */

interface Node {
  id: string;
  label: string;
  sub?: string;
  depth: number;
  children: Node[];
  collapsed?: boolean;
}

interface Positioned extends Node {
  x: number;
  y: number;
  angle: number;
  children: Positioned[];
}

const RADII = [0, 190, 340, 520, 690];

function buildTree(rows: MatrixRow[], root: string): Node {
  const flows = new Map<string, MatrixRow[]>();
  for (const r of rows) {
    const list = flows.get(r.flow) || [];
    list.push(r);
    flows.set(r.flow, list);
  }

  const flowNodes: Node[] = [...flows.entries()].map(([flow, flowRows]) => {
    const cats = new Map<string, MatrixRow[]>();
    for (const r of flowRows) {
      const list = cats.get(r.category) || [];
      list.push(r);
      cats.set(r.category, list);
    }
    const catNodes: Node[] = [...cats.entries()].map(([cat, catRows]) => ({
      id: `${flow}:${cat}`,
      label: CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS] ?? cat,
      sub: `${catRows.length} regra${catRows.length > 1 ? "s" : ""}`,
      depth: 2,
      children: catRows.map((r) => ({
        id: r.id,
        label: r.name,
        sub: amountRangeLabel(r),
        depth: 3,
        children: r.levels.map((l) => ({
          id: `${r.id}:${l.order}`,
          label: l.approvers.map((a) => a.name).join(" ou ") || "—",
          sub: `Nível ${l.order}`,
          depth: 4,
          children: [],
        })),
      })),
    }));
    return {
      id: flow,
      label: FLOW_LABELS[flow as keyof typeof FLOW_LABELS] ?? flow,
      sub: `${flowRows.length} regra${flowRows.length > 1 ? "s" : ""}`,
      depth: 1,
      children: catNodes,
    };
  });

  return { id: "__root", label: root, sub: `${rows.length} regras`, depth: 0, children: flowNodes };
}

function countLeaves(node: Node, collapsed: Set<string>): number {
  if (collapsed.has(node.id) || node.children.length === 0) return 1;
  return node.children.reduce((n, c) => n + countLeaves(c, collapsed), 0);
}

function layout(node: Node, collapsed: Set<string>, start: number, end: number): Positioned {
  const angle = (start + end) / 2;
  const r = RADII[Math.min(node.depth, RADII.length - 1)];
  const positioned: Positioned = {
    ...node,
    angle,
    x: Math.cos(angle) * r,
    y: Math.sin(angle) * r,
    children: [],
  };
  if (collapsed.has(node.id) || node.children.length === 0) return positioned;

  const total = node.children.reduce((n, c) => n + countLeaves(c, collapsed), 0) || 1;
  let cursor = start;
  positioned.children = node.children.map((child) => {
    const span = (countLeaves(child, collapsed) / total) * (end - start);
    const laid = layout(child, collapsed, cursor, cursor + span);
    cursor += span;
    return laid;
  });
  return positioned;
}

function flatten(node: Positioned, acc: Positioned[] = []): Positioned[] {
  acc.push(node);
  node.children.forEach((c) => flatten(c, acc));
  return acc;
}

function links(node: Positioned, acc: { from: Positioned; to: Positioned }[] = []) {
  for (const c of node.children) {
    acc.push({ from: node, to: c });
    links(c, acc);
  }
  return acc;
}

const DEPTH_STROKE = [
  "stroke-primary",
  "stroke-primary/70",
  "stroke-accent",
  "stroke-muted-foreground/60",
  "stroke-muted-foreground/40",
];

const DEPTH_FILL = [
  "fill-primary",
  "fill-primary/80",
  "fill-accent",
  "fill-card",
  "fill-muted",
];

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function ApprovalMatrixMindMap({
  rows,
  rootLabel,
}: {
  rows: MatrixRow[];
  rootLabel: string;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(1);

  const tree = useMemo(() => buildTree(rows, rootLabel), [rows, rootLabel]);
  const positioned = useMemo(
    () => layout(tree, collapsed, -Math.PI / 2, (3 * Math.PI) / 2),
    [tree, collapsed],
  );
  const nodes = useMemo(() => flatten(positioned), [positioned]);
  const edges = useMemo(() => links(positioned), [positioned]);

  const extent = useMemo(() => {
    let max = 260;
    for (const n of nodes) max = Math.max(max, Math.abs(n.x) + 220, Math.abs(n.y) + 90);
    return max;
  }, [nodes]);

  const size = (extent * 2) / zoom;
  const viewBox = `${-size / 2} ${-size / 2} ${size} ${size}`;

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  if (rows.length === 0) return null;

  return (
    <div className="relative rounded-lg border border-border bg-card">
      <div className="absolute right-3 top-3 z-10 flex gap-1 print:hidden">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          aria-label="Aproximar"
          onClick={() => setZoom((z) => Math.min(3, z * 1.25))}
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          aria-label="Afastar"
          onClick={() => setZoom((z) => Math.max(0.4, z / 1.25))}
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          aria-label="Ajustar à tela"
          onClick={() => {
            setZoom(1);
            setCollapsed(new Set());
          }}
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
      </div>

      <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground print:hidden">
        Clique em um nó para recolher ou expandir seus ramos. Empresa → fluxo → categoria → regra →
        níveis de aprovação.
      </p>

      <svg
        viewBox={viewBox}
        className="h-[70vh] w-full"
        role="img"
        aria-label="Mapa mental das regras de aprovação"
      >
        {edges.map((e, i) => {
          const mr = (Math.hypot(e.from.x, e.from.y) + Math.hypot(e.to.x, e.to.y)) / 2;
          const c1x = Math.cos(e.from.angle) * mr;
          const c1y = Math.sin(e.from.angle) * mr;
          const c2x = Math.cos(e.to.angle) * mr;
          const c2y = Math.sin(e.to.angle) * mr;
          return (
            <path
              key={i}
              d={`M ${e.from.x} ${e.from.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${e.to.x} ${e.to.y}`}
              fill="none"
              strokeWidth={Math.max(1, 3 - e.from.depth * 0.6)}
              className={DEPTH_STROKE[Math.min(e.from.depth, DEPTH_STROKE.length - 1)]}
              opacity={0.5}
            />
          );
        })}

        {nodes.map((n) => {
          const left = Math.cos(n.angle) < 0 && n.depth > 0;
          const anchor = n.depth === 0 ? "middle" : left ? "end" : "start";
          const dx = n.depth === 0 ? 0 : left ? -12 : 12;
          const isCollapsible = n.children.length > 0 || collapsed.has(n.id);
          const hidden = collapsed.has(n.id);
          return (
            <g
              key={n.id}
              className={isCollapsible ? "cursor-pointer" : ""}
              onClick={() => isCollapsible && toggle(n.id)}
            >
              <circle
                cx={n.x}
                cy={n.y}
                r={n.depth === 0 ? 10 : Math.max(3.5, 8 - n.depth * 1.2)}
                className={`${DEPTH_FILL[Math.min(n.depth, DEPTH_FILL.length - 1)]} ${
                  DEPTH_STROKE[Math.min(n.depth, DEPTH_STROKE.length - 1)]
                }`}
                strokeWidth={hidden ? 3 : 1.5}
              />
              <text
                x={n.x + dx}
                y={n.y}
                textAnchor={anchor}
                dominantBaseline="middle"
                className="fill-foreground"
                style={{ fontSize: n.depth <= 1 ? 15 : n.depth === 2 ? 13 : 11, fontWeight: n.depth <= 2 ? 600 : 400 }}
              >
                {truncate(n.label, n.depth >= 3 ? 34 : 26)}
              </text>
              {n.sub && (
                <text
                  x={n.x + dx}
                  y={n.y + (n.depth <= 1 ? 15 : 12)}
                  textAnchor={anchor}
                  dominantBaseline="middle"
                  className="fill-muted-foreground"
                  style={{ fontSize: 9.5 }}
                >
                  {truncate(n.sub, 34)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
