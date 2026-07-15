import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { motion } from "framer-motion";
import {
  RefreshCw,
  Loader2,
  Search,
  ChevronDown,
  ChevronRight,
  Building2,
  DollarSign,
  ShieldAlert,
  Wallet,
  Clock,
  CheckCircle2,
  History,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useSap } from "@/contexts/SapContext";
import { supabase } from "@/integrations/supabase/client";
import { sapQueryAll } from "@/lib/sap-client";
import { getErpShortLabel } from "@/lib/erp-labels";
import { BaixaRecebimentoDialog, type BaixaInvoiceRow } from "@/components/BaixaRecebimentoDialog";

/* ─────────────────────────── helpers ─────────────────────────── */

function formatCurrency(value: number, currency: string = "BRL") {
  const valid = /^[A-Z]{3}$/.test(currency) ? currency : "BRL";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: valid }).format(value || 0);
}

function formatDate(dateStr?: string | null) {
  if (!dateStr) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  try {
    return new Intl.DateTimeFormat("pt-BR").format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

/* ─────────────────────────── types ─────────────────────────── */

interface SapInvoice {
  DocEntry: number;
  DocNum: number;
  CardCode: string;
  CardName: string;
  DocDate: string;
  DocDueDate: string | null;
  DocTotal: number;
  PaidToDate: number;
  DocumentStatus: string; // bost_Open | bost_Close
  DocCurrency: string;
  Cancelled: string;
}

interface InvoiceRow {
  docEntry: number;
  docNum: number;
  cardCode: string;
  cardName: string;
  docDate: string;
  docDueDate: string | null;
  docTotal: number;
  paidToDate: number;
  pendingBaixa: number;   // valor já lançado no Supabase e ainda não sincronizado
  saldoResidual: number;  // DocTotal - PaidToDate - pendingBaixa
  status: string;         // Aberto | Fechado | Cancelado
  currency: string;
  origem: "erp_flow" | "erp";
  isOpen: boolean;
}

interface ClientGroup {
  cardCode: string;
  cardName: string;
  rows: InvoiceRow[];
  totalSaldo: number;
  totalDocs: number;
  qtdAbertas: number;
}

/* ─────────────────────────── Page ─────────────────────────── */

export default function SalesPage() {
  const { session } = useSap();
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [erroMsg, setErroMsg] = useState<string | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set()); // set of docEntry
  const [baixaOpen, setBaixaOpen] = useState(false);
  const fetchTokenRef = useRef(0);

  const isSap = session?.erpType === "sap";
  const companyDb = session?.companyDB || null;
  const erpLabel = getErpShortLabel(session?.erpType);

  /* ── data fetch ─────────────────────────────────────── */

  const loadInvoices = useCallback(
    async (force = false) => {
      if (!session || !isSap || !companyDb) {
        setInvoices([]);
        return;
      }
      const token = ++fetchTokenRef.current;
      setLoading(true);
      setErroMsg(null);
      try {
        // 1) Fetch invoices from SAP (last 12 months, not cancelled)
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - 12);
        const cutoffIso = cutoff.toISOString().slice(0, 10);
        const params: Record<string, string> = {
          $select:
            "DocEntry,DocNum,CardCode,CardName,DocDate,DocDueDate,DocTotal,PaidToDate,DocumentStatus,DocCurrency,Cancelled",
          $filter: `DocDate ge '${cutoffIso}' and Cancelled ne 'tYES'`,
          $orderby: "DocDate desc",
        };
        const { data } = await sapQueryAll(session, "Invoices", params, !force);
        if (fetchTokenRef.current !== token) return;
        const rawList = ((data?.value as SapInvoice[]) || []).filter(Boolean);

        // 2) Cross-reference pedidos_venda_erp (origem)
        const docEntries = rawList.map((r) => r.DocEntry).filter((n) => Number.isFinite(n));
        const [pedidosRes, baixasRes] = await Promise.all([
          docEntries.length
            ? supabase
                .from("pedidos_venda_erp")
                .select("doc_entry")
                .eq("company_db", companyDb)
                .in("doc_entry", docEntries)
            : Promise.resolve({ data: [] as { doc_entry: number }[], error: null }),
          // 3) Pending baixas (not yet synced) for this company_db,
          //    aggregated by invoice_doc_entry.
          supabase
            .from("baixas_recebimento_itens")
            .select("invoice_doc_entry,valor_baixado,baixas_recebimento!inner(company_db,status)")
            .eq("baixas_recebimento.company_db", companyDb)
            .eq("baixas_recebimento.status", "pendente_sincronizacao"),
        ]);

        if (pedidosRes.error) console.warn("pedidos_venda_erp:", pedidosRes.error.message);
        if (baixasRes.error) console.warn("baixas_recebimento:", baixasRes.error.message);

        const erpFlowSet = new Set(
          (pedidosRes.data || []).map((r) => Number((r as { doc_entry: number }).doc_entry)),
        );
        const pendingByDocEntry = new Map<number, number>();
        for (const b of (baixasRes.data || []) as {
          invoice_doc_entry: number;
          valor_baixado: number;
        }[]) {
          const key = Number(b.invoice_doc_entry);
          pendingByDocEntry.set(
            key,
            (pendingByDocEntry.get(key) || 0) + Number(b.valor_baixado || 0),
          );
        }

        // 4) Map to InvoiceRow
        const rows: InvoiceRow[] = rawList.map((inv) => {
          const paid = Number(inv.PaidToDate || 0);
          const total = Number(inv.DocTotal || 0);
          const pending = pendingByDocEntry.get(inv.DocEntry) || 0;
          const saldo = Math.max(0, +(total - paid - pending).toFixed(2));
          const cancelled = inv.Cancelled === "tYES";
          const closed = inv.DocumentStatus === "bost_Close";
          return {
            docEntry: inv.DocEntry,
            docNum: inv.DocNum,
            cardCode: inv.CardCode || "—",
            cardName: inv.CardName || "—",
            docDate: inv.DocDate,
            docDueDate: inv.DocDueDate,
            docTotal: total,
            paidToDate: paid,
            pendingBaixa: pending,
            saldoResidual: saldo,
            status: cancelled ? "Cancelado" : closed ? "Fechado" : "Aberto",
            currency: inv.DocCurrency || "BRL",
            origem: erpFlowSet.has(inv.DocEntry) ? "erp_flow" : "erp",
            isOpen: !cancelled && !closed,
          };
        });
        setInvoices(rows);
      } catch (e) {
        console.error("Sales load error:", e);
        setErroMsg((e as Error).message || "Falha ao carregar NFs de venda");
      } finally {
        if (fetchTokenRef.current === token) setLoading(false);
      }
    },
    [session, isSap, companyDb],
  );

  useEffect(() => {
    if (session && isSap) void loadInvoices(false);
  }, [session, isSap, loadInvoices]);

  /* ── grouping & filters ─────────────────────────────── */

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter((r) => {
      if (onlyOpen && r.saldoResidual <= 0) return false;
      if (!q) return true;
      return (
        r.cardName.toLowerCase().includes(q) ||
        r.cardCode.toLowerCase().includes(q) ||
        String(r.docNum).includes(q)
      );
    });
  }, [invoices, onlyOpen, search]);

  const groups: ClientGroup[] = useMemo(() => {
    const map = new Map<string, ClientGroup>();
    for (const r of filtered) {
      const key = r.cardCode;
      let g = map.get(key);
      if (!g) {
        g = {
          cardCode: r.cardCode,
          cardName: r.cardName,
          rows: [],
          totalSaldo: 0,
          totalDocs: 0,
          qtdAbertas: 0,
        };
        map.set(key, g);
      }
      g.rows.push(r);
      g.totalDocs += 1;
      g.totalSaldo += r.saldoResidual;
      if (r.saldoResidual > 0) g.qtdAbertas += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.totalSaldo - a.totalSaldo);
  }, [filtered]);

  /* ── selection ──────────────────────────────────────── */

  const selectionRows = useMemo(
    () => invoices.filter((r) => selected.has(r.docEntry)),
    [invoices, selected],
  );

  // Regra de negócio: 1 cliente por baixa. Bloqueia mistura.
  const selectionCardCode = selectionRows[0]?.cardCode || null;
  const selectionTotal = selectionRows.reduce((s, r) => s + r.saldoResidual, 0);

  const toggleRow = useCallback(
    (r: InvoiceRow, checked: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (checked) {
          if (selectionCardCode && selectionCardCode !== r.cardCode) {
            toast.error("Uma baixa deve conter NFs de um único cliente. Limpe a seleção antes.");
            return prev;
          }
          next.add(r.docEntry);
        } else {
          next.delete(r.docEntry);
        }
        return next;
      });
    },
    [selectionCardCode],
  );

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const toggleGroup = (code: string) =>
    setCollapsed((prev) => ({ ...prev, [code]: !prev[code] }));

  /* ── render guards ──────────────────────────────────── */

  if (!session) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-3">
          <ShieldAlert className="w-10 h-10 mx-auto text-muted-foreground" />
          <h1 className="text-xl font-semibold">Sessão do ERP necessária</h1>
          <p className="text-sm text-muted-foreground">
            Faça login no ERP para visualizar as NFs de venda.
          </p>
        </div>
      </div>
    );
  }

  if (!isSap) {
    return (
      <div className="min-h-screen bg-background text-foreground p-6">
        <div className="max-w-2xl mx-auto rounded-lg border border-border p-6 space-y-2">
          <h1 className="text-lg font-semibold">Vendas</h1>
          <p className="text-sm text-muted-foreground">
            O módulo de Vendas com saldo residual está disponível apenas para bases SAP no momento.
            (Sessão atual: <strong>{erpLabel}</strong>)
          </p>
        </div>
      </div>
    );
  }

  /* ── UI ─────────────────────────────────────────────── */

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Helmet>
        <title>Vendas — NFs de venda por cliente</title>
      </Helmet>

      <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-4">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <div>
            <h1 className="text-2xl font-bold">Vendas — NFs de venda</h1>
            <p className="text-xs text-muted-foreground">
              Base: <span className="font-mono">{companyDb}</span> · agrupado por cliente com saldo residual em tempo real.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="gap-1.5">
              <Link to="/vendas/historico">
                <History className="w-3.5 h-3.5" />
                Histórico de baixas
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadInvoices(true)}
              disabled={loading}
              className="gap-1.5"
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Atualizar
            </Button>
          </div>
        </motion.div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-muted/20 p-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por cliente, código ou nº da NF"
              className="pl-8 h-9 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="onlyOpen" checked={onlyOpen} onCheckedChange={setOnlyOpen} />
            <Label htmlFor="onlyOpen" className="text-sm cursor-pointer">
              Somente com saldo em aberto
            </Label>
          </div>
          <div className="ml-auto text-xs text-muted-foreground">
            {filtered.length} NF(s) · {groups.length} cliente(s)
          </div>
        </div>

        {/* Selection bar */}
        {selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3"
          >
            <div className="flex items-center gap-2 text-sm">
              <Wallet className="w-4 h-4 text-primary" />
              <span>
                <strong>{selected.size}</strong> NF(s) de <strong>{selectionRows[0]?.cardName || "—"}</strong>
                {" · Saldo selecionado: "}
                <strong className="font-mono">
                  {formatCurrency(selectionTotal, selectionRows[0]?.currency)}
                </strong>
              </span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={clearSelection}>
                Limpar
              </Button>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => setBaixaOpen(true)}
              >
                <DollarSign className="w-3.5 h-3.5" />
                Dar baixa ({selected.size})
              </Button>
            </div>
          </motion.div>
        )}

        {/* Error */}
        {erroMsg && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {erroMsg}
          </div>
        )}

        {/* List */}
        {loading && invoices.length === 0 ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : groups.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Nenhuma NF encontrada com os filtros atuais.
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => {
              const isCollapsed = collapsed[g.cardCode];
              return (
                <div key={g.cardCode} className="rounded-lg border border-border overflow-hidden bg-card">
                  <button
                    type="button"
                    onClick={() => toggleGroup(g.cardCode)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                    )}
                    <Building2 className="w-4 h-4 text-primary/70 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{g.cardName}</p>
                      <p className="text-[11px] text-muted-foreground font-mono truncate">
                        {g.cardCode} · {g.totalDocs} doc(s) · {g.qtdAbertas} em aberto
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Saldo do cliente</p>
                      <p className="font-mono font-semibold text-sm">
                        {formatCurrency(g.totalSaldo, g.rows[0]?.currency)}
                      </p>
                    </div>
                  </button>

                  {!isCollapsed && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border/60 text-muted-foreground">
                            <th className="w-8 py-2 px-2"></th>
                            <th className="text-left py-2 px-2">Nº NF</th>
                            <th className="text-left py-2 px-2">Emissão</th>
                            <th className="text-left py-2 px-2">Vencimento</th>
                            <th className="text-right py-2 px-2">Valor total</th>
                            <th className="text-right py-2 px-2">Pago</th>
                            <th className="text-right py-2 px-2">Saldo residual</th>
                            <th className="text-left py-2 px-2">Status</th>
                            <th className="text-left py-2 px-2">Origem</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.rows.map((r) => {
                            const canSelect = r.saldoResidual > 0;
                            const isSelected = selected.has(r.docEntry);
                            const rowClash =
                              selectionCardCode && selectionCardCode !== r.cardCode;
                            return (
                              <tr
                                key={r.docEntry}
                                className={`border-b border-border/40 hover:bg-muted/20 transition-colors ${
                                  isSelected ? "bg-primary/5" : ""
                                }`}
                              >
                                <td className="py-2 px-2">
                                  {canSelect ? (
                                    <Checkbox
                                      checked={isSelected}
                                      onCheckedChange={(v) => toggleRow(r, !!v)}
                                      disabled={!!rowClash && !isSelected}
                                      aria-label={`Selecionar NF ${r.docNum}`}
                                    />
                                  ) : (
                                    <CheckCircle2
                                      className="w-3.5 h-3.5 text-muted-foreground/50"
                                      aria-label="Sem saldo"
                                    />
                                  )}
                                </td>
                                <td className="py-2 px-2 font-mono">{r.docNum}</td>
                                <td className="py-2 px-2">{formatDate(r.docDate)}</td>
                                <td className="py-2 px-2">{formatDate(r.docDueDate)}</td>
                                <td className="py-2 px-2 text-right font-mono">
                                  {formatCurrency(r.docTotal, r.currency)}
                                </td>
                                <td className="py-2 px-2 text-right font-mono text-muted-foreground">
                                  {formatCurrency(r.paidToDate, r.currency)}
                                </td>
                                <td className="py-2 px-2 text-right font-mono font-semibold">
                                  <div className="inline-flex items-center gap-1 justify-end">
                                    {r.pendingBaixa > 0 && (
                                      <Clock
                                        className="w-3 h-3 text-amber-500"
                                        aria-label={`Baixa pendente de sincronização: ${formatCurrency(r.pendingBaixa, r.currency)}`}
                                      />
                                    )}
                                    <span
                                      className={
                                        r.saldoResidual > 0 ? "text-foreground" : "text-muted-foreground"
                                      }
                                    >
                                      {formatCurrency(r.saldoResidual, r.currency)}
                                    </span>
                                  </div>
                                </td>
                                <td className="py-2 px-2">
                                  <Badge
                                    variant="outline"
                                    className={
                                      r.status === "Aberto"
                                        ? "border-primary/40 text-primary text-[10px]"
                                        : r.status === "Fechado"
                                          ? "border-emerald-500/40 text-emerald-500 text-[10px]"
                                          : "border-destructive/40 text-destructive text-[10px]"
                                    }
                                  >
                                    {r.status}
                                  </Badge>
                                </td>
                                <td className="py-2 px-2">
                                  {r.origem === "erp_flow" ? (
                                    <Badge variant="outline" className="border-primary/40 text-primary text-[10px]">
                                      ERP Flow
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline" className="border-amber-500/40 text-amber-500 text-[10px]">
                                      {erpLabel || "SAP"}
                                    </Badge>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <BaixaRecebimentoDialog
        open={baixaOpen}
        onClose={() => setBaixaOpen(false)}
        invoices={selectionRows.map<BaixaInvoiceRow>((r) => ({
          docEntry: r.docEntry,
          docNum: r.docNum,
          cardCode: r.cardCode,
          cardName: r.cardName,
          currency: r.currency,
          saldoResidual: r.saldoResidual,
        }))}
        onSuccess={() => {
          clearSelection();
          void loadInvoices(true);
        }}
      />
    </div>
  );
}
