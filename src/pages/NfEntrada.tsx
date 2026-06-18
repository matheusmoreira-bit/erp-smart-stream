import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, FileText, FileCode2, History, RefreshCw, XCircle, Download, RotateCw, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  useNfEntrada, fetchNfEntradaLogs, getSignedFileUrl,
  type NfEntradaImport, type NfEntradaLog, type NfEntradaStatus,
} from "@/hooks/useNfEntrada";

const STATUS_LABELS: Record<NfEntradaStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending_expense: { label: "Pendente despesa", variant: "outline" },
  awaiting_erpflow_approval: { label: "Aguardando aprovação ERP Flow", variant: "secondary" },
  erpflow_rejected: { label: "Reprovado ERP Flow", variant: "destructive" },
  awaiting_sap: { label: "Aguardando aprovação SAP", variant: "secondary" },
  sap_rejected: { label: "Reprovado SAP", variant: "destructive" },
  awaiting_invoice: { label: "Aguardando NF entrada", variant: "secondary" },
  completed: { label: "Concluído", variant: "default" },
  integration_error: { label: "Erro integração", variant: "destructive" },
  cancelled: { label: "Cancelado", variant: "outline" },
};

function formatCurrency(v: number | null) {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function formatDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("pt-BR");
}

export default function NfEntrada() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { items, loading, error, refresh, reprocess, rematchSap, cancel, pullNow } = useNfEntrada();

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<NfEntradaImport | null>(null);
  const [logs, setLogs] = useState<NfEntradaLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (statusFilter !== "all" && it.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          (it.numero_nf || "").toLowerCase().includes(q) ||
          (it.cnpj_fornecedor || "").toLowerCase().includes(q) ||
          (it.nome_fornecedor || "").toLowerCase().includes(q) ||
          (it.chave_acesso || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [items, statusFilter, search]);

  useEffect(() => {
    if (!detail) return;
    setLogsLoading(true);
    fetchNfEntradaLogs(detail.id)
      .then(setLogs)
      .catch((e) => toast({ title: "Erro ao carregar histórico", description: e.message, variant: "destructive" }))
      .finally(() => setLogsLoading(false));
  }, [detail, toast]);

  async function openFile(path: string | null) {
    if (!path) return;
    try {
      const url = await getSignedFileUrl(path);
      window.open(url, "_blank");
    } catch (e) {
      toast({ title: "Erro ao abrir arquivo", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function handleReprocess(id: string) {
    setBusyId(id);
    try {
      await reprocess(id);
      toast({ title: "Reprocessamento disparado" });
    } catch (e) {
      toast({ title: "Falha no reprocessamento", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  async function handleRematch(id: string) {
    setBusyId(id);
    try {
      const res = await rematchSap(id);
      if (res?.skipped) {
        toast({ title: "Rematch ignorado", description: res.skipped });
      } else if (res?.matched) {
        toast({
          title: "Vínculo SAP refeito",
          description: `CardCode ${res.cardCode} · DocEntry ${res.docEntry}${res.isDraft ? " (esboço)" : ""}`,
        });
      } else {
        toast({
          title: "Nenhum PC encontrado",
          description: res?.reason || "Sem PC/esboço aberto para o fornecedor e valor.",
          variant: "destructive",
        });
      }
    } catch (e) {
      toast({ title: "Falha no rematch", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancel(id: string) {
    if (!confirm("Cancelar este fluxo? Esta ação registra cancelamento mas não desfaz documentos já criados no SAP.")) return;
    setBusyId(id);
    try {
      await cancel(id);
      toast({ title: "Fluxo cancelado" });
    } catch (e) {
      toast({ title: "Falha ao cancelar", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  async function handlePullNow() {
    try {
      await pullNow();
      toast({ title: "Busca na Master Tax disparada" });
    } catch (e) {
      toast({ title: "Falha ao buscar", description: (e as Error).message, variant: "destructive" });
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 bg-card border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-xl font-bold">Integração NF de Entrada</h1>
              <p className="text-xs text-muted-foreground">Master Tax → ERP Flow → SAP Business One</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={refresh}>
              <RefreshCw className="w-4 h-4" /> Atualizar
            </Button>
            <Button size="sm" onClick={handlePullNow}>
              <Download className="w-4 h-4" /> Buscar Master Tax agora
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            placeholder="Buscar por NF, CNPJ, fornecedor ou chave de acesso"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground ml-auto">
            {filtered.length} de {items.length}
          </span>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-sm px-3 py-2">
            {error}
          </div>
        )}

        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>NF</TableHead>
                <TableHead>Série</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead>CNPJ</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Emissão</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Importação</TableHead>
                <TableHead>Despesa</TableHead>
                <TableHead>PO SAP</TableHead>
                <TableHead>NF SAP</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground py-8">Carregando…</TableCell></TableRow>
              )}
              {!loading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                  Nenhuma NF importada ainda. Configure os secrets <code>MASTERTAX_BASE_URL</code> e <code>MASTERTAX_TOKEN</code> e clique em "Buscar Master Tax agora".
                </TableCell></TableRow>
              )}
              {filtered.map((it) => {
                const s = STATUS_LABELS[it.status];
                return (
                  <TableRow key={it.id}>
                    <TableCell className="font-mono text-xs">{it.numero_nf || "—"}</TableCell>
                    <TableCell className="text-xs">{it.serie || "—"}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{it.nome_fornecedor || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{it.cnpj_fornecedor || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(it.valor_total)}</TableCell>
                    <TableCell>{formatDate(it.data_emissao)}</TableCell>
                    <TableCell><Badge variant={s.variant}>{s.label}</Badge></TableCell>
                    <TableCell>{formatDate(it.created_at)}</TableCell>
                    <TableCell className="font-mono text-xs">{it.expense_id?.slice(0, 8) || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{it.sap_po_draft_id || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{it.sap_invoice_draft_id || "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center gap-1 justify-end">
                        <Button variant="ghost" size="icon" title="Ver XML"
                          disabled={!it.xml_storage_path} onClick={() => openFile(it.xml_storage_path)}>
                          <FileCode2 className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" title="Ver PDF"
                          disabled={!it.pdf_storage_path} onClick={() => openFile(it.pdf_storage_path)}>
                          <FileText className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" title="Histórico" onClick={() => setDetail(it)}>
                          <History className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" title="Reprocessar"
                          disabled={busyId === it.id} onClick={() => handleReprocess(it.id)}>
                          <RotateCw className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" title="Cancelar"
                          disabled={busyId === it.id || it.status === "cancelled" || it.status === "completed"}
                          onClick={() => handleCancel(it.id)}>
                          <XCircle className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </main>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Histórico — NF {detail?.numero_nf}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">
                Chave de acesso: <span className="font-mono">{detail.chave_acesso}</span>
              </div>
              {detail.last_error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs px-3 py-2">
                  Último erro: {detail.last_error}
                </div>
              )}
              <div className="max-h-[60vh] overflow-auto space-y-2">
                {logsLoading && <div className="text-sm text-muted-foreground">Carregando…</div>}
                {!logsLoading && logs.length === 0 && (
                  <div className="text-sm text-muted-foreground">Sem registros.</div>
                )}
                {logs.map((l) => (
                  <div key={l.id} className="border border-border rounded p-3 text-xs">
                    <div className="flex justify-between gap-2 mb-1">
                      <span className="font-semibold">{l.step}</span>
                      <span className="text-muted-foreground">{new Date(l.created_at).toLocaleString("pt-BR")}</span>
                    </div>
                    <div className="text-muted-foreground mb-1">
                      {l.status_from || "—"} → {l.status_to || "—"} · {l.actor}
                    </div>
                    {l.message && <div>{l.message}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
