import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Receipt,
  Network,
} from "lucide-react";
import { SalesRelationsMap } from "@/components/SalesRelationsMap";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useModuleAccess } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useSap } from "@/contexts/SapContext";
import { useCompanies } from "@/hooks/useCompanies";
import { supabase } from "@/integrations/supabase/client";
import { sapQueryAll } from "@/lib/sap-client";
import { publicFunctionFetch } from "@/lib/auth-fetch";
import { getErpShortLabel } from "@/lib/erp-labels";
import { BaixaRecebimentoDialog, type BaixaInvoiceRow } from "@/components/BaixaRecebimentoDialog";
import { PageHeader } from "@/components/PageHeader";

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
  FolioNumber: number | null;
  FolioPrefixString: string | null;
  SeriesString: string | null;
  SequenceSerial?: string | number | null;
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
  /** Número da NFSE / folio fiscal, priorizando campos brasileiros do SAP. */
  folioNumber: number | null;
  nfseNumber: string | null;
  /** Prefixo/tipo da NFSE (SAP FolioPrefixString), ex.: NFSe_CAC. */
  folioPrefix: string | null;
  /** Série da NFSE (SAP SeriesString), ex.: 1. */
  folioSeries: string | null;
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
  /** Tipo do documento no SAP: NF de venda ('invoice') ou Saldo Inicial via JE ('journal_entry'). */
  docType: "invoice" | "journal_entry";
  /** Linha do JournalEntry (apenas quando docType='journal_entry'). */
  docLine?: number | null;
}

interface ClientGroup {
  cardCode: string;
  cardName: string;
  rows: InvoiceRow[];
  totalSaldo: number;
  totalDocs: number;
  qtdAbertas: number;
}

function cleanSapText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text && text !== "0" ? text : null;
}

function formatNfseLabel(row: Pick<InvoiceRow, "nfseNumber" | "folioPrefix" | "folioSeries">) {
  if (!row.nfseNumber) return null;
  return `NFS-e ${row.folioPrefix ? `${row.folioPrefix} ` : ""}${row.nfseNumber}${row.folioSeries ? ` · Série ${row.folioSeries}` : ""}`;
}

/**
 * Busca o número REAL da NFS-e (autorizado pela prefeitura) no addon fiscal.
 * O Service Layer só expõe o número do RPS (`SequenceSerial`), por isso a
 * consulta é feita na edge function `sap-nfse-lookup`. Falhas são silenciosas:
 * a tela continua exibindo o número do RPS como fallback.
 */
async function fetchNfseMap(
  companyDb: string,
  docEntries: number[],
): Promise<Record<string, { nfse: string | null; rps: string | null; serie: string | null }>> {
  if (!companyDb || docEntries.length === 0) return {};
  try {
    const resp = await publicFunctionFetch("sap-nfse-lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_db: companyDb, doc_entries: docEntries }),
    });
    if (!resp.ok) return {};
    const json = await resp.json().catch(() => null);
    return (json?.map ?? {}) as Record<string, { nfse: string | null; rps: string | null; serie: string | null }>;
  } catch (e) {
    console.warn("sap-nfse-lookup indisponível:", (e as Error).message);
    return {};
  }
}

/* ─────────────────────────── Page ─────────────────────────── */

export default function SalesPage() {
  const { session } = useSap();
  const { hasAccess, loading } = useModuleAccess("sales");
  if (!session) return <Navigate to="/" replace />;
  if (loading) return null;
  if (!hasAccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="text-center">
          <p className="text-lg font-semibold text-foreground">Sem acesso ao módulo Vendas</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Este módulo é restrito ao time de Contas a Receber. Solicite ao administrador o módulo <code>sales</code>.
          </p>
          <Link to="/" className="mt-4 inline-block text-sm text-primary hover:underline">
            Voltar ao menu
          </Link>
        </div>
      </div>
    );
  }
  return <SalesPageInner />;
}

function SalesPageInner() {
  const { session, logout } = useSap();
  const navigate = useNavigate();
  const { getLabel } = useCompanies();
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [erroMsg, setErroMsg] = useState<string | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set()); // set de row keys (docType:docEntry:docLine)
  const [baixaOpen, setBaixaOpen] = useState(false);
  const [mapInvoice, setMapInvoice] = useState<InvoiceRow | null>(null);
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
        const invoiceParams: Record<string, string> = {
          $select:
            "DocEntry,DocNum,SequenceSerial,FolioNumber,FolioPrefixString,SeriesString,CardCode,CardName,DocDate,DocDueDate,DocTotal,PaidToDate,DocumentStatus,DocCurrency,Cancelled",
          $filter: `DocDate ge '${cutoffIso}' and Cancelled ne 'tYES'`,
          $orderby: "DocDate desc",
        };

        // 1b) Fetch open opening balances (Saldo Inicial) as JournalEntries
        //     marcados com TransactionCode = 'SI' (ou Reference = 'SI' como fallback).
        //     Só interessam as linhas com ShortName = CardCode e saldo em aberto.
        const jeParams: Record<string, string> = {
          $select: "JdtNum,ReferenceDate,DueDate,Memo,Reference,TransactionCode,JournalEntryLines",
          $filter: "TransactionCode eq 'SI' or Reference eq 'SI'",
          $expand: "JournalEntryLines",
          $orderby: "ReferenceDate desc",
        };

        const [invRes, jeRes] = await Promise.all([
          sapQueryAll(session, "Invoices", invoiceParams, !force),
          sapQueryAll(session, "JournalEntries", jeParams, !force).catch((e) => {
            console.warn("SI JournalEntries fetch failed:", (e as Error).message);
            return { data: { value: [] } };
          }),
        ]);
        if (fetchTokenRef.current !== token) return;
        const rawList = ((invRes.data?.value as SapInvoice[]) || []).filter(Boolean);

        // Build cross-references
        const docEntries = rawList.map((r) => r.DocEntry).filter((n) => Number.isFinite(n));
        const [pedidosRes, baixasRes, bpNamesRes] = await Promise.all([
          docEntries.length
            ? supabase
                .from("pedidos_venda_erp")
                .select("doc_entry")
                .eq("company_db", companyDb)
                .in("doc_entry", docEntries)
            : Promise.resolve({ data: [] as { doc_entry: number }[], error: null }),
          // Pending baixas (not yet synced) for this company_db,
          // por tipo/DocEntry/DocLine.
          supabase
            .from("baixas_recebimento_itens")
            .select("invoice_doc_entry,invoice_type,invoice_doc_line,valor_baixado,baixas_recebimento!inner(company_db,status)")
            .eq("baixas_recebimento.company_db", companyDb)
            .eq("baixas_recebimento.status", "pendente_sincronizacao"),
          Promise.resolve({ data: [] as { CardCode: string; CardName: string }[] }),
        ]);

        if (pedidosRes.error) console.warn("pedidos_venda_erp:", pedidosRes.error.message);
        if (baixasRes.error) console.warn("baixas_recebimento:", baixasRes.error.message);

        const erpFlowSet = new Set(
          (pedidosRes.data || []).map((r) => Number((r as { doc_entry: number }).doc_entry)),
        );
        // key = `${type}:${docEntry}:${docLine ?? 0}`
        const pendingByKey = new Map<string, number>();
        for (const b of (baixasRes.data || []) as Array<{
          invoice_doc_entry: number;
          invoice_type?: string | null;
          invoice_doc_line?: number | null;
          valor_baixado: number;
        }>) {
          const type = (b.invoice_type || "invoice") === "journal_entry" ? "journal_entry" : "invoice";
          const line = type === "journal_entry" ? Number(b.invoice_doc_line || 0) : 0;
          const key = `${type}:${Number(b.invoice_doc_entry)}:${line}`;
          pendingByKey.set(key, (pendingByKey.get(key) || 0) + Number(b.valor_baixado || 0));
        }

        // 4) Map invoices to InvoiceRow
        const invoiceRows: InvoiceRow[] = rawList.map((inv) => {
          const paid = Number(inv.PaidToDate || 0);
          const total = Number(inv.DocTotal || 0);
          const pending = pendingByKey.get(`invoice:${inv.DocEntry}:0`) || 0;
          const saldo = Math.max(0, +(total - paid - pending).toFixed(2));
          const cancelled = inv.Cancelled === "tYES";
          const closed = inv.DocumentStatus === "bost_Close";
          const folioNumber = inv.FolioNumber != null ? Number(inv.FolioNumber) : null;
          const sequenceSerial = cleanSapText(inv.SequenceSerial);
          const nfseNumber = sequenceSerial || (folioNumber != null ? String(folioNumber) : null);
          return {
            docEntry: inv.DocEntry,
            docNum: inv.DocNum,
            folioNumber,
            nfseNumber,
            folioPrefix: cleanSapText(inv.FolioPrefixString),
            folioSeries: cleanSapText(inv.SeriesString),
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
            docType: "invoice",
            docLine: null,
          };
        });

        // 5) Map opening-balance journal entry lines to InvoiceRow (docType='journal_entry')
        type JELine = {
          Line_ID?: number;
          LineNum?: number;
          ShortName?: string;
          AccountCode?: string;
          Debit?: number;
          Credit?: number;
          BalanceDueDebit?: number;
          BalanceDueCredit?: number;
          LineMemo?: string;
          DueDate?: string | null;
          FCCurrency?: string | null;
        };
        type JEDoc = {
          JdtNum?: number;
          ReferenceDate?: string;
          DueDate?: string | null;
          Memo?: string | null;
          Reference?: string | null;
          TransactionCode?: string | null;
          JournalEntryLines?: JELine[];
        };
        const jeList = ((jeRes.data?.value as JEDoc[]) || []).filter(Boolean);
        const siRows: InvoiceRow[] = [];
        for (const je of jeList) {
          const jdt = Number(je.JdtNum || 0);
          if (!jdt) continue;
          const lines = Array.isArray(je.JournalEntryLines) ? je.JournalEntryLines : [];
          for (const ln of lines) {
            const cardCode = (ln.ShortName || "").trim();
            // Só linhas de BP (CardCode não numérico "puro" de conta contábil).
            // Regra prática: ShortName com letras costuma ser BP; conta contábil só tem números/pontos.
            if (!cardCode || /^[\d.]+$/.test(cardCode)) continue;
            const debit = Number(ln.Debit || 0);
            const credit = Number(ln.Credit || 0);
            const balDeb = Number(ln.BalanceDueDebit || 0);
            // saldo aberto do cliente: usamos BalanceDueDebit quando disponível;
            // se não vier, caímos para Debit-Credit (só se sobrar débito).
            const total = debit > 0 ? debit : Math.max(0, debit - credit);
            const openRaw = balDeb > 0 ? balDeb : total;
            if (openRaw <= 0.001) continue;
            const lineNum = Number(ln.Line_ID ?? ln.LineNum ?? 0);
            const key = `journal_entry:${jdt}:${lineNum}`;
            const pending = pendingByKey.get(key) || 0;
            const saldo = Math.max(0, +(openRaw - pending).toFixed(2));
            siRows.push({
              docEntry: jdt,
              docNum: jdt,
              folioNumber: null,
              nfseNumber: null,
              folioPrefix: null,
              folioSeries: null,
              cardCode,
              cardName: cardCode, // preenchido a partir das NFs abaixo, se houver
              docDate: je.ReferenceDate || "",
              docDueDate: ln.DueDate || je.DueDate || null,
              docTotal: total,
              paidToDate: Math.max(0, total - openRaw),
              pendingBaixa: pending,
              saldoResidual: saldo,
              status: saldo > 0 ? "Aberto" : "Fechado",
              currency: (ln.FCCurrency || "BRL") as string,
              origem: "erp",
              isOpen: saldo > 0,
              docType: "journal_entry",
              docLine: lineNum,
            });
          }
        }

        // Reaproveita CardName vindo das NFs para preencher SI (BP sem NF ficará com CardCode).
        const nameByCode = new Map<string, string>();
        for (const r of invoiceRows) {
          if (r.cardCode && r.cardName && !nameByCode.has(r.cardCode)) nameByCode.set(r.cardCode, r.cardName);
        }
        for (const r of siRows) {
          const nm = nameByCode.get(r.cardCode);
          if (nm) r.cardName = nm;
        }

        setInvoices([...invoiceRows, ...siRows]);
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
        String(r.docNum).includes(q) ||
        (r.nfseNumber ? r.nfseNumber.toLowerCase().includes(q) : false) ||
        (r.folioPrefix ? r.folioPrefix.toLowerCase().includes(q) : false)
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

  const rowKey = (r: InvoiceRow) => `${r.docType}:${r.docEntry}:${r.docLine ?? 0}`;

  const selectionRows = useMemo(
    () => invoices.filter((r) => selected.has(rowKey(r))),
    [invoices, selected],
  );

  // Regra de negócio: 1 cliente por baixa. Bloqueia mistura.
  const selectionCardCode = selectionRows[0]?.cardCode || null;
  const selectionTotal = selectionRows.reduce((s, r) => s + r.saldoResidual, 0);

  const toggleRow = useCallback(
    (r: InvoiceRow, checked: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev);
        const k = `${r.docType}:${r.docEntry}:${r.docLine ?? 0}`;
        if (checked) {
          if (selectionCardCode && selectionCardCode !== r.cardCode) {
            toast.error("A baixa deve conter documentos de um único cliente. Limpe a seleção antes.");
            return prev;
          }
          next.add(k);
        } else {
          next.delete(k);
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
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <PageHeader
        icon={<Receipt className="w-5 h-5 text-primary" />}
        title="Vendas"
        titleAccent="NFs de venda"
        subtitle="Agrupado por cliente com saldo residual em tempo real"
        companyLabel={getLabel(session?.companyDB || "")}
        userName={session?.userName}
        onLogout={logout}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/vendas/historico")}
              className="gap-2"
            >
              <History className="w-4 h-4" /> Histórico de baixas
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadInvoices(true)}
              disabled={loading}
              className="gap-2"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Atualizar
            </Button>
          </>
        }
      />

      <div className="max-w-7xl mx-auto w-full p-4 sm:p-6 space-y-4">
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-xs text-muted-foreground"
        >
          Base: <span className="font-mono">{companyDb}</span> · ERP: {erpLabel}
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
                            <th className="w-8 py-2 px-2"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.rows.map((r) => {
                            const rk = rowKey(r);
                            const canSelect = r.saldoResidual > 0;
                            const isSelected = selected.has(rk);
                            const rowClash =
                              selectionCardCode && selectionCardCode !== r.cardCode;
                            const isSI = r.docType === "journal_entry";
                            const nfseLabel = formatNfseLabel(r);
                            return (
                              <tr
                                key={rk}
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
                                      aria-label={`Selecionar ${isSI ? "SI" : "NF"} ${r.docNum}`}
                                    />
                                  ) : (
                                    <CheckCircle2
                                      className="w-3.5 h-3.5 text-muted-foreground/50"
                                      aria-label="Sem saldo"
                                    />
                                  )}
                                </td>
                                <td className="py-2 px-2 font-mono">
                                  {isSI ? (
                                    <span className="inline-flex items-center gap-1">
                                      <Badge
                                        variant="outline"
                                        className="border-amber-500/40 text-amber-500 text-[9px] px-1 py-0"
                                        title="Saldo Inicial (Lançamento contábil)"
                                      >
                                        SI
                                      </Badge>
                                      {r.docNum}
                                    </span>
                                  ) : (
                                    <div className="flex flex-col leading-tight">
                                      <span title="DocEntry / DocNum no SAP">{r.docNum}</span>
                                      {nfseLabel ? (
                                        <span
                                          className="text-[10px] text-muted-foreground"
                                          title={nfseLabel}
                                        >
                                          {nfseLabel}
                                        </span>
                                      ) : (
                                        <span className="text-[10px] text-muted-foreground/60">
                                          Sem NFS-e vinculada
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </td>
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
                                  {isSI ? (
                                    <Badge variant="outline" className="border-amber-500/40 text-amber-500 text-[10px]">
                                      SI
                                    </Badge>
                                  ) : r.origem === "erp_flow" ? (
                                    <Badge variant="outline" className="border-primary/40 text-primary text-[10px]">
                                      ERP Flow
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline" className="border-amber-500/40 text-amber-500 text-[10px]">
                                      {erpLabel || "SAP"}
                                    </Badge>
                                  )}
                                </td>
                                <td className="py-2 px-2 text-right">
                                  {isSI ? (
                                    <span className="inline-block w-7" />
                                  ) : (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-7 w-7"
                                      onClick={() => setMapInvoice(r)}
                                      aria-label={`Ver mapa de relações da NF ${r.docNum}`}
                                      title="Mapa de relações"
                                    >
                                      <Network className="w-3.5 h-3.5 text-muted-foreground" />
                                    </Button>
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
          folioNumber: r.folioNumber,
          cardCode: r.cardCode,
          cardName: r.cardName,
          currency: r.currency,
          saldoResidual: r.saldoResidual,
          docType: r.docType,
          docLine: r.docLine,
        }))}
        onSuccess={() => {
          clearSelection();
          void loadInvoices(true);
        }}
      />

      <SalesRelationsMap
        open={!!mapInvoice}
        onClose={() => setMapInvoice(null)}
        session={session}
        invoice={mapInvoice}
      />
    </div>
  );
}
