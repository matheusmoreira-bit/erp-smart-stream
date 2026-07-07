import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageTitle } from "@/components/PageTitle";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { RefreshCw, Play } from "lucide-react";

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

  const run = async (mode: "listed" | "all") => {
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

  return (
    <div className="container max-w-5xl py-8 space-y-6">
      <PageTitle title="Sincronia de Status SAP" />

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
    </div>
  );
}
