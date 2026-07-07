import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageTitle } from "@/components/PageTitle";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { RefreshCw, Play, AlertTriangle } from "lucide-react";

const DEFAULT_IDS = [
  "fe1df950-9751-4c33-86c9-1789251007ce",
  "f534a1f2-03ca-4f65-b87e-a5c43f99e5ee",
].join("\n");

interface SyncResult {
  id: string;
  docEntry?: number;
  poStatus?: string;
  expenseStatus?: string;
  error?: string;
  attempts?: number;
  nextRetryAt?: string | null;
}

interface FailingExpense {
  id: string;
  supplier_name: string;
  sap_doc_entry: number | null;
  company_db: string;
  sap_sync_attempts: number;
  sap_sync_next_retry_at: string | null;
  sap_integration_error: string | null;
  sap_integration_last_attempt_at: string | null;
}

interface SyncResponse {
  ok: boolean;
  runId?: string;
  processed?: number;
  results?: SyncResult[];
  error?: string;
}

function poBadge(status?: string) {
  if (!status) return <Badge variant="outline">—</Badge>;
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    open: { label: "Aberto", variant: "default" },
    closed: { label: "Fechado", variant: "secondary" },
    cancelled: { label: "Cancelado", variant: "destructive" },
    not_found: { label: "Não encontrado", variant: "destructive" },
  };
  const cfg = map[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

export default function SapStatusSync() {
  const [idsText, setIdsText] = useState(DEFAULT_IDS);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<SyncResponse | null>(null);
  const [failing, setFailing] = useState<FailingExpense[]>([]);

  const loadFailing = useCallback(async () => {
    const { data, error } = await supabase
      .from("expenses")
      .select("id, supplier_name, sap_doc_entry, company_db, sap_sync_attempts, sap_sync_next_retry_at, sap_integration_error, sap_integration_last_attempt_at")
      .eq("sap_sync_state", "sync_error")
      .order("sap_sync_attempts", { ascending: false })
      .limit(100);
    if (error) {
      toast.error(`Falha ao ler pendências: ${error.message}`);
      return;
    }
    setFailing((data ?? []) as FailingExpense[]);
  }, []);

  useEffect(() => { void loadFailing(); }, [loadFailing]);

  const run = async (mode: "listed" | "all" | "retry-errors") => {
    setLoading(true);
    setResponse(null);
    try {
      const body: Record<string, unknown> = {};
      if (mode === "listed") {
        const ids = idsText.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
        if (!ids.length) {
          toast.error("Informe ao menos um ID de despesa");
          setLoading(false);
          return;
        }
        body.expenseIds = ids;
      } else if (mode === "retry-errors") {
        if (!failing.length) {
          toast.info("Nenhuma despesa em sync_error");
          setLoading(false);
          return;
        }
        body.expenseIds = failing.map((f) => f.id);
      }
      const { data, error } = await supabase.functions.invoke("expense-sap-status-sync", { body });
      if (error) throw error;
      setResponse(data as SyncResponse);
      const d = data as SyncResponse;
      if (d?.ok) {
        toast.success(`Sincronia concluída — ${d.processed ?? 0} despesa(s) processada(s)`);
      } else {
        toast.error(d?.error || "Falha na sincronia");
      }
      await loadFailing();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
      setResponse({ ok: false, error: msg });
    } finally {
      setLoading(false);
    }
  };

  const results = response?.results ?? [];
  const errors = results.filter((r) => r.error);
  const updated = results.filter((r) => r.expenseStatus);

  const fmtDate = (v: string | null | undefined) =>
    v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";


  return (
    <div className="container max-w-5xl py-8 space-y-6">
      <div className="flex items-center justify-between">
        <PageTitle title="Sincronia de Status SAP" />
        <a
          href="/backoffice/sap-sync/execucoes"
          className="text-sm text-primary hover:underline"
        >
          Ver histórico de execuções →
        </a>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Forçar sincronização imediata</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ids">IDs das despesas (um por linha, vírgula ou espaço)</Label>
            <Textarea
              id="ids"
              value={idsText}
              onChange={(e) => setIdsText(e.target.value)}
              rows={5}
              className="font-mono text-xs"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => run("listed")} disabled={loading}>
              <Play className="mr-2 h-4 w-4" />
              Sincronizar IDs listados
            </Button>
            <Button variant="outline" onClick={() => run("all")} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Sincronizar todas pendentes
            </Button>
          </div>
        </CardContent>
      </Card>

      {response && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-3">
              Resultado
              {response.runId && (
                <span className="text-xs font-mono text-muted-foreground">run {response.runId.slice(0, 8)}</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2 flex-wrap text-sm">
              <Badge variant={response.ok ? "default" : "destructive"}>
                {response.ok ? "OK" : "Erro"}
              </Badge>
              <Badge variant="secondary">{results.length} processada(s)</Badge>
              <Badge variant="secondary">{updated.length} atualizada(s)</Badge>
              {errors.length > 0 && <Badge variant="destructive">{errors.length} erro(s)</Badge>}
            </div>

            {response.error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                {response.error}
              </div>
            )}

            {results.length > 0 && (
              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Expense ID</TableHead>
                      <TableHead>DocEntry</TableHead>
                      <TableHead>Status PO</TableHead>
                      <TableHead>Novo status despesa</TableHead>
                      <TableHead>Tentativas</TableHead>
                      <TableHead>Próx. retry</TableHead>
                      <TableHead>Erro</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">{r.id.slice(0, 8)}…</TableCell>
                        <TableCell>{r.docEntry ?? "—"}</TableCell>
                        <TableCell>{poBadge(r.poStatus)}</TableCell>
                        <TableCell>{r.expenseStatus ?? <span className="text-muted-foreground">sem mudança</span>}</TableCell>
                        <TableCell>{r.attempts ?? "—"}</TableCell>
                        <TableCell className="text-xs">{fmtDate(r.nextRetryAt)}</TableCell>
                        <TableCell className="text-destructive text-xs">{r.error ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            Despesas em sync_error
            <Badge variant="secondary">{failing.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => void loadFailing()} disabled={loading}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Recarregar
            </Button>
            <Button size="sm" onClick={() => run("retry-errors")} disabled={loading || !failing.length}>
              <Play className="mr-2 h-4 w-4" />
              Reprocessar todas ({failing.length})
            </Button>
          </div>

          {failing.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma despesa com falha de sincronia.</p>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead>DocEntry</TableHead>
                    <TableHead>Base</TableHead>
                    <TableHead>Tentativas</TableHead>
                    <TableHead>Última tentativa</TableHead>
                    <TableHead>Próx. retry</TableHead>
                    <TableHead>Erro</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {failing.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell className="text-xs">{f.supplier_name}</TableCell>
                      <TableCell>{f.sap_doc_entry ?? "—"}</TableCell>
                      <TableCell className="text-xs">{f.company_db}</TableCell>
                      <TableCell>
                        <Badge variant={f.sap_sync_attempts >= 8 ? "destructive" : "secondary"}>
                          {f.sap_sync_attempts}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{fmtDate(f.sap_integration_last_attempt_at)}</TableCell>
                      <TableCell className="text-xs">
                        {f.sap_sync_next_retry_at ? fmtDate(f.sap_sync_next_retry_at) : <span className="text-destructive">desistiu</span>}
                      </TableCell>
                      <TableCell className="text-destructive text-xs max-w-[280px] truncate" title={f.sap_integration_error ?? ""}>
                        {f.sap_integration_error ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
