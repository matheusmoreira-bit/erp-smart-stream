import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FileText,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Receipt,
  Upload,
  Eye,
  Mail,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { sapFunctionFetch, authFetch } from "@/lib/auth-fetch";
import { useSap } from "@/contexts/SapContext";
import { useCompanies } from "@/hooks/useCompanies";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const PDF_BUCKET = "nfse-pdfs";

/* ── helpers ─────────────────────────────────────────────── */

function formatCurrency(value: number, currency = "BRL") {
  const valid = /^[A-Z]{3}$/.test(currency) ? currency : "BRL";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: valid }).format(value || 0);
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

const APPROVED_STATUSES = [
  "aprovado",
  "pc_lancado",
  "nf_entrada",
  "pagamento",
  "finalizado",
] as const;

interface SalesOrderRow {
  id: string;
  supplier_code: string | null;
  supplier_name: string;
  total_amount: number;
  currency: string;
  status: string;
  doc_date: string | null;
  requester_name: string | null;
  sap_doc_entry: number | null;
  sap_doc_num: number | null;
}

interface NfseRow {
  id: string;
  expense_id: string;
  sap_invoice_doc_entry: number | null;
  sap_invoice_doc_num: number | null;
  nfse_number: string | null;
  rps_number: string | null;
  series: string | null;
  status: string;
  authorized_at: string | null;
  total_amount: number;
  currency: string;
  last_error: string | null;
  created_at: string;
}

/* ── página ──────────────────────────────────────────────── */

export default function SalesNfse() {
  const { session, logout } = useSap();
  const { getLabel } = useCompanies();
  const companyDb = session?.companyDB || "";

  const [orders, setOrders] = useState<SalesOrderRow[]>([]);
  const [invoices, setInvoices] = useState<NfseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [confirmOrder, setConfirmOrder] = useState<SalesOrderRow | null>(null);
  const [emitting, setEmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pdfFiles, setPdfFiles] = useState<Set<string>>(new Set());
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [xmlPaths, setXmlPaths] = useState<Record<string, string>>({});
  const [xmlLoadingFor, setXmlLoadingFor] = useState<string | null>(null);
  const uploadTargetRef = useRef<{ order: SalesOrderRow; inv: NfseRow | null } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);


  // envio de e-mail
  const [mailOrder, setMailOrder] = useState<SalesOrderRow | null>(null);
  const [mailInvoice, setMailInvoice] = useState<NfseRow | null>(null);
  const [mailTo, setMailTo] = useState("");
  const [mailCc, setMailCc] = useState("");
  const [mailSubject, setMailSubject] = useState("");
  const [mailMessage, setMailMessage] = useState("");
  const [mailSenderOk, setMailSenderOk] = useState(true);
  const [mailLoading, setMailLoading] = useState(false);
  const [mailSending, setMailSending] = useState(false);

  const pdfPathFor = useCallback(
    (order: SalesOrderRow, inv: NfseRow | null) =>
      `${companyDb}/${inv?.sap_invoice_doc_entry ?? `pedido-${order.sap_doc_entry ?? order.id}`}.pdf`,
    [companyDb],
  );

  const loadPdfIndex = useCallback(async () => {
    if (!companyDb) return;
    const { data } = await supabase.storage.from(PDF_BUCKET).list(companyDb, { limit: 1000 });
    setPdfFiles(new Set((data || []).map((f) => `${companyDb}/${f.name}`)));
  }, [companyDb]);

  const load = useCallback(async () => {
    if (!companyDb) return;
    setLoading(true);
    setError(null);
    try {
      const [{ data: exp, error: e1 }, { data: inv, error: e2 }] = await Promise.all([
        supabase
          .from("expenses")
          .select("id, supplier_code, supplier_name, total_amount, currency, status, doc_date, requester_name, sap_doc_entry, sap_doc_num")
          .eq("company_db", companyDb)
          .eq("doc_type", "sales")
          .in("status", APPROVED_STATUSES)
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("sales_order_invoices")
          .select("*")
          .eq("company_db", companyDb)
          .order("created_at", { ascending: false })
          .limit(500),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      setOrders((exp || []) as SalesOrderRow[]);
      setInvoices((inv || []) as NfseRow[]);
      await loadPdfIndex();
    } catch (e) {
      setError((e as Error).message || "Falha ao carregar pedidos de venda");
    } finally {
      setLoading(false);
    }
  }, [companyDb, loadPdfIndex]);

  useEffect(() => {
    void load();
  }, [load]);

  const pickPdf = useCallback((order: SalesOrderRow, inv: NfseRow | null) => {
    uploadTargetRef.current = { order, inv };
    fileInputRef.current?.click();
  }, []);

  const onPdfSelected = useCallback(
    async (file: File | undefined) => {
      const target = uploadTargetRef.current;
      if (!file || !target) return;
      if (file.type !== "application/pdf") {
        toast.error("Envie um arquivo PDF.");
        return;
      }
      if (file.size > 15 * 1024 * 1024) {
        toast.error("PDF acima do limite de 15MB.");
        return;
      }
      const path = pdfPathFor(target.order, target.inv);
      setUploadingFor(target.order.id);
      try {
        const { error } = await supabase.storage
          .from(PDF_BUCKET)
          .upload(path, file, { upsert: true, contentType: "application/pdf" });
        if (error) throw error;
        toast.success("PDF da NFS-e anexado.");
        await loadPdfIndex();
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setUploadingFor(null);
        uploadTargetRef.current = null;
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [pdfPathFor, loadPdfIndex],
  );

  const viewPdf = useCallback(
    async (order: SalesOrderRow, inv: NfseRow | null) => {
      const path = pdfPathFor(order, inv);
      const { data, error } = await supabase.storage.from(PDF_BUCKET).createSignedUrl(path, 300);
      if (error || !data?.signedUrl) {
        toast.error("Não foi possível abrir o PDF.");
        return;
      }
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    },
    [pdfPathFor],
  );

  const XML_REASONS: Record<string, string> = {
    hana_indisponivel: "Esta empresa não tem HanaAPI habilitada.",
    entidade_fiscal_nao_encontrada: "Entidade fiscal (TaxOne) não encontrada para esta base.",
    documento_fiscal_nao_encontrado: "Nota ainda não registrada no addon fiscal.",
    view_xml_nao_publicada: "View de XML autorizado ainda não criada nesta base.",
    xml_nao_encontrado: "XML autorizado ainda não disponível para esta nota.",
    xml_vazio: "XML autorizado veio vazio no addon fiscal.",
  };

  const fetchXml = useCallback(
    async (order: SalesOrderRow, inv: NfseRow | null, openAfter = true) => {
      if (!inv?.sap_invoice_doc_entry) return null;
      setXmlLoadingFor(order.id);
      try {
        const res = await authFetch("nfse-xml-fetch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ company_db: companyDb, doc_entry: inv.sap_invoice_doc_entry }),
        });
        const b = await res.json().catch(() => ({}));
        if (!res.ok || b?.error) throw new Error(b?.error || `Falha ao buscar XML (${res.status})`);
        if (b?.unavailable) {
          toast.info(XML_REASONS[b.reason] || "XML autorizado indisponível.");
          return null;
        }
        setXmlPaths((prev) => ({ ...prev, [order.id]: b.path }));
        if (openAfter && b.signed_url) window.open(b.signed_url, "_blank", "noopener,noreferrer");
        return b.path as string;
      } catch (e) {
        toast.error((e as Error).message);
        return null;
      } finally {
        setXmlLoadingFor(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [companyDb],
  );



  const openMail = useCallback(
    async (order: SalesOrderRow, inv: NfseRow | null) => {
      setMailOrder(order);
      setMailInvoice(inv);
      setMailTo("");
      setMailCc("");
      setMailSubject(`NFS-e ${inv?.nfse_number ? `nº ${inv.nfse_number} ` : ""}- ${getLabel(companyDb)}`);
      setMailMessage(
        `Segue em anexo a nota fiscal de serviço${inv?.nfse_number ? ` nº ${inv.nfse_number}` : ""}.`,
      );
      setMailSenderOk(true);
      setMailLoading(true);
      try {
        const res = await authFetch("nfse-send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "resolve", company_db: companyDb, project_code: "" }),
        });
        const b = await res.json().catch(() => ({}));
        if (res.ok && !b?.error) {
          setMailTo((b.to || []).join(", "));
          setMailCc((b.cc || []).join(", "));
          setMailSenderOk(!!b.sender?.configured);
        }
      } finally {
        setMailLoading(false);
      }
    },
    [companyDb, getLabel],
  );

  const sendMail = useCallback(async () => {
    if (!mailOrder) return;
    const path = pdfPathFor(mailOrder, mailInvoice);
    setMailSending(true);
    try {
      // XML autorizado: usa o já baixado ou tenta buscar no addon fiscal na hora.
      const xmlPath =
        xmlPaths[mailOrder.id] || (await fetchXml(mailOrder, mailInvoice, false)) || "";
      const res = await authFetch("nfse-send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          company_db: companyDb,
          expense_id: mailOrder.id,
          invoice_doc_entry: mailInvoice?.sap_invoice_doc_entry ?? null,
          nfse_number: mailInvoice?.nfse_number ?? null,
          customer_name: mailOrder.supplier_name,
          to: mailTo,
          cc: mailCc,
          subject: mailSubject,
          message: mailMessage,
          attachment_path: pdfFiles.has(path) ? path : "",
          attachment_xml_path: xmlPath,
        }),
      });

      const b = await res.json().catch(() => ({}));
      if (!res.ok || b?.error) throw new Error(b?.error || `Falha no envio (${res.status})`);
      toast.success(`E-mail enviado para ${(b.to || []).join(", ")}`);
      setMailOrder(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setMailSending(false);
    }
  }, [mailOrder, mailInvoice, companyDb, mailTo, mailCc, mailSubject, mailMessage, pdfFiles, pdfPathFor]);

  const invoiceByExpense = useMemo(() => {
    const map = new Map<string, NfseRow>();
    for (const row of invoices) {
      const current = map.get(row.expense_id);
      // prioriza a nota válida mais recente sobre tentativas com falha
      if (!current || (current.status === "failed" && row.status !== "failed")) {
        map.set(row.expense_id, row);
      }
    }
    return map;
  }, [invoices]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => {
      const inv = invoiceByExpense.get(o.id);
      return (
        o.supplier_name.toLowerCase().includes(q) ||
        (o.supplier_code || "").toLowerCase().includes(q) ||
        String(o.sap_doc_num || "").includes(q) ||
        (inv?.nfse_number || "").toLowerCase().includes(q)
      );
    });
  }, [orders, search, invoiceByExpense]);

  const pendentes = filtered.filter((o) => !invoiceByExpense.get(o.id)?.sap_invoice_doc_entry);

  const emit = useCallback(async () => {
    if (!confirmOrder) return;
    setEmitting(true);
    try {
      const res = await sapFunctionFetch("sales-nfse-emit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "emit", expense_id: confirmOrder.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.error) throw new Error(body?.error || `Falha ao emitir (${res.status})`);
      toast.success(`NFS-e criada no ERP — documento ${body.doc_num}`);
      setConfirmOrder(null);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEmitting(false);
    }
  }, [confirmOrder, load]);

  const syncStatus = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await sapFunctionFetch("sales-nfse-emit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync-status", company_db: companyDb }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.error) throw new Error(body?.error || `Falha na consulta (${res.status})`);
      toast.success(`Status fiscal atualizado (${body.updated ?? 0} nota[s]).`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }, [companyDb, load]);

  if (!session) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-3">
          <ShieldAlert className="w-10 h-10 mx-auto text-muted-foreground" />
          <h1 className="text-xl font-semibold">Sessão do ERP necessária</h1>
          <p className="text-sm text-muted-foreground">
            Faça login no ERP para emitir notas fiscais de serviço.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        icon={<FileText className="w-5 h-5 text-primary" />}
        title="Vendas"
        titleAccent="NFS-e"
        subtitle="Emissão da nota fiscal de serviço a partir dos pedidos de venda aprovados"
        companyLabel={getLabel(companyDb)}
        userName={session?.userName}
        onLogout={logout}
        actions={
          <>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => void syncStatus()} disabled={syncing}>
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
              Atualizar status fiscal
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Atualizar
            </Button>
          </>
        }
      />

      <div className="max-w-7xl mx-auto w-full p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-muted/20 p-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por cliente, pedido ou nº da NFS-e"
              className="pl-8 h-9 text-sm"
            />
          </div>
          <div className="ml-auto text-xs text-muted-foreground">
            {filtered.length} pedido(s) · {pendentes.length} aguardando emissão
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading && orders.length === 0 ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Nenhum pedido de venda aprovado encontrado para esta empresa.
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Pedido</th>
                  <th className="text-left px-3 py-2 font-medium">Cliente</th>
                  <th className="text-left px-3 py-2 font-medium">Data</th>
                  <th className="text-right px-3 py-2 font-medium">Valor</th>
                  <th className="text-left px-3 py-2 font-medium">NFS-e</th>
                  <th className="text-left px-3 py-2 font-medium">PDF</th>
                  <th className="text-right px-3 py-2 font-medium">Ação</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => {
                  const inv = invoiceByExpense.get(o.id);
                  const emitted = !!inv?.sap_invoice_doc_entry;
                  return (
                    <tr key={o.id} className="border-t border-border/60">
                      <td className="px-3 py-2 font-mono text-xs">
                        {o.sap_doc_num ? `#${o.sap_doc_num}` : "—"}
                        {!o.sap_doc_entry && (
                          <span className="ml-2 text-[11px] text-muted-foreground">não integrado</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{o.supplier_name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{o.supplier_code || "—"}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">{formatDate(o.doc_date)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {formatCurrency(Number(o.total_amount), o.currency)}
                      </td>
                      <td className="px-3 py-2">
                        {inv?.status === "authorized" ? (
                          <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-500">
                            <CheckCircle2 className="w-3 h-3" />
                            NFS-e {inv.nfse_number}
                            {inv.rps_number ? ` · RPS ${inv.rps_number}` : ""}
                          </Badge>
                        ) : emitted ? (
                          <Badge variant="outline" className="gap-1">
                            <Loader2 className="w-3 h-3" />
                            Emitida (doc {inv?.sap_invoice_doc_num}) · aguardando autorização
                          </Badge>
                        ) : inv?.status === "failed" ? (
                          <span className="inline-flex items-center gap-1 text-xs text-destructive">
                            <AlertTriangle className="w-3 h-3" />
                            {inv.last_error?.slice(0, 80) || "Falha na emissão"}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Aguardando emissão</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {(() => {
                          const path = pdfPathFor(o, inv ?? null);
                          const hasPdf = pdfFiles.has(path);
                          return (
                            <div className="flex items-center gap-1">
                              {hasPdf && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 gap-1 px-2 text-xs"
                                  onClick={() => void viewPdf(o, inv ?? null)}
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  Ver
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 gap-1 px-2 text-xs"
                                disabled={uploadingFor === o.id}
                                onClick={() => pickPdf(o, inv ?? null)}
                              >
                                {uploadingFor === o.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Upload className="w-3.5 h-3.5" />
                                )}
                                {hasPdf ? "Substituir" : "Anexar"}
                              </Button>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1"
                            disabled={!emitted}
                            onClick={() => void openMail(o, inv ?? null)}
                          >
                            <Mail className="w-3.5 h-3.5" />
                            Enviar
                          </Button>
                          <Button
                            size="sm"
                            variant={emitted ? "ghost" : "default"}
                            disabled={emitted || !o.sap_doc_entry}
                            onClick={() => setConfirmOrder(o)}
                          >
                            {emitted ? "Emitida" : "Emitir NFS-e"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={!!confirmOrder} onOpenChange={(v) => !v && setConfirmOrder(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar emissão de NFS-e</DialogTitle>
            <DialogDescription>
              A nota será criada no ERP a partir do pedido de venda e enviada ao addon fiscal.
            </DialogDescription>
          </DialogHeader>
          {confirmOrder && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Pedido</span>
                <span className="font-mono">#{confirmOrder.sap_doc_num}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Cliente</span>
                <span className="text-right">{confirmOrder.supplier_name}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Valor</span>
                <span className="font-mono">
                  {formatCurrency(Number(confirmOrder.total_amount), confirmOrder.currency)}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Solicitante</span>
                <span>{confirmOrder.requester_name || "—"}</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOrder(null)} disabled={emitting}>
              Cancelar
            </Button>
            <Button onClick={() => void emit()} disabled={emitting} className="gap-2">
              {emitting && <Loader2 className="w-4 h-4 animate-spin" />}
              Emitir NFS-e
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => void onPdfSelected(e.target.files?.[0])}
      />

      <Dialog open={!!mailOrder} onOpenChange={(v) => !v && setMailOrder(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Enviar NFS-e por e-mail</DialogTitle>
            <DialogDescription>
              {mailInvoice?.nfse_number
                ? `Nota nº ${mailInvoice.nfse_number} · ${mailOrder?.supplier_name || ""}`
                : mailOrder?.supplier_name}
            </DialogDescription>
          </DialogHeader>

          {mailLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="space-y-3">
              {!mailSenderOk && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                  Remetente de e-mail não configurado para esta empresa (Backoffice → E-mail NFS-e).
                </div>
              )}
              {mailOrder && !pdfFiles.has(pdfPathFor(mailOrder, mailInvoice)) && (
                <div className="rounded-md border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
                  Nenhum PDF anexado a esta nota — o e-mail será enviado sem anexo.
                </div>
              )}
              <div>
                <Label className="text-xs text-muted-foreground">Para</Label>
                <Input value={mailTo} onChange={(e) => setMailTo(e.target.value)} placeholder="cliente@dominio.com" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Cópia</Label>
                <Input value={mailCc} onChange={(e) => setMailCc(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Assunto</Label>
                <Input value={mailSubject} onChange={(e) => setMailSubject(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Mensagem</Label>
                <Textarea rows={4} value={mailMessage} onChange={(e) => setMailMessage(e.target.value)} />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setMailOrder(null)} disabled={mailSending}>
              Cancelar
            </Button>
            <Button onClick={() => void sendMail()} disabled={mailSending || !mailTo.trim()} className="gap-2">
              {mailSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
