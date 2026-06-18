import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useSap } from "@/contexts/SapContext";
import { useAdvancePayments, ADVANCE_STATUS_LABELS, ADVANCE_STATUS_COLORS, type AdvancePayment } from "@/hooks/useAdvancePayments";
import { CreateAdvanceModal } from "@/components/CreateAdvanceModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Plus, RefreshCw, Search, Loader2, CheckCircle2, XCircle, RotateCw, Trash2 } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { toast } from "sonner";

function fmtCurrency(v: number, ccy: string = "BRL") {
  const code = /^[A-Z]{3}$/.test(ccy) ? ccy : "BRL";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(v);
}
function fmtDate(s?: string | null) {
  if (!s) return "—";
  try {
    return new Intl.DateTimeFormat("pt-BR").format(new Date(s));
  } catch {
    return s;
  }
}

export default function AdvancePayments() {
  const navigate = useNavigate();
  const { session } = useSap();
  const { items, loading, error, refresh, approve, reject, retry, remove } = useAdvancePayments();
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.supplier_name.toLowerCase().includes(q) ||
        i.supplier_card_code.toLowerCase().includes(q) ||
        (i.supplier_cnpj || "").toLowerCase().includes(q) ||
        (i.requester_name || "").toLowerCase().includes(q),
    );
  }, [items, search]);

  const handleApprove = async (a: AdvancePayment) => {
    setBusyId(a.id);
    try {
      await approve(a.id);
      toast.success("Adiantamento aprovado e enviado ao SAP");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na integração SAP");
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (a: AdvancePayment) => {
    const reason = window.prompt("Motivo da rejeição:")?.trim();
    if (!reason) return;
    setBusyId(a.id);
    try {
      await reject(a.id, reason);
      toast.success("Adiantamento rejeitado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setBusyId(null);
    }
  };

  const handleRetry = async (a: AdvancePayment) => {
    setBusyId(a.id);
    try {
      await retry(a.id);
      toast.success("Reintegrado com sucesso");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (a: AdvancePayment) => {
    if (!window.confirm("Excluir este rascunho?")) return;
    try {
      await remove(a.id);
      toast.success("Removido");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4 sticky top-0 z-20 bg-background/95 backdrop-blur">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/")} className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-lg font-bold text-foreground">Adiantamentos a Fornecedor</h1>
              <p className="text-xs text-muted-foreground">{session?.companyDB}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={refresh}>
              <RefreshCw className="w-4 h-4 mr-1" /> Atualizar
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-1" /> Novo
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por fornecedor, CNPJ, solicitante…"
              className="pl-9"
            />
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando…
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}

        {!loading && filtered.length === 0 && (
          <div className="text-center py-16 text-muted-foreground text-sm">
            Nenhum adiantamento encontrado. Clique em <strong>Novo</strong> para criar.
          </div>
        )}

        <div className="space-y-3">
          {filtered.map((a) => (
            <div key={a.id} className="glass-card p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-foreground">{a.supplier_name}</span>
                    <span className="text-xs text-muted-foreground">
                      {a.supplier_card_code}
                      {a.supplier_cnpj && ` · CNPJ ${a.supplier_cnpj}`}
                    </span>
                    <Badge className={ADVANCE_STATUS_COLORS[a.status]}>{ADVANCE_STATUS_LABELS[a.status]}</Badge>
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                    <span className="font-mono text-foreground">{fmtCurrency(a.amount, a.currency)}</span>
                    <span>Vence: {fmtDate(a.due_date)}</span>
                    <span>Solicitante: {a.requester_name || "—"}</span>
                    {(a.sap_doc_num || a.sap_doc_entry) && (
                      <span className="text-success">SAP: #{a.sap_doc_num || a.sap_doc_entry}</span>
                    )}
                  </div>
                  {a.remarks && <p className="text-xs text-muted-foreground mt-2">{a.remarks}</p>}
                  {a.sap_integration_error && (
                    <p className="text-xs text-destructive mt-2">Erro SAP: {a.sap_integration_error}</p>
                  )}
                  {a.rejection_reason && (
                    <p className="text-xs text-destructive mt-2">Rejeitado: {a.rejection_reason}</p>
                  )}
                  {a.attachments && a.attachments.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">{a.attachments.length} anexo(s)</p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {a.status === "pending" && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => handleApprove(a)} disabled={busyId === a.id}>
                        {busyId === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleReject(a)} disabled={busyId === a.id}>
                        <XCircle className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                  {a.status === "failed" && (
                    <Button size="sm" variant="outline" onClick={() => handleRetry(a)} disabled={busyId === a.id}>
                      {busyId === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
                    </Button>
                  )}
                  {a.status === "draft" && (
                    <Button size="sm" variant="outline" onClick={() => handleDelete(a)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>

      <CreateAdvanceModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
