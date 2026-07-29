import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Scale } from "lucide-react";
import { toast } from "sonner";
import { sapFunctionFetch } from "@/lib/auth-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface ErpNota {
  doc_entry: number;
  doc_num: number | null;
  nfse: string | null;
  rps: string | null;
  serie: string | null;
  data_emissao: string;
  valor: number;
  cliente_nome: string | null;
}

interface MtNota {
  numero: string;
  serie: string | null;
  valor: number;
  data_emissao: string;
  tomador_nome: string | null;
}

interface ReconcileResult {
  totais: {
    erp: number;
    mastertax: number;
    conciliado: number;
    somente_erp: number;
    somente_mastertax: number;
  };
  mastertax_disponivel: boolean;
  mastertax_aviso: string | null;
  nfse_lookup_indisponivel: boolean;
  somente_erp: ErpNota[];
  somente_mastertax: MtNota[];
}

function fmtMoney(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
}

function fmtDate(v?: string | null) {
  if (!v) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
}

function firstDayOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * Conferência das NFS-e emitidas: o ERP (SAP/TaxOne) é a fonte de verdade e a
 * Master Tax entra apenas como segunda opinião, apontando notas que existem de
 * um lado e não do outro.
 */
export function NfseReconcilePanel({ companyDb }: { companyDb: string }) {
  const [open, setOpen] = useState(false);
  const [inicio, setInicio] = useState(firstDayOfMonth());
  const [fim, setFim] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ReconcileResult | null>(null);

  const run = useCallback(async () => {
    if (!companyDb) return;
    setLoading(true);
    setResult(null);
    try {
      const resp = await sapFunctionFetch("sales-nfse-reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_db: companyDb, periodo_inicio: inicio, periodo_fim: fim }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || `Falha na conferência (${resp.status})`);
      setResult(data as ReconcileResult);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro na conferência fiscal");
    } finally {
      setLoading(false);
    }
  }, [companyDb, inicio, fim]);

  const divergencias = useMemo(
    () => (result ? result.totais.somente_erp + result.totais.somente_mastertax : 0),
    [result],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Scale className="w-4 h-4" />
          Conferência fiscal
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Conferência de NFS-e emitidas</DialogTitle>
          <DialogDescription>
            O ERP (SAP/TaxOne) é a fonte de verdade. A Master Tax é usada só como conferência, para
            apontar notas emitidas que não constam no ERP — e vice-versa.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="rec-ini" className="text-xs">Início</Label>
            <Input id="rec-ini" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rec-fim" className="text-xs">Fim</Label>
            <Input id="rec-fim" type="date" value={fim} onChange={(e) => setFim(e.target.value)} className="h-9" />
          </div>
          <Button size="sm" onClick={() => void run()} disabled={loading || !companyDb} className="gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scale className="w-4 h-4" />}
            Conferir período
          </Button>
        </div>

        {result && (
          <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              {[
                { label: "Notas no ERP", value: result.totais.erp },
                { label: "Notas Master Tax", value: result.totais.mastertax },
                { label: "Conciliadas", value: result.totais.conciliado },
                { label: "Divergências", value: divergencias },
              ].map((c) => (
                <div key={c.label} className="rounded-lg border border-border/60 bg-muted/20 p-3">
                  <div className="text-lg font-semibold">{c.value}</div>
                  <div className="text-[11px] text-muted-foreground">{c.label}</div>
                </div>
              ))}
            </div>

            {!result.mastertax_disponivel && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  Master Tax não configurada para esta empresa — a conferência mostra apenas o que
                  está no ERP.
                </span>
              </div>
            )}
            {result.mastertax_aviso && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
                {result.mastertax_aviso}
              </div>
            )}
            {result.nfse_lookup_indisponivel && (
              <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
                Números oficiais de NFS-e (TaxOne) indisponíveis nesta base — o casamento usou valor
                e data.
              </div>
            )}

            <section className="space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-destructive" />
                No ERP, sem correspondência na Master Tax ({result.somente_erp.length})
              </h3>
              {result.somente_erp.length === 0 ? (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Nenhuma divergência.
                </p>
              ) : (
                <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
                  {result.somente_erp.map((n) => (
                    <li key={n.doc_entry} className="flex flex-wrap items-center gap-2 p-2 text-xs">
                      <Badge variant="outline">NFS-e {n.nfse || `RPS ${n.rps || "—"}`}</Badge>
                      <span className="font-medium">{n.cliente_nome || "—"}</span>
                      <span className="text-muted-foreground">{fmtDate(n.data_emissao)}</span>
                      <span className="ml-auto font-medium">{fmtMoney(n.valor)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                Na Master Tax, sem correspondência no ERP ({result.somente_mastertax.length})
              </h3>
              {result.somente_mastertax.length === 0 ? (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Nenhuma divergência.
                </p>
              ) : (
                <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
                  {result.somente_mastertax.map((n, i) => (
                    <li key={`${n.numero}-${i}`} className="flex flex-wrap items-center gap-2 p-2 text-xs">
                      <Badge variant="outline">NFS-e {n.numero}</Badge>
                      <span className="font-medium">{n.tomador_nome || "—"}</span>
                      <span className="text-muted-foreground">{fmtDate(n.data_emissao)}</span>
                      <span className="ml-auto font-medium">{fmtMoney(n.valor)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default NfseReconcilePanel;
