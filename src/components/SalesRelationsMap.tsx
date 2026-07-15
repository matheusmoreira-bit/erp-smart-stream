import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FileText,
  Receipt,
  Wallet,
  Loader2,
  ArrowDown,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Info,
  Download,
  FileDown,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { sapQueryAll } from "@/lib/sap-client";
import type { SapSession } from "@/lib/sap-client";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";


interface Props {
  open: boolean;
  onClose: () => void;
  session: SapSession | null;
  invoice: {
    docEntry: number;
    docNum: number;
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
  id: string;
  data_recebimento: string;
  valor_baixado: number;
  valor_juros_multa: number;
  status: string;
  sap_incoming_payment_doc_entry: number | null;
  created_at: string;
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

export function SalesRelationsMap({ open, onClose, session, invoice }: Props) {
  const [orders, setOrders] = useState<SalesOrderRef[]>([]);
  const [baixas, setBaixas] = useState<BaixaEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !invoice || !session) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
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

        // 2) Baixas registradas no Lovable para esta NF
        const { data: itens } = await supabase
          .from("baixas_recebimento_itens")
          .select(
            "valor_baixado, baixa_id, baixas_recebimento!inner(id,data_recebimento,valor_juros_multa,status,sap_incoming_payment_doc_entry,created_at,company_db)",
          )
          .eq("invoice_doc_entry", invoice.docEntry)
          .eq("baixas_recebimento.company_db", session.companyDB);

        const baixaRows: BaixaEntry[] = ((itens || []) as Array<{
          valor_baixado: number;
          baixas_recebimento: {
            id: string;
            data_recebimento: string;
            valor_juros_multa: number;
            status: string;
            sap_incoming_payment_doc_entry: number | null;
            created_at: string;
          };
        }>).map((it) => ({
          id: it.baixas_recebimento.id,
          data_recebimento: it.baixas_recebimento.data_recebimento,
          valor_baixado: Number(it.valor_baixado || 0),
          valor_juros_multa: Number(it.baixas_recebimento.valor_juros_multa || 0),
          status: it.baixas_recebimento.status,
          sap_incoming_payment_doc_entry: it.baixas_recebimento.sap_incoming_payment_doc_entry,
          created_at: it.baixas_recebimento.created_at,
        }));

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
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, invoice, session]);

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

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-primary" />
            Mapa de relações — NF #{invoice.docNum}
          </DialogTitle>
          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
            <span>{invoice.cardName}</span>
            <span className="font-mono">{invoice.cardCode}</span>
            <span>Emitida em {formatDate(invoice.docDate)}</span>
            <span className="font-mono">{formatCurrency(invoice.docTotal, invoice.currency)}</span>
          </div>
        </DialogHeader>

        {loading ? (
          <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Carregando fluxo…
          </div>
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
                  className="flex items-center justify-between rounded-md border border-border/60 bg-muted/20 px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium">Pedido #{o.docNum ?? o.docEntry}</p>
                    <p className="text-[11px] text-muted-foreground">
                      Emitido em {formatDate(o.docDate)}
                    </p>
                  </div>
                  {o.docTotal != null && (
                    <span className="font-mono text-sm">
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
                  <div>
                    <p className="text-sm font-semibold">NF #{invoice.docNum}</p>
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

              {timeline.map(({ baixa, residualAfter }, idx) => (
                <div
                  key={baixa.id + "-" + idx}
                  className="rounded-md border border-border/60 bg-card px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-start gap-2 min-w-0">
                      <BaixaStatusIcon status={baixa.status} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          Baixa em {formatDate(baixa.data_recebimento)}
                        </p>
                        <p className="text-[11px] text-muted-foreground flex flex-wrap gap-x-2">
                          <BaixaStatusLabel status={baixa.status} />
                          {baixa.sap_incoming_payment_doc_entry && (
                            <span className="font-mono">
                              SAP #{baixa.sap_incoming_payment_doc_entry}
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
                      <p className="font-mono text-sm font-semibold">
                        − {formatCurrency(baixa.valor_baixado, invoice.currency)}
                      </p>
                    </div>
                  </div>
                  <ResidualBar
                    residual={residualAfter}
                    total={invoice.docTotal}
                    currency={invoice.currency}
                  />
                </div>
              ))}


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
