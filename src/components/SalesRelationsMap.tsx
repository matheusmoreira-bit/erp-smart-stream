import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FileText,
  Receipt,
  Wallet,
  ArrowDown,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Info,
  Download,
  FileDown,
  RefreshCw,
  Inbox,
  ServerCrash,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { sapQueryAll } from "@/lib/sap-client";
import type { SapSession } from "@/lib/sap-client";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Copy, ExternalLink } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";


interface Props {
  open: boolean;
  onClose: () => void;
  session: SapSession | null;
  invoice: {
    docEntry: number;
    docNum: number;
    folioNumber?: number | null;
    nfseNumber?: string | null;
    folioPrefix?: string | null;
    folioSeries?: string | null;
    cardCode: string;
    cardName: string;
    docDate: string;
    docTotal: number;
    paidToDate: number;
    currency: string;
  } | null;
}

interface SalesOrderRef {
  docEntry: number;
  docNum?: number | null;
  docDate?: string | null;
  docTotal?: number | null;
}

interface BaixaEntry {
  id: string | null;              // null quando origem = SAP puro (fora do ERP Flow)
  origin: "internal" | "external"; // internal = registrada no ERP Flow; external = SAP direto
  data_recebimento: string;
  valor_baixado: number;
  valor_juros_multa: number;
  status: string;
  sap_incoming_payment_doc_entry: number | null;
  created_at: string;
  criado_por_nome: string | null;
  criado_por_user_code: string | null;
}

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

function formatTime(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return "—";
  }
}

function formatNfseLabel(invoice: Pick<NonNullable<Props["invoice"]>, "nfseNumber" | "folioPrefix" | "folioSeries">) {
  if (!invoice.nfseNumber) return null;
  return `NFS-e ${invoice.folioPrefix ? `${invoice.folioPrefix} ` : ""}${invoice.nfseNumber}${invoice.folioSeries ? ` · Série ${invoice.folioSeries}` : ""}`;
}


export function SalesRelationsMap({ open, onClose, session, invoice }: Props) {
  const [orders, setOrders] = useState<SalesOrderRef[]>([]);
  const [baixas, setBaixas] = useState<BaixaEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    if (!open || !invoice || !session) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // 1) Pedidos de venda que originaram esta NF (via DocumentLines.BaseType=17)
        const invRes = await sapQueryAll(
          session,
          `Invoices(${invoice.docEntry})`,
          {
            $select: "DocEntry",
            $expand: "DocumentLines($select=BaseType,BaseEntry,BaseRef,BaseLine)",
          },
          true,
        );
        const rawLines =
          ((invRes.data as unknown) as {
            DocumentLines?: Array<{ BaseType?: number; BaseEntry?: number; BaseRef?: string | number | null }>;
          })?.DocumentLines || [];
        const orderEntries = Array.from(
          new Set(
            rawLines
              .filter((l) => Number(l.BaseType) === 17 && Number.isFinite(Number(l.BaseEntry)))
              .map((l) => Number(l.BaseEntry)),
          ),
        );

        let orderRows: SalesOrderRef[] = [];
        if (orderEntries.length > 0) {
          const filter = orderEntries.map((e) => `DocEntry eq ${e}`).join(" or ");
          const ordRes = await sapQueryAll(
            session,
            "Orders",
            {
              $select: "DocEntry,DocNum,DocDate,DocTotal",
              $filter: filter,
            },
            true,
          );
          orderRows = ((ordRes.data?.value as Array<{
            DocEntry: number;
            DocNum: number;
            DocDate: string;
            DocTotal: number;
          }>) || []).map((o) => ({
            docEntry: o.DocEntry,
            docNum: o.DocNum,
            docDate: o.DocDate,
            docTotal: o.DocTotal,
          }));
        }

        // 2) Baixas registradas no Lovable para esta NF.
        //    Usa RPC SECURITY DEFINER porque a RLS de baixas_recebimento
        //    restringe leitura ao criador/admin, e o mapa deve mostrar as
        //    baixas de qualquer usuário da empresa que baixou a mesma NF.
        const { data: rpcData, error: baixasErr } = await supabase.rpc(
          "list_baixas_by_invoice",
          { p_company_db: session.companyDB, p_invoice_doc_entry: invoice.docEntry },
        );
        if (baixasErr) throw new Error(baixasErr.message);

        const internalBaixas: BaixaEntry[] = ((rpcData || []) as Array<{
          id: string;
          data_recebimento: string;
          valor_baixado: number | string;
          valor_juros_multa: number | string;
          status: string;
          sap_incoming_payment_doc_entry: number | null;
          created_at: string;
          criado_por_nome: string | null;
          criado_por_user_code: string | null;
        }>).map((r) => ({
          id: r.id,
          origin: "internal" as const,
          data_recebimento: r.data_recebimento,
          valor_baixado: Number(r.valor_baixado || 0),
          valor_juros_multa: Number(r.valor_juros_multa || 0),
          status: r.status,
          sap_incoming_payment_doc_entry: r.sap_incoming_payment_doc_entry,
          created_at: r.created_at,
          criado_por_nome: r.criado_por_nome,
          criado_por_user_code: r.criado_por_user_code,
        }));

        // 3) IncomingPayments no SAP para este CardCode (todas as baixas —
        //    inclusive as feitas fora do ERP Flow). Filtro final por linhas
        //    de PaymentInvoices que apontam para este DocEntry.
        const knownSapDocs = new Set<number>(
          internalBaixas
            .map((b) => b.sap_incoming_payment_doc_entry)
            .filter((n): n is number => typeof n === "number" && Number.isFinite(n)),
        );
        let externalBaixas: BaixaEntry[] = [];
        try {
          const cardCodeEsc = invoice.cardCode.replace(/'/g, "''");
          const ipRes = await sapQueryAll(
            session,
            "IncomingPayments",
            {
              $select: "DocEntry,DocNum,DocDate,DocTime,CreationDate,CardCode,Cancelled,UserSign",
              $expand: "PaymentInvoices($select=DocEntry,InvoiceType,SumApplied)",
              $filter: `CardCode eq '${cardCodeEsc}' and Cancelled eq 'tNO'`,
            },
            true,
          );
          const ipRows = (ipRes.data?.value as Array<{
            DocEntry: number;
            DocNum?: number;
            DocDate?: string;
            DocTime?: string | number | null;
            CreationDate?: string;
            Cancelled?: string;
            UserSign?: number | null;
            PaymentInvoices?: Array<{ DocEntry: number; InvoiceType?: string; SumApplied?: number }>;
          }>) || [];
          externalBaixas = ipRows
            .filter((ip) => knownSapDocs.has(Number(ip.DocEntry)) === false)
            .map((ip) => {
              const applied = (ip.PaymentInvoices || [])
                .filter((pi) => Number(pi.DocEntry) === invoice.docEntry)
                .reduce((s, pi) => s + Number(pi.SumApplied || 0), 0);
              return { ip, applied };
            })
            .filter((x) => x.applied > 0)
            .map(({ ip, applied }) => {
              // Compõe timestamp de created_at a partir de DocDate + DocTime.
              // DocTime no Service Layer costuma vir como número HHMM (ex.: 1435 = 14:35).
              let iso = ip.CreationDate || ip.DocDate || "";
              if (ip.DocDate && ip.DocTime != null) {
                const t = String(ip.DocTime).padStart(4, "0");
                const hh = t.slice(0, 2);
                const mm = t.slice(2, 4);
                iso = `${ip.DocDate}T${hh}:${mm}:00`;
              }
              return {
                id: null,
                origin: "external" as const,
                data_recebimento: ip.DocDate || "",
                valor_baixado: applied,
                valor_juros_multa: 0,
                status: "sincronizado",
                sap_incoming_payment_doc_entry: Number(ip.DocEntry),
                created_at: iso,
                criado_por_nome: null,
                criado_por_user_code: ip.UserSign != null ? `SAP UserSign ${ip.UserSign}` : "SAP (fora do ERP Flow)",
              } satisfies BaixaEntry;
            });
        } catch (e) {
          // Se falhar a consulta de IncomingPayments, não bloqueia o mapa —
          // caímos para o cálculo antigo (agregado como "saldo inicial já baixado").
          console.warn("[SalesRelationsMap] falha ao listar IncomingPayments:", e);
        }

        const baixaRows: BaixaEntry[] = [...internalBaixas, ...externalBaixas];


        // Ordena por data de recebimento (asc), depois por created_at
        baixaRows.sort((a, b) => {
          const d = a.data_recebimento.localeCompare(b.data_recebimento);
          if (d !== 0) return d;
          return a.created_at.localeCompare(b.created_at);
        });

        if (!cancelled) {
          setOrders(orderRows);
          setBaixas(baixaRows);
        }
      } catch (e) {
        if (!cancelled) {
          setOrders([]);
          setBaixas([]);
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, invoice, session, reloadNonce]);



  // Cálculos:
  //  - total baixado por nós (soma dos itens registrados no Lovable p/ essa NF)
  //  - saldo inicial residual (paidToDate - baixas conhecidas): pagamentos que
  //    já reduziam o saldo antes/fora do ERP Flow
  const knownPaid = useMemo(() => baixas.reduce((s, b) => s + b.valor_baixado, 0), [baixas]);
  const externalPaid = Math.max(0, +(invoice ? invoice.paidToDate - knownPaid : 0).toFixed(2));
  const finalResidual = invoice
    ? Math.max(0, +(invoice.docTotal - invoice.paidToDate).toFixed(2))
    : 0;

  // Timeline: saldo residual após cada baixa. Começa em (docTotal - externalPaid).
  const timeline = useMemo(() => {
    if (!invoice) return [] as { baixa: BaixaEntry; residualAfter: number }[];
    let running = +(invoice.docTotal - externalPaid).toFixed(2);
    return baixas.map((b) => {
      running = +(running - b.valor_baixado).toFixed(2);
      return { baixa: b, residualAfter: Math.max(0, running) };
    });
  }, [baixas, invoice, externalPaid]);

  if (!invoice) return null;

  const nfseLabel = formatNfseLabel(invoice);

  // ── Linhas normalizadas para exportação (CSV/PDF) ───────────────
  function buildRows() {
    if (!invoice) return [] as string[][];
    const rows: string[][] = [];
    for (const o of orders) {
      rows.push([
        "Pedido de Venda",
        String(o.docNum ?? o.docEntry),
        formatDate(o.docDate),
        "",
        "",
        formatCurrency(o.docTotal ?? 0, invoice.currency),
        "",
        "",
        "",
      ]);
    }
    rows.push([
      "NF de Venda",
      String(invoice.docNum),
      formatDate(invoice.docDate),
      "",
      "",
      formatCurrency(invoice.docTotal, invoice.currency),
      "",
      "",
      formatCurrency(+(invoice.docTotal - externalPaid).toFixed(2), invoice.currency),
    ]);
    if (externalPaid > 0) {
      rows.push([
        "Baixa (fora do ERP Flow)",
        "—",
        "—",
        "—",
        "—",
        "",
        formatCurrency(externalPaid, invoice.currency),
        "",
        formatCurrency(+(invoice.docTotal - externalPaid).toFixed(2), invoice.currency),
      ]);
    }
    for (const { baixa, residualAfter } of timeline) {
      rows.push([
        "Baixa",
        baixa.sap_incoming_payment_doc_entry ? `SAP #${baixa.sap_incoming_payment_doc_entry}` : "—",
        formatDate(baixa.data_recebimento),
        formatTime(baixa.created_at),
        baixa.criado_por_nome || baixa.criado_por_user_code || "—",
        "",
        formatCurrency(baixa.valor_baixado, invoice.currency),
        baixa.valor_juros_multa > 0 ? formatCurrency(baixa.valor_juros_multa, invoice.currency) : "",
        formatCurrency(residualAfter, invoice.currency),
      ]);
    }
    return rows;
  }

  const headers = [
    "Etapa",
    "Documento",
    "Data",
    "Hora",
    "Usuário",
    "Valor documento",
    "Valor baixado",
    "Juros/Multa",
    "Saldo residual",
  ];


  function fileBase() {
    return `mapa-relacoes-NF-${invoice!.docNum}`;
  }

  function handleExportCsv() {
    const rows = buildRows();
    const esc = (v: string) => `"${(v || "").replace(/"/g, '""')}"`;
    const csv =
      "\uFEFF" +
      [headers, ...rows].map((r) => r.map(esc).join(";")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileBase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleExportPdf() {
    const rows = buildRows();
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    doc.setFontSize(14);
    doc.text(`Mapa de relações — NF #${invoice!.docNum}`, 40, 40);
    doc.setFontSize(9);
    doc.setTextColor(90);
    const meta = [
      `Cliente: ${invoice!.cardName} (${invoice!.cardCode})`,
      `Emitida em ${formatDate(invoice!.docDate)}`,
      `Total: ${formatCurrency(invoice!.docTotal, invoice!.currency)}`,
      `Saldo residual atual: ${formatCurrency(finalResidual, invoice!.currency)}`,
    ];
    meta.forEach((line, i) => doc.text(line, 40, 58 + i * 12));

    autoTable(doc, {
      startY: 58 + meta.length * 12 + 8,
      head: [headers],
      body: rows,
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [40, 40, 40] },
      columnStyles: {
        5: { halign: "right" },
        6: { halign: "right" },
        7: { halign: "right" },
        8: { halign: "right" },
      },
    });

    doc.save(`${fileBase()}.pdf`);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 justify-between pr-6">
            <span className="flex items-center gap-2">
              <Receipt className="w-5 h-5 text-primary" />
              Mapa de relações — NF #{invoice.docNum}
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={handleExportCsv}
                disabled={loading || !!error}
              >
                <Download className="w-3.5 h-3.5" /> CSV
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={handleExportPdf}
                disabled={loading || !!error}
              >
                <FileDown className="w-3.5 h-3.5" /> PDF
              </Button>
            </div>
          </DialogTitle>
          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
            <span>{invoice.cardName}</span>
            {nfseLabel && (
              <span className="font-mono">
                {nfseLabel}
              </span>
            )}
            <span className="font-mono">{invoice.cardCode}</span>
            <span>Emitida em {formatDate(invoice.docDate)}</span>
            <span className="font-mono">{formatCurrency(invoice.docTotal, invoice.currency)}</span>
          </div>
        </DialogHeader>

        {loading ? (
          <MapSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={() => setReloadNonce((n) => n + 1)} />
        ) : orders.length === 0 && baixas.length === 0 && externalPaid === 0 ? (
          <EmptyState />
        ) : (

          <div className="space-y-3 mt-2">
            {/* Pedido de Venda */}
            <FlowSection
              title="Pedido(s) de Venda"
              icon={<FileText className="w-4 h-4" />}
              emptyText="Nenhum pedido de venda vinculado (NF avulsa)."
              empty={orders.length === 0}
            >
              {orders.map((o) => (
                <div
                  key={o.docEntry}
                  className="flex items-center justify-between rounded-md border border-border/60 bg-muted/20 px-3 py-2 gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium flex items-center gap-1.5 flex-wrap">
                      Pedido #{o.docNum ?? o.docEntry}
                      <IdBadge label="DocEntry" value={String(o.docEntry)} />
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Emitido em {formatDate(o.docDate)}
                    </p>
                  </div>
                  {o.docTotal != null && (
                    <span className="font-mono text-sm shrink-0">
                      {formatCurrency(o.docTotal, invoice.currency)}
                    </span>
                  )}
                </div>
              ))}
            </FlowSection>


            <FlowArrow />

            {/* NF de Venda */}
            <FlowSection
              title="NF de Venda"
              icon={<Receipt className="w-4 h-4" />}
            >
              <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold flex items-center gap-1.5 flex-wrap">
                      NF #{invoice.docNum}
                      <IdBadge label="DocEntry" value={String(invoice.docEntry)} />
                      {nfseLabel && (
                        <IdBadge
                          label="NFS-e"
                          value={nfseLabel.replace(/^NFS-e\s*/, "")}
                        />
                      )}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Emitida em {formatDate(invoice.docDate)} · Total{" "}
                      <span className="font-mono">{formatCurrency(invoice.docTotal, invoice.currency)}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Saldo residual atual
                    </p>
                    <p
                      className={`font-mono text-sm font-semibold ${
                        finalResidual > 0 ? "text-foreground" : "text-emerald-500"
                      }`}
                    >
                      {formatCurrency(finalResidual, invoice.currency)}
                    </p>
                  </div>
                </div>
              </div>
            </FlowSection>

            <FlowArrow />

            {/* Baixas */}
            <FlowSection
              title={`Baixas (${baixas.length})`}
              icon={<Wallet className="w-4 h-4" />}
              emptyText={
                externalPaid > 0
                  ? "Sem baixas registradas no ERP Flow para esta NF."
                  : "Nenhuma baixa realizada até o momento."
              }
              empty={baixas.length === 0 && externalPaid === 0}
            >
              {/* Saldo inicial (baixas externas) — cinza apagado */}
              {externalPaid > 0 && (() => {
                const restaExt = Math.max(0, +(invoice.docTotal - externalPaid).toFixed(2));
                return (
                  <div className="rounded-md border border-dashed border-border/60 bg-muted/10 px-3 py-2 opacity-70">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-start gap-2 min-w-0">
                        <Info className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-muted-foreground truncate">
                            Saldo inicial já baixado (fora do ERP Flow)
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            Pagamentos registrados diretamente no ERP antes ou fora desta ferramenta.
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-mono text-sm text-muted-foreground">
                          − {formatCurrency(externalPaid, invoice.currency)}
                        </p>
                      </div>
                    </div>
                    <ResidualBar
                      residual={restaExt}
                      total={invoice.docTotal}
                      currency={invoice.currency}
                      muted
                    />
                  </div>
                );
              })()}

              {timeline.map(({ baixa, residualAfter }, idx) => {
                const userLabel =
                  baixa.criado_por_nome || baixa.criado_por_user_code || null;
                return (
                <div
                  key={(baixa.id || `sap-${baixa.sap_incoming_payment_doc_entry}`) + "-" + idx}
                  className={`rounded-md border px-3 py-2 ${
                    baixa.origin === "external"
                      ? "border-dashed border-border/60 bg-muted/10"
                      : "border-border/60 bg-card"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-start gap-2 min-w-0">
                      <BaixaStatusIcon status={baixa.status} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium flex items-center gap-1.5 flex-wrap">
                          Baixa #{idx + 1} em {formatDate(baixa.data_recebimento)}
                          <span className="text-[11px] font-normal text-muted-foreground">
                            às {formatTime(baixa.created_at)}
                          </span>
                          {baixa.origin === "internal" && baixa.id && (
                            <Link
                              to={`/vendas/historico?baixa=${baixa.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-0.5 text-[10px] font-medium text-primary hover:underline"
                              title="Abrir baixa no histórico"
                            >
                              abrir <ExternalLink className="w-3 h-3" />
                            </Link>
                          )}
                          {baixa.origin === "external" && (
                            <Badge variant="outline" className="text-[9px] border-border/60 text-muted-foreground">
                              fora do ERP Flow
                            </Badge>
                          )}
                        </p>
                        <p className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
                          <BaixaStatusLabel status={baixa.status} />
                          {baixa.sap_incoming_payment_doc_entry ? (
                            <span className="font-mono">
                              SAP #{baixa.sap_incoming_payment_doc_entry}
                            </span>
                          ) : (
                            <span className="italic">SAP DocEntry pendente</span>
                          )}
                          {userLabel && (
                            <span
                              className="inline-flex items-center gap-1"
                              title={baixa.criado_por_user_code || undefined}
                            >
                              <span className="uppercase tracking-wider text-[9px] opacity-70">Usuário</span>
                              <span className="font-medium text-foreground/80">{userLabel}</span>
                            </span>
                          )}
                          {baixa.valor_juros_multa > 0 && (
                            <span className="text-amber-500">
                              + {formatCurrency(baixa.valor_juros_multa, invoice.currency)} juros/multa
                            </span>
                          )}
                        </p>
                      </div>

                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Valor baixado</p>
                      <p className="font-mono text-sm font-semibold">
                        − {formatCurrency(baixa.valor_baixado, invoice.currency)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
                      Saldo residual após esta baixa
                    </span>
                  </div>
                  <ResidualBar
                    residual={residualAfter}
                    total={invoice.docTotal}
                    currency={invoice.currency}
                  />
                </div>
                );
              })}



              {baixas.length > 0 && finalResidual === 0 && (
                <div className="flex items-center gap-2 text-xs text-emerald-500 pt-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> NF totalmente baixada.
                </div>
              )}
            </FlowSection>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FlowSection({
  title,
  icon,
  children,
  empty,
  emptyText,
}: {
  title: string;
  icon: React.ReactNode;
  children?: React.ReactNode;
  empty?: boolean;
  emptyText?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
        {icon}
        {title}
      </div>
      <div className="space-y-1.5">
        {empty ? (
          <div className="rounded-md border border-dashed border-border/60 px-3 py-3 text-xs text-muted-foreground">
            {emptyText || "Sem registros."}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function FlowArrow() {
  return (
    <div className="flex justify-center text-muted-foreground/60">
      <ArrowDown className="w-4 h-4" />
    </div>
  );
}

function ResidualBar({
  residual,
  total,
  currency,
  muted = false,
}: {
  residual: number;
  total: number;
  currency: string;
  muted?: boolean;
}) {
  const safeTotal = total > 0 ? total : 1;
  const pctResidual = Math.max(0, Math.min(100, (residual / safeTotal) * 100));
  const pctPaid = 100 - pctResidual;
  const settled = residual <= 0.005;

  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="relative h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-all ${
            muted
              ? "bg-muted-foreground/40"
              : settled
                ? "bg-emerald-500"
                : "bg-primary"
          }`}
          style={{ width: `${pctPaid}%` }}
        />
      </div>
      <div
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-mono shrink-0 ${
          muted
            ? "border-border/60 bg-muted/30 text-muted-foreground"
            : settled
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
              : "border-primary/40 bg-primary/10 text-primary"
        }`}
        title={`Saldo residual após este evento · ${pctResidual.toFixed(1)}% do total`}
      >
        {settled ? (
          <>
            <CheckCircle2 className="w-3 h-3" />
            quitado
          </>
        ) : (
          <>
            <span className="uppercase tracking-wider text-[9px] opacity-70">resta</span>
            {formatCurrency(residual, currency)}
          </>
        )}
      </div>
    </div>
  );
}


function BaixaStatusIcon({ status }: { status: string }) {
  if (status === "sincronizado") return <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-emerald-500" />;
  if (status === "erro") return <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-destructive" />;
  return <Clock className="w-3.5 h-3.5 mt-0.5 text-amber-500" />;
}

function BaixaStatusLabel({ status }: { status: string }) {
  if (status === "sincronizado")
    return (
      <Badge variant="outline" className="border-emerald-500/40 text-emerald-500 text-[10px]">
        Sincronizada
      </Badge>
    );
  if (status === "erro")
    return (
      <Badge variant="outline" className="border-destructive/40 text-destructive text-[10px]">
        Com erro
      </Badge>
    );
  return (
    <Badge variant="outline" className="border-amber-500/40 text-amber-500 text-[10px]">
      Pendente
    </Badge>
  );
}

function IdBadge({ label, value, short = false }: { label: string; value: string; short?: boolean }) {
  const display = short && value.length > 10 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value;
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          toast.success(`${label} copiado`, { description: value });
        } catch {
          window.prompt(`Copie o ${label}:`, value);
        }
      }}
      className="inline-flex items-center gap-1 rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground hover:border-border transition-colors"
      title={`${label}: ${value} · clique para copiar`}
    >
      <span className="uppercase tracking-wider text-[9px] opacity-70">{label}</span>
      {display}
      <Copy className="w-2.5 h-2.5 opacity-60" />
    </button>
  );
}

function MapSkeleton() {
  return (
    <div className="space-y-3 mt-2" aria-busy="true" aria-label="Carregando mapa de relações">
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-3 w-32" />
          <div className="space-y-1.5">
            <Skeleton className="h-14 w-full rounded-md" />
            {i === 2 && <Skeleton className="h-14 w-full rounded-md" />}
          </div>
          {i < 2 && (
            <div className="flex justify-center py-1">
              <Skeleton className="h-4 w-4 rounded-full" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-4 flex flex-col items-center text-center gap-2">
      <ServerCrash className="w-6 h-6 text-destructive" />
      <p className="text-sm font-medium text-destructive">Não foi possível carregar o mapa de relações.</p>
      <p className="text-xs text-muted-foreground max-w-md break-words">{message}</p>
      <Button size="sm" variant="outline" className="gap-1.5 mt-1" onClick={onRetry}>
        <RefreshCw className="w-3.5 h-3.5" /> Tentar novamente
      </Button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-4 rounded-md border border-dashed border-border/60 p-6 flex flex-col items-center text-center gap-2">
      <Inbox className="w-6 h-6 text-muted-foreground" />
      <p className="text-sm font-medium">Nenhum vínculo encontrado.</p>
      <p className="text-xs text-muted-foreground max-w-md">
        Esta NF ainda não possui pedidos de venda vinculados nem baixas registradas.
      </p>
    </div>
  );
}

