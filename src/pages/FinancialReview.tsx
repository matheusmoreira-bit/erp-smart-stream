import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  RefreshCw,
  Search,
  Wallet,
  Link2,
  Ban,
  Info,
  Building2,
  CheckCircle2,
  AlertCircle,
  FileDown,
  FileText,
} from "lucide-react";
import { useSap } from "@/contexts/SapContext";
import { useFinancialReview, type AdvanceItem, type OpenInvoice } from "@/hooks/useFinancialReview";
import { logAuditAction } from "@/hooks/useAuditLog";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { FileSignature, ArrowRight } from "lucide-react";

const TYPE_LABEL: Record<AdvanceItem["doc_type"], string> = {
  ADVANCE_AP: "Adiant. Fornecedor (NF)",
  ADVANCE_AR: "Adiant. Cliente (NF)",
  PAYMENT_OA_OUT: "Pagamento on-account (saída)",
  PAYMENT_OA_IN: "Recebimento on-account (entrada)",
};

const TYPE_VARIANT: Record<AdvanceItem["doc_type"], "default" | "secondary" | "outline"> = {
  ADVANCE_AP: "default",
  ADVANCE_AR: "secondary",
  PAYMENT_OA_OUT: "outline",
  PAYMENT_OA_IN: "outline",
};

function formatMoney(v: number, currency: string) {
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currency || "BRL",
    }).format(v);
  } catch {
    return v.toFixed(2);
  }
}

function formatDate(d: string | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("pt-BR");
  } catch {
    return d;
  }
}

export default function FinancialReview() {
  const navigate = useNavigate();
  const { session } = useSap();
  const companyDb = session?.companyDB;
  const userEmail = session?.userName;
  const { items, loading, error, refresh, listOpenInvoices, cancelPayment, autoLink } =
    useFinancialReview(companyDb);

  const [search, setSearch] = useState("");
  const [bpFilter, setBpFilter] = useState<"all" | "supplier" | "customer">("all");
  const [typeFilter, setTypeFilter] = useState<"all" | AdvanceItem["doc_type"]>("all");
  const [selected, setSelected] = useState<AdvanceItem | null>(null);

  useEffect(() => {
    if (companyDb) {
      refresh();
      logAuditAction({
        action: "view",
        entity_type: "financial_review",
        actor_email: userEmail,
        company_db: companyDb,
      });
    }
  }, [companyDb, refresh, userEmail]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (bpFilter !== "all" && i.bp_type !== bpFilter) return false;
      if (typeFilter !== "all" && i.doc_type !== typeFilter) return false;
      if (!q) return true;
      return (
        i.card_code.toLowerCase().includes(q) ||
        i.card_name.toLowerCase().includes(q) ||
        String(i.doc_num ?? "").includes(q) ||
        (i.reference ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, search, bpFilter, typeFilter]);

  const totals = useMemo(() => {
    const supplier = filtered.filter((i) => i.bp_type === "supplier");
    const customer = filtered.filter((i) => i.bp_type === "customer");
    const sum = (arr: AdvanceItem[]) =>
      arr.reduce((acc, i) => acc + (i.open_amount || 0), 0);
    return {
      total: filtered.length,
      supplierCount: supplier.length,
      supplierSum: sum(supplier),
      customerCount: customer.length,
      customerSum: sum(customer),
    };
  }, [filtered]);

  const linkStatus = (it: AdvanceItem) =>
    it.doc_type.startsWith("PAYMENT_OA") ? "Sem vínculo (on-account)" : "Adiant. sem NF final";

  const exportCsv = () => {
    const header = [
      "Tipo",
      "Doc",
      "CardCode",
      "Parceiro",
      "Tipo Parceiro",
      "Data",
      "Moeda",
      "Valor Total",
      "Pago",
      "Em Aberto",
      "Referência",
      "Status Vínculo",
      "Observações",
    ];
    const rows = filtered.map((i) => [
      TYPE_LABEL[i.doc_type],
      i.doc_num ?? i.doc_entry,
      i.card_code,
      i.card_name,
      i.bp_type === "supplier" ? "Fornecedor" : "Cliente",
      i.doc_date ?? "",
      i.doc_currency,
      i.doc_total,
      i.paid_to_date,
      i.open_amount,
      i.reference ?? "",
      linkStatus(i),
      (i.remarks ?? "").replace(/[\r\n]+/g, " "),
    ]);
    const escape = (v: unknown) => {
      const s = String(v ?? "");
      return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = "\uFEFF" + [header, ...rows].map((r) => r.map(escape).join(";")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `avaliacao-financeira-${companyDb}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    logAuditAction({
      action: "export_csv",
      entity_type: "financial_review",
      actor_email: userEmail,
      company_db: companyDb,
      details: { rows: filtered.length, filters: { search, bpFilter, typeFilter } },
    });
    toast({ title: "CSV exportado", description: `${filtered.length} linhas` });
  };

  const exportPdf = () => {
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    doc.setFontSize(14);
    doc.text("Avaliação Financeira — Adiantamentos em aberto", 40, 36);
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(
      `Empresa: ${companyDb} · Gerado em ${new Date().toLocaleString("pt-BR")} · ${filtered.length} itens`,
      40,
      52,
    );
    doc.text(
      `Fornecedores: ${totals.supplierCount} (${formatMoney(totals.supplierSum, "BRL")})  ·  Clientes: ${totals.customerCount} (${formatMoney(totals.customerSum, "BRL")})`,
      40,
      66,
    );
    autoTable(doc, {
      startY: 80,
      head: [["Tipo", "Doc", "Parceiro", "Data", "Em aberto", "Referência", "Status"]],
      body: filtered.map((i) => [
        TYPE_LABEL[i.doc_type],
        String(i.doc_num ?? i.doc_entry),
        `${i.card_name}\n${i.card_code}`,
        formatDate(i.doc_date),
        formatMoney(i.open_amount, i.doc_currency),
        i.reference ?? "—",
        linkStatus(i),
      ]),
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [40, 40, 40] },
      columnStyles: { 4: { halign: "right" } },
    });
    doc.save(`avaliacao-financeira-${companyDb}-${new Date().toISOString().slice(0, 10)}.pdf`);
    logAuditAction({
      action: "export_pdf",
      entity_type: "financial_review",
      actor_email: userEmail,
      company_db: companyDb,
      details: { rows: filtered.length, filters: { search, bpFilter, typeFilter } },
    });
    toast({ title: "PDF exportado", description: `${filtered.length} linhas` });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="p-2 rounded-lg bg-primary/10">
              <Wallet className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Avaliação Financeira</h1>
              <p className="text-xs text-muted-foreground">
                Adiantamentos em aberto sem vínculo a notas
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
              <FileDown className="w-4 h-4" />
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={exportPdf} disabled={filtered.length === 0}>
              <FileText className="w-4 h-4" />
              PDF
            </Button>
            <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-4">
        {/* Resumo */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="glass-card p-4">
            <p className="text-xs text-muted-foreground">Itens em aberto</p>
            <p className="text-2xl font-bold">{totals.total}</p>
          </div>
          <div className="glass-card p-4">
            <p className="text-xs text-muted-foreground">Adiant. Fornecedores</p>
            <p className="text-2xl font-bold">{totals.supplierCount}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {formatMoney(totals.supplierSum, "BRL")}
            </p>
          </div>
          <div className="glass-card p-4">
            <p className="text-xs text-muted-foreground">Adiant. Clientes</p>
            <p className="text-2xl font-bold">{totals.customerCount}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {formatMoney(totals.customerSum, "BRL")}
            </p>
          </div>
        </div>

        {/* Filtros */}
        <div className="glass-card p-4 flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar código, nome, nº doc ou referência…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={bpFilter} onValueChange={(v) => setBpFilter(v as typeof bpFilter)}>
            <SelectTrigger className="w-full md:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os parceiros</SelectItem>
              <SelectItem value="supplier">Fornecedores</SelectItem>
              <SelectItem value="customer">Clientes</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}>
            <SelectTrigger className="w-full md:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tipos</SelectItem>
              <SelectItem value="ADVANCE_AP">{TYPE_LABEL.ADVANCE_AP}</SelectItem>
              <SelectItem value="ADVANCE_AR">{TYPE_LABEL.ADVANCE_AR}</SelectItem>
              <SelectItem value="PAYMENT_OA_OUT">{TYPE_LABEL.PAYMENT_OA_OUT}</SelectItem>
              <SelectItem value="PAYMENT_OA_IN">{TYPE_LABEL.PAYMENT_OA_IN}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {error && (
          <div className="glass-card p-4 border-destructive/50 flex gap-2 items-start">
            <AlertCircle className="w-4 h-4 text-destructive mt-0.5" />
            <div className="text-sm text-destructive">{error}</div>
          </div>
        )}

        {/* Tabela */}
        <div className="glass-card overflow-hidden">
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Doc.</TableHead>
                  <TableHead>Parceiro</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead className="text-right">Valor em aberto</TableHead>
                  <TableHead>Referência</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                      <RefreshCw className="w-5 h-5 animate-spin inline mr-2" />
                      Consultando SAP…
                    </TableCell>
                  </TableRow>
                )}
                {!loading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                      Nenhum adiantamento em aberto encontrado.
                    </TableCell>
                  </TableRow>
                )}
                {!loading &&
                  filtered.map((it) => (
                    <motion.tr
                      key={`${it.doc_type}-${it.doc_entry}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="border-b hover:bg-muted/40"
                    >
                      <TableCell>
                        <Badge variant={TYPE_VARIANT[it.doc_type]} className="whitespace-nowrap">
                          {TYPE_LABEL[it.doc_type]}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{it.doc_num ?? it.doc_entry}</TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{it.card_name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{it.card_code}</div>
                      </TableCell>
                      <TableCell className="text-sm">{formatDate(it.doc_date)}</TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatMoney(it.open_amount, it.doc_currency)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {it.reference || "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => setSelected(it)}>
                          <Link2 className="w-3.5 h-3.5" />
                          Reconciliar
                        </Button>
                      </TableCell>
                    </motion.tr>
                  ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <p className="text-xs text-muted-foreground flex gap-1 items-center">
          <Building2 className="w-3 h-3" />
          Empresa atual: <span className="font-mono">{companyDb}</span> · Para mudar, troque a
          empresa no menu principal.
        </p>
      </main>

      <ReconcileDialog
        item={selected}
        onClose={() => setSelected(null)}
        onListInvoices={async (cc, bp) => {
          const list = await listOpenInvoices(cc, bp);
          logAuditAction({
            action: "list_open_invoices",
            entity_type: "financial_review",
            entity_id: cc,
            actor_email: userEmail,
            company_db: companyDb,
            details: { card_code: cc, bp_type: bp, count: list.length },
          });
          return list;
        }}
        onCancel={async (docType, docEntry) => {
          await cancelPayment(docType, docEntry);
          logAuditAction({
            action: "cancel_payment",
            entity_type: "financial_review",
            entity_id: String(docEntry),
            actor_email: userEmail,
            company_db: companyDb,
            details: { doc_type: docType, doc_entry: docEntry },
          });
        }}
        onAutoLink={async (params) => {
          const r = await autoLink(params);
          logAuditAction({
            action: "auto_link",
            entity_type: "financial_review",
            entity_id: String(params.docEntry),
            actor_email: userEmail,
            company_db: companyDb,
            details: { ...params, applied: r.applied },
          });
          return r;
        }}
        onDone={() => {
          setSelected(null);
          refresh();
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconcile dialog with step-by-step guide
// ─────────────────────────────────────────────────────────────────────────────

function ReconcileDialog({
  item,
  onClose,
  onListInvoices,
  onCancel,
  onAutoLink,
  onDone,
}: {
  item: AdvanceItem | null;
  onClose: () => void;
  onListInvoices: (cardCode: string, bp: "supplier" | "customer") => Promise<OpenInvoice[]>;
  onCancel: (docType: AdvanceItem["doc_type"], docEntry: number) => Promise<void>;
  onAutoLink: (params: {
    docType: AdvanceItem["doc_type"];
    docEntry: number;
    invoiceDocEntry: number;
    cardCode: string;
    amount?: number;
  }) => Promise<{ ok: true; applied: number }>;
  onDone: () => void;
}) {
  const [tab, setTab] = useState<"link" | "internal" | "cancel" | "guide">("guide");
  const [invoices, setInvoices] = useState<OpenInvoice[] | null>(null);
  const [loadingInv, setLoadingInv] = useState(false);
  const [busy, setBusy] = useState(false);
  const [linkingId, setLinkingId] = useState<number | null>(null);

  useEffect(() => {
    setTab("guide");
    setInvoices(null);
  }, [item]);

  if (!item) return null;

  const loadInvoices = async () => {
    setLoadingInv(true);
    try {
      const list = await onListInvoices(item.card_code, item.bp_type);
      setInvoices(list);
    } catch (e) {
      toast({
        title: "Falha ao listar notas",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setLoadingInv(false);
    }
  };

  const handleCancel = async () => {
    if (!confirm(`Cancelar definitivamente o documento ${item.doc_num ?? item.doc_entry}?`)) return;
    setBusy(true);
    try {
      await onCancel(item.doc_type, item.doc_entry);
      toast({ title: "Documento cancelado", description: "O adiantamento foi cancelado no SAP." });
      onDone();
    } catch (e) {
      toast({
        title: "Falha ao cancelar",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleAutoLink = async (inv: OpenInvoice) => {
    if (!confirm(
      `Vincular o adiantamento ${item.doc_num ?? item.doc_entry} à NF ${inv.doc_num}?\n` +
      `Será aplicado ${formatMoney(Math.min(item.open_amount, inv.open_amount), inv.doc_currency)}.`,
    )) return;
    setLinkingId(inv.doc_entry);
    try {
      const r = await onAutoLink({
        docType: item.doc_type,
        docEntry: item.doc_entry,
        invoiceDocEntry: inv.doc_entry,
        cardCode: item.card_code,
      });
      toast({
        title: "Vinculação concluída",
        description: `Aplicado ${formatMoney(r.applied, inv.doc_currency)} à NF ${inv.doc_num}.`,
      });
      onDone();
    } catch (e) {
      toast({
        title: "Falha ao vincular",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setLinkingId(null);
    }
  };

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{item.card_name}</DialogTitle>
          <DialogDescription>
            {TYPE_LABEL[item.doc_type]} · Doc {item.doc_num ?? item.doc_entry} ·{" "}
            <span className="font-semibold">
              {formatMoney(item.open_amount, item.doc_currency)} em aberto
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 border-b border-border">
          <TabBtn active={tab === "guide"} onClick={() => setTab("guide")}>
            Passo a passo
          </TabBtn>
          <TabBtn active={tab === "link"} onClick={() => { setTab("link"); if (!invoices) loadInvoices(); }}>
            Vincular a NF
          </TabBtn>
          <TabBtn active={tab === "internal"} onClick={() => setTab("internal")}>
            Reconciliação interna
          </TabBtn>
          <TabBtn active={tab === "cancel"} onClick={() => setTab("cancel")}>
            Cancelar
          </TabBtn>
        </div>

        {tab === "guide" && <GuideTab item={item} />}

        {tab === "link" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground flex gap-2 items-start">
              <Info className="w-4 h-4 mt-0.5 shrink-0" />
              Selecione uma nota em aberto deste parceiro e clique em <strong>Vincular</strong>{" "}
              para que o sistema crie automaticamente o pagamento/reconciliação no SAP que quita
              o adiantamento contra a NF escolhida (valor aplicado = menor entre o saldo do
              adiantamento e o saldo da NF).
            </p>
            {loadingInv && (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin" /> Buscando notas em aberto…
              </div>
            )}
            {invoices && invoices.length === 0 && (
              <div className="text-sm text-muted-foreground py-6 text-center">
                Nenhuma nota em aberto encontrada para este parceiro.
              </div>
            )}
            {invoices && invoices.length > 0 && (
              <div className="max-h-72 overflow-auto border rounded">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Doc</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead className="text-right">Em aberto</TableHead>
                      <TableHead>Ref.</TableHead>
                      <TableHead className="text-right">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.map((inv) => (
                      <TableRow key={inv.doc_entry}>
                        <TableCell className="font-mono text-xs">{inv.doc_num}</TableCell>
                        <TableCell className="text-sm">{formatDate(inv.doc_date)}</TableCell>
                        <TableCell className="text-right">
                          {formatMoney(inv.open_amount, inv.doc_currency)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {inv.reference || "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            onClick={() => handleAutoLink(inv)}
                            disabled={linkingId !== null}
                          >
                            {linkingId === inv.doc_entry ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Link2 className="w-3.5 h-3.5" />
                            )}
                            Vincular
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}

        {tab === "internal" && (
          <div className="space-y-3 text-sm">
            <p className="flex gap-2 items-start">
              <Info className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
              <span>
                A <strong>reconciliação interna do parceiro</strong> compensa o adiantamento contra
                débitos/créditos do mesmo BP <strong>{item.card_code}</strong>. Use quando o
                adiantamento e a NF já existem mas estão soltos no extrato do parceiro.
              </span>
            </p>
            <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
              <li>Confirme que a NF do parceiro já está lançada no SAP.</li>
              <li>No SAP B1: <em>Business Partners → Internal Reconciliations → Reconciliation</em>.</li>
              <li>
                Filtre pelo CardCode <strong>{item.card_code}</strong> e marque o adiantamento doc{" "}
                <strong>{item.doc_num ?? item.doc_entry}</strong> + a(s) NF(s) correspondente(s).
              </li>
              <li>Confirme — os valores serão zerados no extrato do parceiro.</li>
            </ol>
            <p className="text-xs text-muted-foreground">
              A execução automática via Service Layer está disponível mas requer informar
              <code className="px-1">TransId/TransRowId</code> de cada lançamento — recomendamos
              executar manualmente no SAP até validarmos esse fluxo.
            </p>
          </div>
        )}

        {tab === "cancel" && (
          <div className="space-y-3">
            <p className="text-sm flex gap-2 items-start">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-destructive" />
              <span>
                O cancelamento gera um <strong>documento de estorno</strong> no SAP. Use apenas se
                o adiantamento foi lançado por engano ou nunca será aproveitado. Esta ação não pode
                ser desfeita.
              </span>
            </p>
            <Button
              variant="destructive"
              onClick={handleCancel}
              disabled={busy}
              className="w-full"
            >
              <Ban className="w-4 h-4" />
              {busy ? "Cancelando…" : `Cancelar documento ${item.doc_num ?? item.doc_entry}`}
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-sm border-b-2 transition-colors ${
        active
          ? "border-primary text-foreground font-medium"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function GuideTab({ item }: { item: AdvanceItem }) {
  const isPayment = item.doc_type.startsWith("PAYMENT_OA");
  return (
    <div className="space-y-4 text-sm">
      <div className="flex gap-2 items-start p-3 rounded-md bg-muted/40">
        <CheckCircle2 className="w-4 h-4 text-success mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">O que aconteceu?</p>
          <p className="text-muted-foreground">
            {isPayment
              ? "Foi lançado um pagamento 'on account' (sem invoice associada). O dinheiro saiu/entrou, mas não há nota fiscal vinculada."
              : "Foi emitida uma fatura de adiantamento (Down Payment Invoice), porém ainda não foi compensada por nenhuma nota final."}
          </p>
        </div>
      </div>

      <div>
        <p className="font-medium mb-1">Decida o caminho:</p>
        <ol className="list-decimal pl-5 space-y-2 text-muted-foreground">
          <li>
            <strong>Vincular a uma NF existente</strong> — se a nota fiscal{" "}
            {item.bp_type === "supplier" ? "do fornecedor" : "do cliente"} já foi lançada, abra a
            aba <em>Vincular a NF</em> e identifique a nota a quitar.
          </li>
          <li>
            <strong>Reconciliação interna</strong> — útil quando há vários lançamentos do mesmo
            parceiro que se anulam. Veja a aba <em>Reconciliação interna</em>.
          </li>
          <li>
            <strong>Cancelar</strong> — se o adiantamento foi lançado por engano. Veja a aba{" "}
            <em>Cancelar</em>.
          </li>
        </ol>
      </div>

      <div className="text-xs text-muted-foreground border-t pt-3">
        <p className="font-medium text-foreground mb-1">Detalhes do documento</p>
        <ul className="space-y-0.5">
          <li>Tipo: {TYPE_LABEL[item.doc_type]}</li>
          <li>Parceiro: {item.card_name} ({item.card_code})</li>
          <li>Data: {formatDate(item.doc_date)}</li>
          <li>Valor total: {formatMoney(item.doc_total, item.doc_currency)}</li>
          <li>Em aberto: {formatMoney(item.open_amount, item.doc_currency)}</li>
          {item.remarks && <li>Observações: {item.remarks}</li>}
        </ul>
      </div>
    </div>
  );
}
