import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Search,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  RefreshCw,
  FileText,
  Paperclip,
  Link2,
  CreditCard,
  ShoppingCart,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";
import { toast } from "sonner";
import { PageTitle } from "@/components/PageTitle";

/* ───────────────── Types ───────────────── */

type Source = "expense" | "pagcorp";
type StageStatus = "success" | "failed" | "pending" | "not_applicable" | null;

interface UnifiedIntegration {
  id: string;
  source: Source;
  created_at: string;
  last_check_at?: string | null;
  company_db: string | null;
  external_ref: string;       // expense id slice / pagcorp expense id
  description: string;        // supplier_name / pagcorp description
  amount: number | null;
  currency: string | null;
  initiated_by: string | null;
  status: "success" | "failed" | "pending" | "skipped";
  sap_doc_entry: number | null;
  sap_doc_num: number | null;
  // Expense-only
  attachment_status?: StageStatus;
  purchase_order_status?: StageStatus;
  attachment_link_status?: StageStatus;
  attachment_entry?: number | null;
  // PagCorp-only
  integration_type?: string;
  // Raw payloads for the detail view
  raw: Record<string, unknown>;
}

/* ───────────────── Helpers ───────────────── */

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeCurrency(currency?: string | null): string {
  if (!currency) return "BRL";
  const c = currency.trim().toUpperCase();
  // Map common symbols/aliases to ISO 4217 codes
  if (c === "R$" || c === "REAL" || c === "REAIS") return "BRL";
  if (c === "US$" || c === "USD$" || c === "$") return "USD";
  if (c === "€" || c === "EURO") return "EUR";
  // Valid ISO codes are 3 letters
  return /^[A-Z]{3}$/.test(c) ? c : "BRL";
}

function formatCurrency(value: number | null, currency: string | null = "BRL") {
  if (value === null || Number.isNaN(value)) return "—";
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: normalizeCurrency(currency),
      minimumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency ?? ""} ${value.toFixed(2)}`.trim();
  }
}

function StageBadge({
  status,
  icon: Icon,
  label,
}: {
  status: StageStatus;
  icon: typeof Paperclip;
  label: string;
}) {
  if (!status || status === "not_applicable") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60">
        <Icon className="w-3 h-3" />
        <span>—</span>
      </span>
    );
  }
  const map: Record<Exclude<StageStatus, null | "not_applicable">, string> = {
    success: "bg-success/15 text-success border-success/30",
    failed: "bg-destructive/15 text-destructive border-destructive/30",
    pending: "bg-warning/15 text-warning border-warning/30",
  };
  return (
    <span
      title={label}
      className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border ${map[status]}`}
    >
      <Icon className="w-3 h-3" />
      <span className="capitalize">{status === "success" ? "ok" : status === "failed" ? "erro" : "pend."}</span>
    </span>
  );
}

function StatusBadge({ status }: { status: UnifiedIntegration["status"] }) {
  const cfg: Record<UnifiedIntegration["status"], { label: string; className: string; Icon: typeof CheckCircle2 }> = {
    success: { label: "Sucesso", className: "bg-success/15 text-success border-success/30", Icon: CheckCircle2 },
    failed: { label: "Falhou", className: "bg-destructive/15 text-destructive border-destructive/30", Icon: XCircle },
    pending: { label: "Pendente", className: "bg-warning/15 text-warning border-warning/30", Icon: Clock },
    skipped: { label: "Não integrado", className: "bg-muted text-muted-foreground border-border", Icon: AlertCircle },
  };
  const { label, className, Icon } = cfg[status];
  return (
    <Badge variant="outline" className={`gap-1 ${className}`}>
      <Icon className="w-3 h-3" />
      {label}
    </Badge>
  );
}

/* ───────────────── Page ───────────────── */

export default function IntegrationsMonitor() {
  const navigate = useNavigate();
  const { session } = useSap();
  const [items, setItems] = useState<UnifiedIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [sourceFilter, setSourceFilter] = useState<"all" | Source>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | UnifiedIntegration["status"]>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<UnifiedIntegration | null>(null);

  const fetchData = useCallback(
    async (showSpinner = true) => {
      if (showSpinner) setLoading(true);
      else setRefreshing(true);
      try {
        const companyDb = session?.companyDB || null;

        // Expenses with any sign of integration activity
        let expenseQuery = supabase
          .from("expenses")
          .select(
            "id, created_at, company_db, supplier_name, total_amount, currency, requester_name, status, sap_doc_entry, sap_doc_num, sap_attachment_entry, sap_attachment_status, sap_purchase_order_status, sap_attachment_link_status, sap_integration_error, sap_integration_last_attempt_at, sap_status_last_check_at, origin",
          )
          .order("sap_integration_last_attempt_at", { ascending: false, nullsFirst: false })
          .limit(500);

        if (companyDb) expenseQuery = expenseQuery.eq("company_db", companyDb);

        // Only expenses that were already approved or beyond — those are
        // the ones that should have hit the SAP integration pipeline.
        expenseQuery = expenseQuery.in("status", [
          "aprovado",
          "pc_lancado",
          "nf_entrada",
          "pagamento",
          "finalizado",
        ]);

        let pagcorpQuery = supabase
          .from("pagcorp_integration_log")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(500);
        if (companyDb) pagcorpQuery = pagcorpQuery.eq("company_db", companyDb);

        const [expRes, pagRes] = await Promise.all([expenseQuery, pagcorpQuery]);

        if (expRes.error) throw expRes.error;
        if (pagRes.error) throw pagRes.error;

        const expenseRows: UnifiedIntegration[] = (expRes.data || []).map((e: any) => {
          const hasError = !!e.sap_integration_error;
          const hasDoc = !!e.sap_doc_entry;
          let status: UnifiedIntegration["status"];
          if (hasDoc && !hasError) status = "success";
          else if (hasError) status = "failed";
          else if (e.sap_purchase_order_status === "pending" || e.sap_attachment_status === "pending") status = "pending";
          else status = "skipped";

          return {
            id: e.id,
            source: "expense",
            created_at: e.sap_integration_last_attempt_at || e.created_at,
            last_check_at: e.sap_status_last_check_at || e.sap_integration_last_attempt_at || null,
            company_db: e.company_db,
            external_ref: e.id.slice(0, 8),
            description: e.supplier_name || "—",
            amount: Number(e.total_amount) || 0,
            currency: e.currency || "BRL",
            initiated_by: e.requester_name || null,
            status,
            sap_doc_entry: e.sap_doc_entry,
            sap_doc_num: e.sap_doc_num,
            attachment_status: e.sap_attachment_status as StageStatus,
            purchase_order_status: e.sap_purchase_order_status as StageStatus,
            attachment_link_status: e.sap_attachment_link_status as StageStatus,
            attachment_entry: e.sap_attachment_entry,
            raw: e,
          };
        });

        const pagcorpRows: UnifiedIntegration[] = (pagRes.data || []).map((p: any) => {
          let status: UnifiedIntegration["status"];
          if (p.status === "success") status = "success";
          else if (p.status === "error" || p.status === "failed") status = "failed";
          else status = "pending";

          const data = (p.pagcorp_data || {}) as Record<string, unknown>;
          const desc =
            (data.description as string) ||
            (data.merchant_name as string) ||
            (data.supplier_name as string) ||
            `PagCorp #${p.pagcorp_expense_id}`;
          const amount = Number(data.amount ?? data.value ?? data.total ?? 0) || null;

          return {
            id: p.id,
            source: "pagcorp",
            created_at: p.created_at,
            company_db: p.company_db,
            external_ref: String(p.pagcorp_expense_id),
            description: desc,
            amount,
            currency: (data.currency as string) || "BRL",
            initiated_by: p.integrated_by,
            status,
            sap_doc_entry: p.sap_doc_entry,
            sap_doc_num: p.sap_doc_num,
            integration_type: p.integration_type,
            raw: p,
          };
        });

        const merged = [...expenseRows, ...pagcorpRows].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
        setItems(merged);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao carregar integrações");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [session?.companyDB],
  );

  useEffect(() => {
    fetchData(true);
  }, [fetchData]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (sourceFilter !== "all" && it.source !== sourceFilter) return false;
      if (statusFilter !== "all" && it.status !== statusFilter) return false;
      if (!q) return true;
      return (
        it.external_ref.toLowerCase().includes(q) ||
        it.description.toLowerCase().includes(q) ||
        (it.initiated_by || "").toLowerCase().includes(q) ||
        (it.sap_doc_num ? String(it.sap_doc_num).includes(q) : false)
      );
    });
  }, [items, sourceFilter, statusFilter, search]);

  const counts = useMemo(() => {
    const totals = { all: items.length, expense: 0, pagcorp: 0, success: 0, failed: 0, pending: 0 };
    for (const it of items) {
      totals[it.source]++;
      if (it.status === "success") totals.success++;
      else if (it.status === "failed") totals.failed++;
      else if (it.status === "pending") totals.pending++;
    }
    return totals;
  }, [items]);

  return (
    <div className="min-h-screen bg-background">
      <PageTitle title="Monitor de Integrações" />
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Activity className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h1 className="text-lg font-semibold">Monitor de Integrações</h1>
                <p className="text-xs text-muted-foreground">
                  {counts.all} registros • {counts.success} ok • {counts.failed} com erro • {counts.pending} pendentes
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchData(false)}
              disabled={refreshing}
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={sourceFilter} onValueChange={(v) => setSourceFilter(v as any)}>
            <TabsList>
              <TabsTrigger value="all">Todas ({counts.all})</TabsTrigger>
              <TabsTrigger value="expense" className="gap-1.5">
                <ShoppingCart className="w-3.5 h-3.5" /> Despesas ({counts.expense})
              </TabsTrigger>
              <TabsTrigger value="pagcorp" className="gap-1.5">
                <CreditCard className="w-3.5 h-3.5" /> PagCorp ({counts.pagcorp})
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="success">Sucesso</SelectItem>
              <SelectItem value="failed">Com erro</SelectItem>
              <SelectItem value="pending">Pendente</SelectItem>
              <SelectItem value="skipped">Não integrado</SelectItem>
            </SelectContent>
          </Select>

          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por fornecedor, ID, DocNum, usuário…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {/* Table */}
        <div className="border border-border rounded-xl bg-card overflow-hidden">
          {loading ? (
            <div className="py-20 flex items-center justify-center text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Carregando integrações…
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center text-muted-foreground">
              <Activity className="w-8 h-8 mb-2 opacity-50" />
              <p>Nenhuma integração encontrada para os filtros atuais.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[110px]">Origem</TableHead>
                  <TableHead>Referência</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Estágios SAP</TableHead>
                  <TableHead>SAP Doc</TableHead>
                  <TableHead className="w-[150px]">Integrado em</TableHead>
                  <TableHead className="w-[150px]">Último polling</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((it) => (
                  <TableRow
                    key={`${it.source}-${it.id}`}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => setSelected(it)}
                  >
                    <TableCell>
                      <Badge variant="outline" className="gap-1">
                        {it.source === "expense" ? (
                          <>
                            <ShoppingCart className="w-3 h-3" /> Despesa
                          </>
                        ) : (
                          <>
                            <CreditCard className="w-3 h-3" /> PagCorp
                          </>
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{it.external_ref}</TableCell>
                    <TableCell className="max-w-[280px] truncate">
                      <span className="text-sm">{it.description}</span>
                      {it.initiated_by && (
                        <div className="text-[11px] text-muted-foreground truncate">{it.initiated_by}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {formatCurrency(it.amount, it.currency || "BRL")}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={it.status} />
                    </TableCell>
                    <TableCell>
                      {it.source === "expense" ? (
                        <div className="flex items-center gap-1.5">
                          <StageBadge status={it.attachment_status ?? null} icon={Paperclip} label="Envio do anexo" />
                          <StageBadge status={it.purchase_order_status ?? null} icon={FileText} label="Pedido de Compra" />
                          <StageBadge status={it.attachment_link_status ?? null} icon={Link2} label="Vínculo do anexo" />
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">{it.integration_type || "—"}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {it.sap_doc_num ? (
                        <span className="font-mono">
                          #{it.sap_doc_num}
                          <span className="text-muted-foreground ml-1">({it.sap_doc_entry})</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(it.created_at)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {it.source === "expense"
                        ? (it.last_check_at ? formatDate(it.last_check_at) : "—")
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </main>

      {/* Detail dialog */}
      <Dialog open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selected?.source === "expense" ? (
                <ShoppingCart className="w-4 h-4" />
              ) : (
                <CreditCard className="w-4 h-4" />
              )}
              {selected?.source === "expense" ? "Despesa interna" : "PagCorp"} — {selected?.external_ref}
            </DialogTitle>
            <DialogDescription>
              Dados completos da integração com o SAP.
            </DialogDescription>
          </DialogHeader>

          {selected && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Status geral"><StatusBadge status={selected.status} /></Field>
                <Field label="Empresa">{selected.company_db || "—"}</Field>
                <Field label="Descrição">{selected.description}</Field>
                <Field label="Valor">{formatCurrency(selected.amount, selected.currency || "BRL")}</Field>
                <Field label="Iniciado por">{selected.initiated_by || "—"}</Field>
                <Field label="Última tentativa">{formatDate(selected.created_at)}</Field>
                <Field label="SAP DocEntry">{selected.sap_doc_entry ?? "—"}</Field>
                <Field label="SAP DocNum">{selected.sap_doc_num ?? "—"}</Field>
              </div>

              {selected.source === "expense" && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Estágios da integração SAP
                  </h3>
                  <div className="grid grid-cols-3 gap-2">
                    <StageCard
                      icon={Paperclip}
                      title="Envio do anexo"
                      status={selected.attachment_status ?? null}
                      hint={
                        selected.attachment_entry
                          ? `AbsoluteEntry: ${selected.attachment_entry}`
                          : "Nenhum anexo enviado"
                      }
                    />
                    <StageCard
                      icon={FileText}
                      title="Pedido de Compra"
                      status={selected.purchase_order_status ?? null}
                      hint={
                        selected.sap_doc_num
                          ? `DocNum #${selected.sap_doc_num}`
                          : "Não criado"
                      }
                    />
                    <StageCard
                      icon={Link2}
                      title="Vínculo do anexo"
                      status={selected.attachment_link_status ?? null}
                      hint={
                        selected.attachment_link_status === "success"
                          ? "Anexo vinculado ao PC"
                          : selected.attachment_link_status === "failed"
                            ? "Anexo enviado mas não vinculado"
                            : "Sem anexo para vincular"
                      }
                    />
                  </div>
                </div>
              )}

              {(selected.raw as any).sap_integration_error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                  <h3 className="text-xs font-medium text-destructive uppercase tracking-wide mb-1">
                    Erro de integração
                  </h3>
                  <pre className="text-xs whitespace-pre-wrap break-words text-destructive">
                    {String((selected.raw as any).sap_integration_error)}
                  </pre>
                </div>
              )}

              {(selected.raw as any).error_message && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                  <h3 className="text-xs font-medium text-destructive uppercase tracking-wide mb-1">
                    Mensagem de erro
                  </h3>
                  <pre className="text-xs whitespace-pre-wrap break-words text-destructive">
                    {String((selected.raw as any).error_message)}
                  </pre>
                </div>
              )}

              {selected.source === "pagcorp" && (
                <>
                  <PtaxBlock raw={selected.raw as any} />
                  <RawBlock title="Dados do PagCorp" data={(selected.raw as any).pagcorp_data} />
                  <RawBlock title="Payload enviado ao SAP" data={(selected.raw as any).sap_payload} />
                  <RawBlock title="Resposta do SAP" data={(selected.raw as any).sap_response} />
                </>
              )}

              {selected.source === "expense" && (
                <RawBlock title="Registro completo da despesa" data={selected.raw} />
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function StageCard({
  icon: Icon,
  title,
  status,
  hint,
}: {
  icon: typeof Paperclip;
  title: string;
  status: StageStatus;
  hint: string;
}) {
  const tone =
    status === "success"
      ? "border-success/30 bg-success/5"
      : status === "failed"
        ? "border-destructive/30 bg-destructive/5"
        : status === "pending"
          ? "border-warning/30 bg-warning/5"
          : "border-border bg-muted/30";
  return (
    <div className={`rounded-lg border p-3 ${tone}`}>
      <div className="flex items-center gap-1.5 text-xs font-medium mb-1">
        <Icon className="w-3.5 h-3.5" />
        {title}
      </div>
      <div className="text-[11px] capitalize text-muted-foreground">
        {status === "success" ? "Concluído" : status === "failed" ? "Falhou" : status === "pending" ? "Pendente" : "Não aplicável"}
      </div>
      <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>
    </div>
  );
}

function RawBlock({ title, data }: { title: string; data: unknown }) {
  if (!data) return null;
  return (
    <details className="rounded-lg border border-border bg-muted/30 p-3">
      <summary className="text-xs font-medium cursor-pointer text-muted-foreground uppercase tracking-wide">
        {title}
      </summary>
      <pre className="text-[11px] mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words">
        {JSON.stringify(data, null, 2)}
      </pre>
    </details>
  );
}

function PtaxBlock({ raw }: { raw: Record<string, unknown> }) {
  const rate = raw?.settlement_ptax_rate as number | null | undefined;
  const date = raw?.settlement_ptax_date as string | null | undefined;
  const source = raw?.settlement_ptax_source as string | null | undefined;
  if (!rate && !date && !source) return null;
  const rateFmt =
    typeof rate === "number" && Number.isFinite(rate)
      ? new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 6 }).format(rate)
      : "—";
  const dateFmt = date ? new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR") : "—";
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
      <h3 className="text-xs font-medium text-primary uppercase tracking-wide mb-2">
        Cotação PTAX aplicada na baixa
      </h3>
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">Cotação</div>
          <div className="font-mono tabular-nums">R$ {rateFmt}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">Data da cotação</div>
          <div>{dateFmt}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">Fonte</div>
          <div className="text-xs">{source || "—"}</div>
        </div>
      </div>
    </div>
  );
}
