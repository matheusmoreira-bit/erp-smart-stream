import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, RefreshCw, CheckCircle2, XCircle, Search, Building2, User, Calendar, FileText, Network } from "lucide-react";
import { toast } from "sonner";
import { useSap } from "@/contexts/SapContext";
import { useAuth } from "@/hooks/useAuth";
import { useApprovalHistory, type ApprovalHistoryRow } from "@/hooks/useApprovalHistory";
import { useExpenses, type Expense } from "@/hooks/useExpenses";
import { useCompanies } from "@/hooks/useCompanies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RelationsMap } from "@/components/RelationsMap";
import { PageTitle } from "@/components/PageTitle";


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
  const { getLabel } = useCompanies(true);
  const { rows, syncState, isLoading, isSyncing, sync } = useApprovalHistory(session?.companyDB);
  const { expenses: purchaseExpenses } = useExpenses("purchase");
  const { expenses: salesExpenses } = useExpenses("sales");
  const expensesByDocEntry = useMemo(() => {
    const m = new Map<number, Expense>();
    for (const e of [...purchaseExpenses, ...salesExpenses]) {
      if (typeof e.sap_doc_entry === "number") m.set(e.sap_doc_entry, e);
    }
    return m;
  }, [purchaseExpenses, salesExpenses]);
  const [relationsMapExpense, setRelationsMapExpense] = useState<Expense | null>(null);

  const [query, setQuery] = useState("");
  const [decision, setDecision] = useState<"all" | "Y" | "N">("all");
  // Admin vê tudo por padrão; demais usuários ficam restritos às próprias decisões/solicitações.
  const [scope, setScope] = useState<"mine" | "all">(isAdmin ? "all" : "mine");
  useEffect(() => { setScope(isAdmin ? "all" : "mine"); }, [isAdmin]);

  const myKeys = useMemo(() => {
    const list = [(session?.userName || "").toLowerCase()].filter(Boolean);
    return new Set(list);
  }, [session]);

  const effectiveScope: "mine" | "all" = isAdmin ? scope : "mine";

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
      if (!q) return true;
      return [
        r.card_name, r.card_code, r.requester_name, r.approver_name,
        r.doc_type_name, String(r.doc_num || ""), r.remarks, r.stage_name,
      ].some((v) => (v || "").toString().toLowerCase().includes(q));
    });
  }, [rows, query, decision, effectiveScope, myKeys]);



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
          <Button onClick={handleSync} disabled={isSyncing} size="sm">
            <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? "animate-spin" : ""}`} />
            {isSyncing ? "Sincronizando..." : "Sincronizar agora"}
          </Button>
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
          {isAdmin && (
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
            Nenhuma aprovação encontrada. Clique em "Sincronizar agora" para carregar do SAP Approval Hub.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((r) => {
              const linked = typeof r.doc_entry === "number" ? expensesByDocEntry.get(r.doc_entry) : undefined;
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
          <span className="text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-full">
            {row.doc_type_name || "Documento"}
          </span>
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
