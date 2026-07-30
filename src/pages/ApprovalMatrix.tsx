import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ShieldCheck,
  Printer,
  Download,
  RefreshCw,
  Loader2,
  Search,
  ArrowRight,
  Users,
  Layers,
  ShoppingCart,
  Receipt,
  Wallet,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSap } from "@/contexts/SapContext";
import { useCompanies } from "@/hooks/useCompanies";
import { useApprovalRules } from "@/hooks/useApprovalRules";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  FLOW_LABELS,
  amountRangeLabel,
  matrixToCsv,
  toMatrixRow,
  type MatrixCategory,
  type MatrixFlow,
  type MatrixRow,
} from "@/lib/approval-matrix";

const FLOW_TABS: { key: "all" | MatrixFlow; label: string }[] = [
  { key: "all", label: "Todos os fluxos" },
  { key: "purchase", label: "Compras" },
  { key: "sales", label: "Vendas" },
  { key: "advance", label: "Adiantamentos" },
];

const FLOW_ICON: Record<MatrixFlow, typeof ShoppingCart> = {
  purchase: ShoppingCart,
  sales: Receipt,
  advance: Wallet,
  both: Layers,
};

const CATEGORY_TONE: Record<MatrixCategory, string> = {
  impostos: "border-l-destructive",
  folha: "border-l-primary",
  reembolso: "border-l-accent",
  cost_center: "border-l-primary",
  project: "border-l-accent",
  supplier: "border-l-muted-foreground",
  value: "border-l-primary",
  general: "border-l-muted-foreground",
};

function LevelChain({ row }: { row: MatrixRow }) {
  if (row.levels.length === 0) {
    return <span className="text-xs text-muted-foreground">Sem aprovadores configurados</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {row.levels.map((lvl, i) => (
        <div key={lvl.order} className="flex items-center gap-2">
          <div className="rounded-md border border-border bg-muted/40 px-3 py-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Nível {lvl.order}
            </div>
            <div className="text-sm font-medium text-foreground">
              {lvl.approvers.map((a) => a.name).join("  ou  ")}
            </div>
          </div>
          {i < row.levels.length - 1 && (
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
        </div>
      ))}
    </div>
  );
}

export default function ApprovalMatrix() {
  const { session, logout } = useSap();
  const { getLabel } = useCompanies();
  const { rules, isLoading, error, refresh } = useApprovalRules();

  const [flow, setFlow] = useState<"all" | MatrixFlow>("all");
  const [category, setCategory] = useState<"all" | MatrixCategory>("all");
  const [search, setSearch] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);

  const companyLabel = getLabel(session?.companyDB || "") || session?.companyDB || "—";

  const rows = useMemo(() => {
    const all = rules.map(toMatrixRow);
    const term = search.trim().toLowerCase();
    return all
      .filter((r) => (onlyActive ? r.isActive : true))
      .filter((r) => (flow === "all" ? true : r.flow === flow || r.flow === "both"))
      .filter((r) => (category === "all" ? true : r.category === category))
      .filter((r) =>
        !term
          ? true
          : r.name.toLowerCase().includes(term) ||
            r.conditions.some((c) => c.toLowerCase().includes(term)) ||
            r.levels.some((l) => l.approvers.some((a) => a.name.toLowerCase().includes(term))),
      )
      .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name, "pt-BR"));
  }, [rules, flow, category, search, onlyActive]);

  const grouped = useMemo(() => {
    const flows: MatrixFlow[] = ["purchase", "sales", "advance", "both"];
    return flows
      .map((f) => ({
        flow: f,
        categories: CATEGORY_ORDER.map((c) => ({
          category: c,
          rows: rows.filter((r) => r.flow === f && r.category === c),
        })).filter((g) => g.rows.length > 0),
      }))
      .filter((g) => g.categories.length > 0);
  }, [rows]);

  const stats = useMemo(() => {
    const approvers = new Set<string>();
    let maxLevels = 0;
    for (const r of rows) {
      maxLevels = Math.max(maxLevels, r.levels.length);
      for (const l of r.levels) for (const a of l.approvers) approvers.add(a.name.toLowerCase());
    }
    return { rules: rows.length, approvers: approvers.size, maxLevels };
  }, [rows]);

  const generatedAt = new Date().toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" });

  const exportCsv = () => {
    const blob = new Blob(["\ufeff" + matrixToCsv(rows)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `matriz-aprovacoes-${session?.companyDB || "empresa"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="print:hidden">
        <PageHeader
          icon={<ShieldCheck className="h-5 w-5 text-primary" />}
          title="Aprovações"
          titleAccent="Matriz de Alçadas"
          subtitle="Visão executiva das regras de aprovação de compras e vendas, pronta para exportação"
          documentTitle="Matriz de Alçadas"
          backTo="/aprovacoes"
          companyLabel={companyLabel}
          userName={session?.userName}
          onLogout={logout}
          actions={
            <>
              <Button variant="outline" size="sm" className="gap-2" onClick={() => void refresh()} disabled={isLoading}>
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Atualizar
              </Button>
              <Button variant="outline" size="sm" className="gap-2" onClick={exportCsv}>
                <Download className="h-4 w-4" />
                CSV
              </Button>
              <Button size="sm" className="gap-2" onClick={() => window.print()}>
                <Printer className="h-4 w-4" />
                Exportar PDF
              </Button>
            </>
          }
        />
      </div>

      <main className="mx-auto max-w-7xl px-6 py-6 print:max-w-none print:px-0 print:py-0">
        {/* Filtros — ocultos na exportação */}
        <Card className="mb-6 p-4 print:hidden">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por regra, condição ou aprovador"
                className="pl-9"
                aria-label="Buscar regras"
              />
            </div>
            <Select value={flow} onValueChange={(v) => setFlow(v as typeof flow)}>
              <SelectTrigger className="w-[190px]" aria-label="Fluxo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FLOW_TABS.map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={category} onValueChange={(v) => setCategory(v as typeof category)}>
              <SelectTrigger className="w-[210px]" aria-label="Categoria">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as categorias</SelectItem>
                {CATEGORY_ORDER.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Switch id="only-active" checked={onlyActive} onCheckedChange={setOnlyActive} />
              <Label htmlFor="only-active" className="text-sm">
                Somente ativas
              </Label>
            </div>
          </div>
        </Card>

        {/* Capa do relatório */}
        <Card className="mb-6 border-l-4 border-l-primary p-6 print:border print:shadow-none">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Matriz de Alçadas de Aprovação</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {companyLabel} · Emitido em {generatedAt}
              </p>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Documento de referência para a diretoria: apresenta as regras gerais e específicas
                (impostos, folha, reembolsos, centros de custo e faixas de valor) aplicadas aos fluxos
                de compras e vendas, com a cadeia de aprovadores de cada caso.
              </p>
            </div>
            <div className="flex gap-6">
              <div>
                <div className="text-3xl font-semibold text-foreground">{stats.rules}</div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Regras</div>
              </div>
              <div>
                <div className="text-3xl font-semibold text-foreground">{stats.approvers}</div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Aprovadores</div>
              </div>
              <div>
                <div className="text-3xl font-semibold text-foreground">{stats.maxLevels}</div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Níveis máx.</div>
              </div>
            </div>
          </div>
        </Card>

        {error && (
          <Card className="mb-6 border-l-4 border-l-destructive p-4 text-sm text-muted-foreground">
            Não foi possível carregar as regras: {error}
          </Card>
        )}

        {isLoading && rows.length === 0 && (
          <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando regras de aprovação…
          </div>
        )}

        {!isLoading && rows.length === 0 && (
          <Card className="p-10 text-center text-sm text-muted-foreground">
            Nenhuma regra encontrada com os filtros atuais.
          </Card>
        )}

        <div className="space-y-8">
          {grouped.map((group) => {
            const Icon = FLOW_ICON[group.flow];
            return (
              <section key={group.flow} className="break-inside-avoid">
                <div className="mb-3 flex items-center gap-2 border-b border-border pb-2">
                  <Icon className="h-5 w-5 text-primary" aria-hidden />
                  <h2 className="text-lg font-semibold text-foreground">{FLOW_LABELS[group.flow]}</h2>
                  <Badge variant="secondary" className="ml-1">
                    {group.categories.reduce((n, c) => n + c.rows.length, 0)} regras
                  </Badge>
                </div>

                <div className="space-y-6">
                  {group.categories.map((cat) => (
                    <div key={cat.category}>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {CATEGORY_LABELS[cat.category]}
                      </h3>
                      <div className="grid gap-3">
                        {cat.rows.map((row, i) => (
                          <motion.div
                            key={row.id}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.2, delay: Math.min(i * 0.02, 0.2) }}
                          >
                            <Card
                              className={`break-inside-avoid border-l-4 p-4 print:shadow-none ${CATEGORY_TONE[row.category]}`}
                            >
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-medium text-foreground">{row.name}</span>
                                    {!row.isActive && <Badge variant="outline">Inativa</Badge>}
                                    <Badge variant="secondary">{amountRangeLabel(row)}</Badge>
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    {row.conditions.length === 0 ? (
                                      <Badge variant="outline">Sem condições — regra padrão</Badge>
                                    ) : (
                                      row.conditions.map((c, idx) => (
                                        <Badge key={idx} variant="outline" className="font-normal">
                                          {c}
                                        </Badge>
                                      ))
                                    )}
                                  </div>
                                </div>
                                <div className="text-right text-xs text-muted-foreground">
                                  Prioridade {row.priority}
                                </div>
                              </div>

                              <div className="mt-3 flex items-start gap-2 border-t border-border pt-3">
                                <Users className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                                <LevelChain row={row} />
                              </div>
                            </Card>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        <p className="mt-10 text-center text-xs text-muted-foreground">
          ERP Flow · Matriz de Alçadas · {companyLabel} · {generatedAt}
        </p>
      </main>
    </div>
  );
}
