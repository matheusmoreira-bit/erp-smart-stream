import { useCallback, useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link, Navigate } from "react-router-dom";
import { useModuleAccess } from "@/hooks/usePermissions";
import {
  RefreshCw,
  Loader2,
  Search,
  History,
  ArrowLeft,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";
import { syncBaixaRecebimentoToSap } from "@/lib/baixa-recebimento-sync";

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

function formatDateTime(dateStr?: string | null) {
  if (!dateStr) return "—";
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

type StatusFilter = "todos" | "pendente_sincronizacao" | "sincronizado" | "erro";

interface BaixaItem {
  invoice_doc_entry: number;
  invoice_doc_num: string | null;
  valor_baixado: number;
}

interface BaixaRow {
  id: string;
  company_db: string;
  card_code: string;
  card_name: string;
  data_recebimento: string;
  conta_contabil_codigo: string;
  conta_contabil_nome: string;
  valor_total: number;
  valor_juros_multa: number;
  status: string;
  sap_incoming_payment_doc_entry: number | null;
  sap_error_message: string | null;
  criado_por: string | null;
  created_at: string;
  updated_at: string;
  itens: BaixaItem[];
}

function StatusBadge({ status }: { status: string }) {
  if (status === "sincronizado") {
    return (
      <Badge variant="outline" className="border-emerald-500/40 text-emerald-500 gap-1 text-[10px]">
        <CheckCircle2 className="w-3 h-3" /> Sincronizado
      </Badge>
    );
  }
  if (status === "erro") {
    return (
      <Badge variant="outline" className="border-destructive/40 text-destructive gap-1 text-[10px]">
        <AlertTriangle className="w-3 h-3" /> Erro
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-amber-500/40 text-amber-500 gap-1 text-[10px]">
      <Clock className="w-3 h-3" /> Pendente
    </Badge>
  );
}

/* ─────────────────────────── Page ─────────────────────────── */

export default function BaixasHistoryPage() {
  const { session } = useSap();
  const companyDb = session?.companyDB || null;
  const isSap = session?.erpType === "sap";

  const [rows, setRows] = useState<BaixaRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<StatusFilter>("todos");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyDb) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const { data: baixas, error } = await supabase
        .from("baixas_recebimento")
        .select("*")
        .eq("company_db", companyDb)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);

      const baixaIds = (baixas || []).map((b) => b.id);
      const { data: itens } = baixaIds.length
        ? await supabase
            .from("baixas_recebimento_itens")
            .select("baixa_id,invoice_doc_entry,invoice_doc_num,valor_baixado")
            .in("baixa_id", baixaIds)
        : { data: [] as Array<BaixaItem & { baixa_id: string }> };

      const itensMap = new Map<string, BaixaItem[]>();
      for (const it of (itens || []) as Array<BaixaItem & { baixa_id: string }>) {
        const arr = itensMap.get(it.baixa_id) || [];
        arr.push({
          invoice_doc_entry: Number(it.invoice_doc_entry),
          invoice_doc_num: it.invoice_doc_num,
          valor_baixado: Number(it.valor_baixado),
        });
        itensMap.set(it.baixa_id, arr);
      }

      setRows(
        (baixas || []).map((b) => ({
          ...(b as unknown as BaixaRow),
          itens: itensMap.get(b.id) || [],
        })),
      );
    } catch (e) {
      toast.error((e as Error).message || "Falha ao carregar histórico");
    } finally {
      setLoading(false);
    }
  }, [companyDb]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "todos" && r.status !== status) return false;
      if (!q) return true;
      return (
        r.card_name?.toLowerCase().includes(q) ||
        r.card_code?.toLowerCase().includes(q) ||
        String(r.sap_incoming_payment_doc_entry || "").includes(q)
      );
    });
  }, [rows, status, search]);

  const counts = useMemo(() => {
    const c = { total: rows.length, pendente: 0, sincronizado: 0, erro: 0 };
    for (const r of rows) {
      if (r.status === "sincronizado") c.sincronizado += 1;
      else if (r.status === "erro") c.erro += 1;
      else c.pendente += 1;
    }
    return c;
  }, [rows]);

  async function handleRetry(baixaId: string) {
    if (!session) {
      toast.error("Sessão SAP indisponível.");
      return;
    }
    setRetryingId(baixaId);
    try {
      const res = await syncBaixaRecebimentoToSap(session, baixaId);
      if (res.ok) {
        toast.success(
          `Sincronizado com sucesso${res.sapDocEntry ? ` · IncomingPayment #${res.sapDocEntry}` : ""}`,
        );
      } else {
        toast.error(res.errorMessage || "SAP recusou o reenvio.");
      }
      await load();
    } finally {
      setRetryingId(null);
    }
  }

  if (!isSap) {
    return (
      <div className="min-h-screen bg-background text-foreground p-6">
        <div className="max-w-2xl mx-auto rounded-lg border border-border p-6 space-y-2">
          <h1 className="text-lg font-semibold">Histórico de baixas</h1>
          <p className="text-sm text-muted-foreground">
            Disponível apenas para bases SAP.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Helmet>
        <title>Histórico de baixas — Vendas</title>
      </Helmet>

      <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="sm" className="gap-1.5">
              <Link to="/vendas">
                <ArrowLeft className="w-3.5 h-3.5" />
                Voltar
              </Link>
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <History className="w-5 h-5 text-primary" />
                Histórico de baixas de recebimento
              </h1>
              <p className="text-xs text-muted-foreground">
                Base: <span className="font-mono">{companyDb}</span> · reenvia ao SAP as baixas com erro ou pendentes.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="gap-1.5">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Atualizar
          </Button>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <SummaryCard label="Total" value={counts.total} />
          <SummaryCard label="Sincronizadas" value={counts.sincronizado} tone="emerald" />
          <SummaryCard label="Pendentes" value={counts.pendente} tone="amber" />
          <SummaryCard label="Com erro" value={counts.erro} tone="destructive" />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-muted/20 p-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cliente, código ou nº IncomingPayment"
              className="pl-8 h-9 text-sm"
            />
          </div>
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <SelectTrigger className="w-[200px] h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os status</SelectItem>
              <SelectItem value="sincronizado">Sincronizadas</SelectItem>
              <SelectItem value="pendente_sincronizacao">Pendentes</SelectItem>
              <SelectItem value="erro">Com erro</SelectItem>
            </SelectContent>
          </Select>
          <div className="ml-auto text-xs text-muted-foreground">
            {filtered.length} baixa(s)
          </div>
        </div>

        {/* List */}
        {loading && rows.length === 0 ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Nenhuma baixa encontrada.
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((r) => {
              const isOpen = !!expanded[r.id];
              const canRetry = r.status !== "sincronizado";
              return (
                <div key={r.id} className="rounded-lg border border-border overflow-hidden bg-card">
                  <div className="flex flex-wrap items-center gap-3 px-3 py-2.5 hover:bg-muted/20 transition-colors">
                    <button
                      type="button"
                      onClick={() => setExpanded((p) => ({ ...p, [r.id]: !p[r.id] }))}
                      className="p-1"
                      aria-label={isOpen ? "Recolher" : "Expandir"}
                    >
                      {isOpen ? (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{r.card_name}</p>
                      <p className="text-[11px] text-muted-foreground font-mono truncate">
                        {r.card_code} · Recebido em {formatDate(r.data_recebimento)} · {r.itens.length} NF(s)
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono font-semibold text-sm">
                        {formatCurrency(r.valor_total)}
                      </p>
                      {r.valor_juros_multa > 0 && (
                        <p className="text-[10px] text-amber-500">
                          + {formatCurrency(r.valor_juros_multa)} juros/multa
                        </p>
                      )}
                    </div>
                    <StatusBadge status={r.status} />
                    {r.sap_incoming_payment_doc_entry && (
                      <Badge variant="outline" className="text-[10px] font-mono">
                        SAP #{r.sap_incoming_payment_doc_entry}
                      </Badge>
                    )}
                    {canRetry && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleRetry(r.id)}
                        disabled={retryingId === r.id}
                        className="gap-1.5"
                      >
                        {retryingId === r.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5" />
                        )}
                        Reenviar
                      </Button>
                    )}
                  </div>

                  {isOpen && (
                    <div className="border-t border-border/60 bg-muted/10 p-3 space-y-3 text-xs">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                        <div>
                          <span className="text-muted-foreground">Criada em:</span>{" "}
                          {formatDateTime(r.created_at)}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Atualizada em:</span>{" "}
                          {formatDateTime(r.updated_at)}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Conta contábil:</span>{" "}
                          <span className="font-mono">{r.conta_contabil_codigo}</span> — {r.conta_contabil_nome}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Base:</span>{" "}
                          <span className="font-mono">{r.company_db}</span>
                        </div>
                      </div>

                      {r.sap_error_message && (
                        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-destructive">
                          <p className="font-medium flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> Erro do SAP
                          </p>
                          <p className="mt-0.5 whitespace-pre-wrap break-words">{r.sap_error_message}</p>
                        </div>
                      )}

                      <div className="rounded-md border border-border overflow-hidden">
                        <table className="w-full">
                          <thead>
                            <tr className="bg-muted/30 border-b border-border/60 text-muted-foreground">
                              <th className="text-left py-1.5 px-2">Nº NF</th>
                              <th className="text-left py-1.5 px-2">DocEntry</th>
                              <th className="text-right py-1.5 px-2">Valor baixado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.itens.map((it) => (
                              <tr
                                key={`${r.id}-${it.invoice_doc_entry}`}
                                className="border-b border-border/40"
                              >
                                <td className="py-1.5 px-2 font-mono">{it.invoice_doc_num || "—"}</td>
                                <td className="py-1.5 px-2 font-mono text-muted-foreground">
                                  {it.invoice_doc_entry}
                                </td>
                                <td className="py-1.5 px-2 text-right font-mono">
                                  {formatCurrency(it.valor_baixado)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "emerald" | "amber" | "destructive";
}) {
  const color =
    tone === "emerald"
      ? "text-emerald-500"
      : tone === "amber"
        ? "text-amber-500"
        : tone === "destructive"
          ? "text-destructive"
          : "text-foreground";
  return (
    <div className="rounded-lg border border-border/60 bg-card p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-2xl font-semibold font-mono ${color}`}>{value}</p>
    </div>
  );
}
