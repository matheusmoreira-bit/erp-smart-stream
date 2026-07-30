import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { ZoomIn, ZoomOut, Maximize2, List, ChevronsUpDown, Users, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  CATEGORY_LABELS,
  FLOW_LABELS,
  amountRangeLabel,
  type MatrixCategory,
  type MatrixFlow,
  type MatrixRow,
} from "@/lib/approval-matrix";

/**
 * Visualização em teia (mapa mental) das regras de aprovação.
 * Hierarquia: Empresa → Fluxo → Categoria → Regra → Nível de aprovação.
 */

export interface MindMapListFilter {
  flow?: MatrixFlow;
  category?: MatrixCategory;
  search?: string;
}

type NodeKind = "root" | "flow" | "category" | "rule" | "level";

interface NodeMeta {
  kind: NodeKind;
  flow?: MatrixFlow;
  category?: MatrixCategory;
  rule?: MatrixRow;
  levelOrder?: number;
  rows: MatrixRow[];
}

interface Node {
  id: string;
  label: string;
  sub?: string;
  depth: number;
  meta: NodeMeta;
  children: Node[];
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
      label: CATEGORY_LABELS[cat as MatrixCategory] ?? cat,
      sub: `${catRows.length} regra${catRows.length > 1 ? "s" : ""}`,
      depth: 2,
      meta: {
        kind: "category" as const,
        flow: flow as MatrixFlow,
        category: cat as MatrixCategory,
        rows: catRows,
      },
      children: catRows.map((r) => ({
        id: r.id,
        label: r.name,
        sub: amountRangeLabel(r),
        depth: 3,
        meta: {
          kind: "rule" as const,
          flow: r.flow,
          category: r.category,
          rule: r,
          rows: [r],
        },
        children: r.levels.map((l) => ({
          id: `${r.id}:${l.order}`,
          label: l.approvers.map((a) => a.name).join(" ou ") || "—",
          sub: `Nível ${l.order}`,
          depth: 4,
          meta: {
            kind: "level" as const,
            flow: r.flow,
            category: r.category,
            rule: r,
            levelOrder: l.order,
            rows: [r],
          },
          children: [],
        })),
      })),
    }));
    return {
      id: flow,
      label: FLOW_LABELS[flow as MatrixFlow] ?? flow,
      sub: `${flowRows.length} regra${flowRows.length > 1 ? "s" : ""}`,
      depth: 1,
      meta: { kind: "flow" as const, flow: flow as MatrixFlow, rows: flowRows },
      children: catNodes,
    };
  });

  return {
    id: "__root",
    label: root,
    sub: `${rows.length} regras`,
    depth: 0,
    meta: { kind: "root", rows },
    children: flowNodes,
  };
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

const DEPTH_FILL = ["fill-primary", "fill-primary/80", "fill-accent", "fill-card", "fill-muted"];

const KIND_LABEL: Record<NodeKind, string> = {
  root: "Empresa",
  flow: "Fluxo",
  category: "Categoria",
  rule: "Regra de aprovação",
  level: "Nível de aprovação",
};

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function NodeDetails({ node }: { node: Node }) {
  const { meta } = node;

  if (meta.kind === "rule" || meta.kind === "level") {
    const rule = meta.rule!;
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{amountRangeLabel(rule)}</Badge>
          <Badge variant="outline">Prioridade {rule.priority}</Badge>
          {!rule.isActive && <Badge variant="outline">Inativa</Badge>}
          <Badge variant="outline">{FLOW_LABELS[rule.flow] ?? rule.flow}</Badge>
          <Badge variant="outline">{CATEGORY_LABELS[rule.category] ?? rule.category}</Badge>
        </div>

        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Condições
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {rule.conditions.length === 0 ? (
              <Badge variant="outline">Sem condições — regra padrão</Badge>
            ) : (
              rule.conditions.map((c, i) => (
                <Badge key={i} variant="outline" className="font-normal">
                  {c}
                </Badge>
              ))
            )}
          </div>
        </div>

        <Separator />

        <div>
          <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Users className="h-3.5 w-3.5" aria-hidden /> Cadeia de aprovação
          </h4>
          {rule.levels.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem aprovadores configurados.</p>
          ) : (
            <div className="space-y-2">
              {rule.levels.map((l, i) => (
                <div
                  key={l.order}
                  className={`rounded-md border p-2 ${
                    meta.levelOrder === l.order ? "border-primary bg-primary/5" : "border-border"
                  }`}
                >
                  <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Nível {l.order}
                    {i < rule.levels.length - 1 && <ArrowRight className="h-3 w-3" aria-hidden />}
                  </div>
                  <div className="text-sm text-foreground">
                    {l.approvers.map((a) => a.name).join("  ou  ") || "—"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // root / flow / category → resumo agregado
  const approvers = new Set<string>();
  for (const r of meta.rows) for (const l of r.levels) for (const a of l.approvers) approvers.add(a.name);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-md border border-border p-3">
          <div className="text-2xl font-semibold text-foreground">{meta.rows.length}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Regras</div>
        </div>
        <div className="rounded-md border border-border p-3">
          <div className="text-2xl font-semibold text-foreground">{approvers.size}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Aprovadores</div>
        </div>
        <div className="rounded-md border border-border p-3">
          <div className="text-2xl font-semibold text-foreground">
            {meta.rows.reduce((n, r) => Math.max(n, r.levels.length), 0)}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Níveis máx.</div>
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Regras deste nó
        </h4>
        <div className="space-y-2">
          {meta.rows.map((r) => (
            <div key={r.id} className="rounded-md border border-border p-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">{r.name}</span>
                <Badge variant="secondary" className="text-[10px]">
                  {amountRangeLabel(r)}
                </Badge>
                {!r.isActive && <Badge variant="outline" className="text-[10px]">Inativa</Badge>}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {r.levels.map((l) => l.approvers.map((a) => a.name).join(" ou ")).join(" → ") ||
                  "Sem aprovadores"}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Nó individual memoizado — evita recriar milhares de elementos SVG a cada render. */
const MindMapNode = memo(function MindMapNode({
  node,
  hidden,
  selected,
  showLabel,
  showSub,
  onSelect,
  onToggle,
}: {
  node: Positioned;
  hidden: boolean;
  selected: boolean;
  showLabel: boolean;
  showSub: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const left = Math.cos(node.angle) < 0 && node.depth > 0;
  const anchor = node.depth === 0 ? "middle" : left ? "end" : "start";
  const dx = node.depth === 0 ? 0 : left ? -12 : 12;
  const collapsible = node.children.length > 0 || hidden;

  return (
    <g
      className="cursor-pointer"
      role="button"
      tabIndex={0}
      aria-label={`${KIND_LABEL[node.meta.kind]}: ${node.label}`}
      onClick={() => onSelect(node.id)}
      onDoubleClick={() => collapsible && onToggle(node.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(node.id);
        }
      }}
    >
      {selected && (
        <circle
          cx={node.x}
          cy={node.y}
          r={node.depth === 0 ? 18 : 14}
          className="fill-primary/15 stroke-primary"
          strokeWidth={1.5}
        />
      )}
      <circle
        cx={node.x}
        cy={node.y}
        r={node.depth === 0 ? 10 : Math.max(3.5, 8 - node.depth * 1.2)}
        className={`${DEPTH_FILL[Math.min(node.depth, DEPTH_FILL.length - 1)]} ${
          DEPTH_STROKE[Math.min(node.depth, DEPTH_STROKE.length - 1)]
        }`}
        strokeWidth={hidden ? 3 : 1.5}
      />
      {showLabel && (
        <text
          x={node.x + dx}
          y={node.y}
          textAnchor={anchor}
          dominantBaseline="middle"
          className="fill-foreground"
          pointerEvents="none"
          style={{
            fontSize: node.depth <= 1 ? 15 : node.depth === 2 ? 13 : 11,
            fontWeight: node.depth <= 2 || selected ? 600 : 400,
          }}
        >
          {truncate(node.label, node.depth >= 3 ? 34 : 26)}
        </text>
      )}
      {showSub && node.sub && (
        <text
          x={node.x + dx}
          y={node.y + (node.depth <= 1 ? 15 : 12)}
          textAnchor={anchor}
          dominantBaseline="middle"
          className="fill-muted-foreground"
          pointerEvents="none"
          style={{ fontSize: 9.5 }}
        >
          {truncate(node.sub, 34)}
        </text>
      )}
    </g>
  );
});

export function ApprovalMatrixMindMap({

  rows,
  rootLabel,
  onOpenList,
  storageKey,
}: {
  rows: MatrixRow[];
  rootLabel: string;
  onOpenList?: (filter: MindMapListFilter) => void;
  /** Chave para persistir zoom/recolhimento entre navegações (prefixo "erp:"). */
  storageKey?: string;
}) {
  const persistKey = storageKey ? `erp:approval-matrix:mindmap:${storageKey}` : null;

  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    // Teias muito grandes começam com os níveis de aprovação recolhidos.
    const fallback = () => (rows.length > 60 ? new Set(rows.map((r) => r.id)) : new Set<string>());
    if (!persistKey || typeof window === "undefined") return fallback();
    try {
      const raw = window.localStorage.getItem(persistKey);
      if (!raw) return fallback();
      const parsed = JSON.parse(raw);
      return new Set<string>(Array.isArray(parsed?.collapsed) ? parsed.collapsed : []);
    } catch {
      return fallback();
    }
  });

  const [zoom, setZoom] = useState(() => {
    if (!persistKey || typeof window === "undefined") return 1;
    try {
      const raw = window.localStorage.getItem(persistKey);
      const z = raw ? JSON.parse(raw)?.zoom : null;
      return typeof z === "number" && z >= 0.4 && z <= 3 ? z : 1;
    } catch {
      return 1;
    }
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!persistKey) return;
    try {
      window.localStorage.setItem(
        persistKey,
        JSON.stringify({ zoom, collapsed: [...collapsed] }),
      );
    } catch {
      /* ignore */
    }
  }, [persistKey, zoom, collapsed]);

  // ---- Filtros locais da teia -------------------------------------------
  const [mapSearch, setMapSearch] = useState("");
  const [mapFlow, setMapFlow] = useState<"all" | MatrixFlow>("all");
  const [mapCategory, setMapCategory] = useState<"all" | MatrixCategory>("all");
  const [mapApprover, setMapApprover] = useState<string>("all");

  const flowOptions = useMemo(
    () => [...new Set(rows.map((r) => r.flow))].sort(),
    [rows],
  );
  const categoryOptions = useMemo(
    () => [...new Set(rows.map((r) => r.category))].sort(),
    [rows],
  );
  const approverOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) for (const l of r.levels) for (const a of l.approvers) set.add(a.name);
    return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [rows]);

  const deferredSearch = useDeferredValue(mapSearch);

  const visibleRows = useMemo(() => {
    const term = deferredSearch.trim().toLowerCase();
    return rows.filter((r) => {
      if (mapFlow !== "all" && r.flow !== mapFlow && r.flow !== "both") return false;
      if (mapCategory !== "all" && r.category !== mapCategory) return false;
      if (
        mapApprover !== "all" &&
        !r.levels.some((l) => l.approvers.some((a) => a.name === mapApprover))
      ) {
        return false;
      }
      if (!term) return true;
      return (
        r.name.toLowerCase().includes(term) ||
        r.conditions.some((c) => c.toLowerCase().includes(term)) ||
        r.costCenters.some((c) => c.toLowerCase().includes(term)) ||
        r.levels.some((l) => l.approvers.some((a) => a.name.toLowerCase().includes(term)))
      );
    });
  }, [rows, deferredSearch, mapFlow, mapCategory, mapApprover]);

  const filtersActive =
    mapSearch.trim() !== "" || mapFlow !== "all" || mapCategory !== "all" || mapApprover !== "all";

  const clearFilters = () => {
    setMapSearch("");
    setMapFlow("all");
    setMapCategory("all");
    setMapApprover("all");
  };

  const tree = useMemo(() => buildTree(visibleRows, rootLabel), [visibleRows, rootLabel]);


  // Grafos grandes: o recálculo do layout roda em prioridade baixa para não
  // travar cliques/zoom enquanto a árvore é reposicionada.
  const deferredCollapsed = useDeferredValue(collapsed);
  const positioned = useMemo(
    () => layout(tree, deferredCollapsed, -Math.PI / 2, (3 * Math.PI) / 2),
    [tree, deferredCollapsed],
  );
  const nodes = useMemo(() => flatten(positioned), [positioned]);
  const edgePaths = useMemo(
    () =>
      links(positioned).map((e, i) => {
        const mr = (Math.hypot(e.from.x, e.from.y) + Math.hypot(e.to.x, e.to.y)) / 2;
        const c1x = Math.cos(e.from.angle) * mr;
        const c1y = Math.sin(e.from.angle) * mr;
        const c2x = Math.cos(e.to.angle) * mr;
        const c2y = Math.sin(e.to.angle) * mr;
        return {
          key: `${e.from.id}->${e.to.id}-${i}`,
          d: `M ${e.from.x.toFixed(1)} ${e.from.y.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${e.to.x.toFixed(1)} ${e.to.y.toFixed(1)}`,
          width: Math.max(1, 3 - e.from.depth * 0.6),
          className: DEPTH_STROKE[Math.min(e.from.depth, DEPTH_STROKE.length - 1)],
        };
      }),
    [positioned],
  );

  // Culling de rótulos: em teias densas os textos são o maior custo de layout
  // do SVG, então limitamos a profundidade rotulada conforme o volume de nós.
  const labelDepthLimit = nodes.length > 1200 ? 2 : nodes.length > 500 ? 3 : 4;
  const showSubLabels = nodes.length <= 500;

  const selected = useMemo(
    () => (selectedId ? nodes.find((n) => n.id === selectedId) ?? null : null),
    [nodes, selectedId],
  );

  const extent = useMemo(() => {
    let max = 260;
    for (const n of nodes) max = Math.max(max, Math.abs(n.x) + 220, Math.abs(n.y) + 90);
    return max;
  }, [nodes]);

  const size = (extent * 2) / zoom;
  const viewBox = `${-size / 2} ${-size / 2} ${size} ${size}`;

  const toggle = useCallback(
    (id: string) =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      }),
    [],
  );

  const handleSelect = useCallback((id: string) => setSelectedId(id), []);


  if (rows.length === 0) return null;

  const listFilter = (node: Node): MindMapListFilter => {
    const { meta } = node;
    if (meta.kind === "rule" || meta.kind === "level") return { search: meta.rule!.name };
    if (meta.kind === "category") return { flow: meta.flow, category: meta.category };
    if (meta.kind === "flow") return { flow: meta.flow };
    return {};
  };

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
        Clique em um nó para ver os detalhes no painel lateral. Duplo clique recolhe ou expande o
        ramo. Empresa → fluxo → categoria → regra → níveis de aprovação.
      </p>

      <svg
        viewBox={viewBox}
        className="h-[70vh] w-full"
        role="img"
        aria-label="Mapa mental das regras de aprovação"
        shapeRendering="optimizeSpeed"
      >
        <g pointerEvents="none">
          {edgePaths.map((e) => (
            <path
              key={e.key}
              d={e.d}
              fill="none"
              strokeWidth={e.width}
              className={e.className}
              opacity={0.5}
            />
          ))}
        </g>

        {nodes.map((n) => (
          <MindMapNode
            key={n.id}
            node={n}
            hidden={collapsed.has(n.id)}
            selected={selectedId === n.id}
            showLabel={n.depth <= labelDepthLimit}
            showSub={showSubLabels && n.depth <= labelDepthLimit}
            onSelect={handleSelect}
            onToggle={toggle}
          />
        ))}
      </svg>


      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-md">
          {selected && (
            <>
              <SheetHeader className="text-left">
                <Badge variant="outline" className="w-fit">
                  {KIND_LABEL[selected.meta.kind]}
                </Badge>
                <SheetTitle className="text-left">{selected.label}</SheetTitle>
                <SheetDescription className="text-left">
                  {selected.meta.kind === "level"
                    ? `Nível ${selected.meta.levelOrder} da regra ${selected.meta.rule?.name}`
                    : selected.sub}
                </SheetDescription>
              </SheetHeader>

              <ScrollArea className="-mx-6 flex-1 px-6 py-4">
                <NodeDetails node={selected} />
              </ScrollArea>

              <div className="flex flex-col gap-2 border-t border-border pt-4">
                {onOpenList && (
                  <Button
                    className="w-full gap-2"
                    onClick={() => {
                      onOpenList(listFilter(selected));
                      setSelectedId(null);
                    }}
                  >
                    <List className="h-4 w-4" />
                    Abrir lista completa
                  </Button>
                )}
                {(selected.children.length > 0 || collapsed.has(selected.id)) && (
                  <Button
                    variant="outline"
                    className="w-full gap-2"
                    onClick={() => toggle(selected.id)}
                  >
                    <ChevronsUpDown className="h-4 w-4" />
                    {collapsed.has(selected.id) ? "Expandir ramo" : "Recolher ramo"}
                  </Button>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
