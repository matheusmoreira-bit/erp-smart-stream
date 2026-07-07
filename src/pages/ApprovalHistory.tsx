import { useMemo, useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, RefreshCw, CheckCircle2, XCircle, Search, Building2, User, Calendar, FileText, Network, FileDown, UserCog } from "lucide-react";
import { exportListReportPdf, exportListReportCsv } from "@/lib/report-pdf";
import { toast } from "sonner";
import { useSap } from "@/contexts/SapContext";
import { useAuth } from "@/hooks/useAuth";
import { useModuleAccess } from "@/hooks/usePermissions";
import { useApprovalHistory, type ApprovalHistoryRow } from "@/hooks/useApprovalHistory";
import { useExpenses, type Expense } from "@/hooks/useExpenses";
import { useCompanies } from "@/hooks/useCompanies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { RelationsMap } from "@/components/RelationsMap";
import { PageTitle } from "@/components/PageTitle";
import { ChevronDown } from "lucide-react";


function formatCurrency(value?: number | null, currency = "BRL") {
  const n = Number(value || 0);
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(n);
  } catch {
    return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
function formatDate(iso?: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("pt-BR"); } catch { return "—"; }
}

export default function ApprovalHistory() {
  const navigate = useNavigate();
  const { session } = useSap();
  const { isAdmin: isLovableAdmin } = useAuth();
  const isAdmin = isLovableAdmin || (session?.isSuperUser ?? false);
  const { hasAccess: canViewAllApprovals } = useModuleAccess("approvals_view_all");
  const canViewAll = isAdmin || canViewAllApprovals;
  const { getLabel } = useCompanies(true);
  const { rows, syncState, isLoading, isSyncing, sync } = useApprovalHistory(session?.companyDB);
  const { expenses: purchaseExpenses } = useExpenses("purchase");
  const { expenses: salesExpenses } = useExpenses("sales");
  const { expensesByDocEntry, expensesById } = useMemo(() => {
    const byDoc = new Map<number, Expense>();
    const byId = new Map<string, Expense>();
    for (const e of [...purchaseExpenses, ...salesExpenses]) {
      byId.set(e.id, e);
      if (typeof e.sap_doc_entry === "number") byDoc.set(e.sap_doc_entry, e);
    }
    return { expensesByDocEntry: byDoc, expensesById: byId };
  }, [purchaseExpenses, salesExpenses]);
  const [relationsMapExpense, setRelationsMapExpense] = useState<Expense | null>(null);

  const [query, setQuery] = useState("");
  const [decision, setDecision] = useState<"all" | "Y" | "N">("all");
  // Filtro de rastreabilidade de substituto (multi-seleção):
  //   [] (vazio) → não filtra
  //   ["__any__"]  → apenas decisões executadas por substituto
  //   ["__none__"] → apenas decisões executadas pelo próprio aprovador oficial
  //   ["<key1>","<key2>",...] → substituídos específicos (chave = email || nome)
  // "__any__"/"__none__" são mutuamente exclusivos entre si e com chaves específicas.
  const [substituteFilter, setSubstituteFilter] = useState<string[]>([]);
  // Admin/view-all veem tudo por padrão; demais usuários ficam restritos às próprias decisões/solicitações.
  const [scope, setScope] = useState<"mine" | "all">(canViewAll ? "all" : "mine");
  useEffect(() => { setScope(canViewAll ? "all" : "mine"); }, [canViewAll]);

  const myKeys = useMemo(() => {
    const list = [(session?.userName || "").toLowerCase()].filter(Boolean);
    return new Set(list);
  }, [session]);

  const effectiveScope: "mine" | "all" = canViewAll ? scope : "mine";

  // Lista de oficiais substituídos presentes nos dados — alimenta o Select.
  const substitutedOptions = useMemo(() => {
    const map = new Map<string, string>(); // key -> label
    for (const r of rows) {
      const email = (r.substituted_for_email || "").trim();
      const name = (r.substituted_for_name || "").trim();
      if (!email && !name) continue;
      const key = (email || name).toLowerCase();
      const label = name && email ? `${name} <${email}>` : name || email;
      if (!map.has(key)) map.set(key, label);
    }
    return Array.from(map.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      // Apenas decisões finalizadas (aprovado/rejeitado). Pendentes (W) ficam fora do histórico.
      if (r.decision !== "Y" && r.decision !== "N") return false;
      if (effectiveScope === "mine") {
        const candidates = [
          r.approver_code, r.approver_email, r.approver_name,
          r.requester_code, r.requester_name,
        ];
        const hit = candidates
          .filter(Boolean)
          .some((v) => myKeys.has(String(v).toLowerCase()));
        if (!hit) return false;
      }
      if (decision !== "all" && r.decision !== decision) return false;

      // Filtro por substituto (multi-seleção)
      if (substituteFilter.length > 0) {
        const email = (r.substituted_for_email || "").toLowerCase();
        const name = (r.substituted_for_name || "").toLowerCase();
        const hasSubstitution = !!(email || name);
        if (substituteFilter.includes("__any__")) {
          if (!hasSubstitution) return false;
        } else if (substituteFilter.includes("__none__")) {
          if (hasSubstitution) return false;
        } else {
          const key = email || name;
          if (!substituteFilter.includes(key)) return false;
        }
      }

      if (!q) return true;
      return [
        r.card_name, r.card_code, r.requester_name, r.approver_name,
        r.substituted_for_name, r.substituted_for_email,
        r.doc_type_name, String(r.doc_num || ""), r.remarks, r.stage_name,
      ].some((v) => (v || "").toString().toLowerCase().includes(q));
    });
  }, [rows, query, decision, effectiveScope, myKeys, substituteFilter]);



  const handleSync = async () => {
    try {
      const r = await sync();
      toast.success(`Sincronizado: ${r.upserted} registros`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao sincronizar");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <PageTitle title="Histórico de Aprovações" />
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/menu")}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Voltar
            </Button>
            <div>
              <h1 className="text-xl font-bold">Histórico de Aprovações</h1>
              <p className="text-xs text-muted-foreground">
                {getLabel(session?.companyDB || "")} ·{" "}
                {syncState?.last_sync_at
                  ? `Sincronizado em ${formatDate(syncState.last_sync_at)}`
                  : "Nunca sincronizado"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(() => {
              const reportOptions = {
                title: "Relatório — Histórico de Aprovações",
                subtitle: `${filtered.length} decisão(ões)`,
                meta: [
                  { label: "Empresa", value: getLabel(session?.companyDB) || "—" },
                  { label: "Escopo", value: effectiveScope === "all" ? "Todos" : "Minhas" },
                ],
                columns: [
                  { header: "Data", cell: (r: typeof filtered[number]) => formatDate(r.decision_date) },
                  { header: "Decisão", cell: (r: typeof filtered[number]) => r.decision === "Y" ? "Aprovado" : r.decision === "N" ? "Rejeitado" : String(r.decision ?? "—") },
                  { header: "Doc #", cell: (r: typeof filtered[number]) => String(r.doc_num ?? "—") },
                  { header: "Tipo", cell: (r: typeof filtered[number]) => r.doc_type_name || "—" },
                  { header: "Parceiro", cell: (r: typeof filtered[number]) => r.card_name || "—" },
                  { header: "Solicitante", cell: (r: typeof filtered[number]) => r.requester_name || "—" },
                  { header: "Aprovador", cell: (r: typeof filtered[number]) => r.approver_name || "—" },
                  { header: "Em nome de", cell: (r: typeof filtered[number]) => r.substituted_for_name || r.substituted_for_email || "—" },
                  { header: "Total", align: "right" as const, cell: (r: typeof filtered[number]) => formatCurrency(r.doc_total, r.currency) },
                  { header: "Observações", cell: (r: typeof filtered[number]) => r.remarks || "—" },
                ],
                rows: filtered,
                fileName: "historico_aprovacoes",
              };
              return (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    disabled={filtered.length === 0}
                    onClick={() => { void exportListReportPdf(reportOptions); }}
                    title="Exportar em PDF respeitando os filtros aplicados"
                  >
                    <FileDown className="w-4 h-4" /> PDF
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    disabled={filtered.length === 0}
                    onClick={() => { exportListReportCsv(reportOptions); }}
                    title="Exportar em CSV respeitando os filtros aplicados"
                  >
                    <FileDown className="w-4 h-4" /> CSV
                  </Button>
                </>
              );
            })()}
            <Button onClick={handleSync} disabled={isSyncing} size="sm">
              <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? "animate-spin" : ""}`} />
              {isSyncing ? "Sincronizando..." : "Sincronizar agora"}
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        <div className="glass-card p-4 mb-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por fornecedor, solicitante, nº do documento..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          {canViewAll && (
            <Select value={scope} onValueChange={(v) => setScope(v as "mine" | "all")}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="mine">Minhas decisões/pedidos</SelectItem>
                <SelectItem value="all">Todas as decisões</SelectItem>
              </SelectContent>
            </Select>
          )}

          <Select value={decision} onValueChange={(v) => setDecision(v as "all" | "Y" | "N")}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="Y">Aprovados</SelectItem>
              <SelectItem value="N">Rejeitados</SelectItem>
            </SelectContent>
          </Select>

          {(() => {
            const anySel = substituteFilter.includes("__any__");
            const noneSel = substituteFilter.includes("__none__");
            const specificKeys = substituteFilter.filter((k) => k !== "__any__" && k !== "__none__");
            const summary = substituteFilter.length === 0
              ? "Substituto: todos"
              : anySel
                ? "Somente por substituto"
                : noneSel
                  ? "Somente pelo próprio aprovador"
                  : specificKeys.length === 1
                    ? (substitutedOptions.find((o) => o.key === specificKeys[0])?.label || specificKeys[0])
                    : `${specificKeys.length} substituídos`;
            const toggleExclusive = (key: "__any__" | "__none__") => {
              setSubstituteFilter((prev) => prev.includes(key) ? [] : [key]);
            };
            const toggleKey = (key: string) => {
              setSubstituteFilter((prev) => {
                const cleaned = prev.filter((k) => k !== "__any__" && k !== "__none__");
                return cleaned.includes(key) ? cleaned.filter((k) => k !== key) : [...cleaned, key];
              });
            };
            return (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-64 justify-between font-normal" title="Filtrar por aprovações executadas por substituto">
                    <span className="truncate">{summary}</span>
                    <ChevronDown className="w-4 h-4 opacity-50 shrink-0" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-2" align="start">
                  <div className="max-h-80 overflow-y-auto space-y-0.5">
                    <button
                      type="button"
                      onClick={() => setSubstituteFilter([])}
                      className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-accent"
                    >
                      Substituto: todos
                    </button>
                    <label className="flex items-center gap-2 text-sm px-2 py-1.5 rounded hover:bg-accent cursor-pointer">
                      <Checkbox checked={anySel} onCheckedChange={() => toggleExclusive("__any__")} />
                      Somente por substituto
                    </label>
                    <label className="flex items-center gap-2 text-sm px-2 py-1.5 rounded hover:bg-accent cursor-pointer">
                      <Checkbox checked={noneSel} onCheckedChange={() => toggleExclusive("__none__")} />
                      Somente pelo próprio aprovador
                    </label>
                    {substitutedOptions.length > 0 && (
                      <>
                        <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Em nome de
                        </div>
                        {substitutedOptions.map((o) => (
                          <label
                            key={o.key}
                            className={`flex items-center gap-2 text-sm px-2 py-1.5 rounded hover:bg-accent cursor-pointer ${anySel || noneSel ? "opacity-50" : ""}`}
                          >
                            <Checkbox
                              checked={specificKeys.includes(o.key)}
                              disabled={anySel || noneSel}
                              onCheckedChange={() => toggleKey(o.key)}
                            />
                            <span className="truncate">{o.label}</span>
                          </label>
                        ))}
                      </>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            );
          })()}
        </div>

        {syncState?.last_status === "error" && (
          <div className="mb-4 p-3 rounded-lg border border-destructive/40 bg-destructive/10 text-sm text-destructive">
            Última sincronização falhou: {syncState.last_message}
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-16 text-muted-foreground">Carregando histórico...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            Nenhuma aprovação encontrada. Aprovações do ERP Flow aparecem automaticamente;
            para trazer decisões feitas direto no SAP, clique em "Sincronizar agora".
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((r) => {
              const linked =
                (r.expense_id ? expensesById.get(r.expense_id) : undefined) ||
                (typeof r.doc_entry === "number" ? expensesByDocEntry.get(r.doc_entry) : undefined);
              return (
                <HistoryCard
                  key={r.id}
                  row={r}
                  onRelationsMap={linked ? () => setRelationsMapExpense(linked) : undefined}
                />
              );
            })}
          </div>
        )}
      </main>

      <RelationsMap
        open={!!relationsMapExpense}
        onClose={() => setRelationsMapExpense(null)}
        expense={relationsMapExpense as any}
        title="Mapa de Relações"
      />
    </div>
  );
}

function HistoryCard({ row, onRelationsMap }: { row: ApprovalHistoryRow; onRelationsMap?: () => void }) {
  const isApproved = row.decision === "Y";
  const isRejected = row.decision === "N";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-4 flex flex-col gap-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-full">
              {row.doc_type_name || "Documento"}
            </span>
            <span
              className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                row.source === "erp_flow"
                  ? "text-sky-600 bg-sky-500/10 border-sky-500/30"
                  : "text-violet-600 bg-violet-500/10 border-violet-500/30"
              }`}
              title={row.source === "erp_flow" ? "Decisão registrada no ERP Flow" : "Decisão sincronizada do SAP Approval Hub"}
            >
              {row.source === "erp_flow" ? "ERP Flow" : "SAP"}
            </span>
          </div>
          <h3 className="font-mono font-semibold mt-1">#{row.doc_num || row.doc_entry || "—"}</h3>
        </div>
        <div className="text-right flex items-start gap-1">
          {onRelationsMap && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-primary"
              title="Mapa de relações"
              onClick={onRelationsMap}
            >
              <Network className="w-4 h-4" />
            </Button>
          )}
          <div>
            <p className="font-mono font-bold">{formatCurrency(row.doc_total, row.currency || "BRL")}</p>
            {isApproved && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-600 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-2 py-0.5 mt-1">
                <CheckCircle2 className="w-3 h-3" /> Aprovado
              </span>
            )}
            {isRejected && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-destructive bg-destructive/10 border border-destructive/30 rounded-full px-2 py-0.5 mt-1">
                <XCircle className="w-3 h-3" /> Rejeitado
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="text-sm text-muted-foreground space-y-1">
        <div className="flex items-center gap-2 truncate"><Building2 className="w-3.5 h-3.5 text-primary/70" />{row.card_name || row.card_code || "—"}</div>
        <div className="flex items-center gap-2"><User className="w-3.5 h-3.5 text-primary/70" />Aprovador: <span className="text-foreground font-medium">{row.approver_name || row.approver_code || "—"}</span></div>
        {(row.substituted_for_name || row.substituted_for_email) && (
          <div
            className="flex items-center gap-2 text-amber-700 dark:text-amber-400"
            title={`Aprovação executada por ${row.approver_name || row.approver_code || "—"} atuando como substituto autorizado de ${row.substituted_for_name || row.substituted_for_email}`}
          >
            <UserCog className="w-3.5 h-3.5" />
            Em nome de: <span className="font-medium">{row.substituted_for_name || row.substituted_for_email}</span>
          </div>
        )}
        <div className="flex items-center gap-2"><FileText className="w-3.5 h-3.5 text-primary/70" />Solicitante: <span className="text-foreground font-medium">{row.requester_name || row.requester_code || "—"}</span></div>
        <div className="flex items-center gap-2"><Calendar className="w-3.5 h-3.5 text-primary/70" />{formatDate(row.decision_date)}</div>
      </div>

      {row.remarks && (
        <div className="text-xs text-muted-foreground italic border-t border-border/50 pt-2 line-clamp-3">
          "{row.remarks}"
        </div>
      )}
    </motion.div>
  );
}
