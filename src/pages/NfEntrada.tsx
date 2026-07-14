import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, FileText, FileCode2, History, RefreshCw, XCircle, Download, RotateCw, Link2, ChevronRight, Pencil, MoreHorizontal, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  useNfEntrada, fetchNfEntradaLogs, fetchNfFile,
  type NfEntradaImport, type NfEntradaLog, type NfEntradaStatus,
} from "@/hooks/useNfEntrada";
import { PageTitle } from "@/components/PageTitle";
import { EditNfEntradaDialog } from "@/components/EditNfEntradaDialog";
import { copyDocLink, readDocParam, setDocParam } from "@/lib/doc-deep-link";
import { setPendingPurchaseFiles } from "@/lib/pending-purchase-files";

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

function DetailField({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div>
      <div className="text-muted-foreground uppercase tracking-wide text-[10px] mb-1">{label}</div>
      <div className={mono ? "font-mono" : ""}>{value || <span className="text-muted-foreground">—</span>}</div>
    </div>
  );
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editItem, setEditItem] = useState<NfEntradaImport | null>(null);

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

  // Sync `?doc=<id>` with the currently opened NF for shareable links.
  useEffect(() => { setDocParam(detail?.id ?? null); }, [detail]);
  useEffect(() => {
    const id = readDocParam();
    if (!id || detail) return;
    const found = items.find((it) => it.id === id);
    if (found) setDetail(found);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  async function openFile(id: string, kind: "xml" | "pdf") {
    setBusyId(id);
    try {
      const url = await fetchNfFile(id, kind);
      window.open(url, "_blank");
    } catch (e) {
      toast({ title: `Erro ao abrir ${kind.toUpperCase()}`, description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
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

  async function handleCreatePurchaseOrder(it: NfEntradaImport) {
    setBusyId(it.id);
    try {
      const files: File[] = [];
      // Baixa o PDF (DANFE/DANFSE) e anexa ao pedido de compra. XML também
      // vai como anexo quando disponível — a IA usa qualquer um dos dois.
      const kinds: Array<"pdf" | "xml"> = ["pdf", "xml"];
      for (const kind of kinds) {
        try {
          const url = await fetchNfFile(it.id, kind);
          const resp = await fetch(url);
          if (!resp.ok) continue;
          const blob = await resp.blob();
          const baseName = it.chave_acesso || it.numero_nf || it.id;
          const ext = kind === "pdf" ? "pdf" : "xml";
          const mime = kind === "pdf" ? "application/pdf" : "application/xml";
          files.push(new File([blob], `NF-${baseName}.${ext}`, { type: blob.type || mime }));
        } catch (err) {
          // Ignora falha por tipo individual (ex.: 404 para PDF em NF-e).
          console.warn(`[nf-entrada] falha ao baixar ${kind}:`, (err as Error).message);
        }
      }
      if (files.length === 0) {
        toast({
          title: "Nenhum arquivo disponível",
          description: "Não foi possível baixar o PDF ou XML desta NF para anexar ao pedido.",
          variant: "destructive",
        });
        return;
      }
      setPendingPurchaseFiles(files);
      toast({
        title: "Abrindo Nova Compra",
        description: `${files.length} anexo(s) da NF prontos para o pedido.`,
      });
      navigate("/compras");
    } catch (e) {
      toast({ title: "Falha ao lançar pedido", description: (e as Error).message, variant: "destructive" });
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
      <PageTitle title="NF de Entrada" />
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
          <div className="flex items-center gap-3 ml-auto text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500/60" />
              Com Pedido de Compra vinculado
            </span>
            <span>{filtered.length} de {items.length}</span>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-sm px-3 py-2">
            {error}
          </div>
        )}

        <div className="rounded-md border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>NF</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="w-28">Emissão</TableHead>
                <TableHead className="w-56">Status</TableHead>
                <TableHead className="text-right w-[220px]">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Carregando…</TableCell></TableRow>
              )}
              {!loading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  Nenhuma NF importada ainda. Configure os secrets <code>MASTERTAX_BASE_URL</code> e <code>MASTERTAX_TOKEN</code> e clique em "Buscar Master Tax agora".
                </TableCell></TableRow>
              )}
              {filtered.map((it) => {
                const s = STATUS_LABELS[it.status];
                const isOpen = expandedId === it.id;
                const toggle = () => setExpandedId(isOpen ? null : it.id);
                const hasPoLink = !!it.sap_matched_po_doc_entry;
                const rowClass = hasPoLink
                  ? "cursor-pointer bg-emerald-500/5 hover:bg-emerald-500/10 border-l-4 border-l-emerald-500"
                  : "cursor-pointer hover:bg-muted/40 border-l-4 border-l-transparent";
                return (
                  <Fragment key={it.id}>
                    <TableRow
                      className={rowClass}
                      onClick={toggle}
                      data-state={isOpen ? "selected" : undefined}
                    >
                      <TableCell className="pr-0">
                        <ChevronRight
                          className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        <div className="flex items-center gap-1.5">
                          <span>{it.numero_nf || "—"}</span>
                          {hasPoLink && (
                            <span
                              title={`Vinculada ao ${it.sap_matched_po_is_draft ? "esboço" : "PC"} ${it.sap_matched_po_doc_entry} do SAP`}
                              className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 text-[9px] font-sans font-medium"
                            >
                              <Link2 className="w-2.5 h-2.5" /> PC
                            </span>
                          )}
                        </div>
                        {it.serie && <div className="text-[10px] text-muted-foreground">série {it.serie}</div>}
                      </TableCell>
                      <TableCell className="max-w-[260px]">
                        <div className="truncate">{it.nome_fornecedor || "—"}</div>
                        {it.cnpj_fornecedor && (
                          <div className="text-[10px] text-muted-foreground font-mono">{it.cnpj_fornecedor}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(it.valor_total)}</TableCell>
                      <TableCell className="text-xs">{formatDate(it.data_emissao)}</TableCell>
                      <TableCell><Badge variant={s.variant}>{s.label}</Badge></TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>

                        <div className="flex justify-end">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" aria-label="Ações da NF" disabled={busyId === it.id}>
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                              <DropdownMenuItem onClick={() => openFile(it.id, "xml")} disabled={busyId === it.id}>
                                <FileCode2 className="w-4 h-4 mr-2" />
                                Abrir XML
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openFile(it.id, "pdf")} disabled={busyId === it.id}>
                                <FileText className="w-4 h-4 mr-2" />
                                Abrir DANFE (PDF)
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setDetail(it)}>
                                <History className="w-4 h-4 mr-2" />
                                Ver histórico
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleRematch(it.id)}
                                disabled={busyId === it.id || !!it.sap_invoice_draft_id || it.status === "cancelled" || it.status === "completed"}
                              >
                                <Link2 className="w-4 h-4 mr-2" />
                                {hasPoLink ? "Refazer vínculo com PC" : "Vincular ao Pedido de Compra"}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleReprocess(it.id)}
                                disabled={busyId === it.id}
                              >
                                <RotateCw className="w-4 h-4 mr-2" />
                                Reprocessar integração
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setEditItem(it)}>
                                <Pencil className="w-4 h-4 mr-2" />
                                Editar dados
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleCancel(it.id)}
                                disabled={busyId === it.id || it.status === "cancelled" || it.status === "completed"}
                                className="text-destructive focus:text-destructive"
                              >
                                <XCircle className="w-4 h-4 mr-2" />
                                Cancelar fluxo
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>

                    {isOpen && (
                      <TableRow key={`${it.id}-details`} className="bg-muted/20 hover:bg-muted/20">
                        <TableCell />
                        <TableCell colSpan={6} className="py-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 text-xs">
                            <DetailField label="Série" value={it.serie} />
                            <DetailField label="CNPJ" value={it.cnpj_fornecedor} mono />
                            <DetailField label="Importação" value={formatDate(it.created_at)} />
                            <DetailField label="Despesa" value={it.expense_id?.slice(0, 8) || null} mono />
                            <DetailField label="PO SAP" value={it.sap_po_draft_id} mono />
                            <DetailField label="NF SAP" value={it.sap_invoice_draft_id} mono />
                            <div className="col-span-2 md:col-span-2">
                              <div className="text-muted-foreground uppercase tracking-wide text-[10px] mb-1">Vínculo SAP</div>
                              {it.sap_matched_card_code || it.sap_match_reason ? (
                                <div className="flex flex-col gap-0.5">
                                  {it.sap_matched_card_code && (
                                    <span className="font-mono">
                                      {it.sap_matched_card_code}
                                      {it.sap_matched_po_doc_entry && (
                                        <span className="text-muted-foreground">
                                          {" "}· {it.sap_matched_po_is_draft ? "esboço" : "PC"} {it.sap_matched_po_doc_entry}
                                        </span>
                                      )}
                                    </span>
                                  )}
                                  {it.sap_match_reason && (
                                    <span className="text-muted-foreground">{it.sap_match_reason}</span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </main>

      <EditNfEntradaDialog
        item={editItem}
        open={!!editItem}
        onOpenChange={(o) => !o && setEditItem(null)}
        onSaved={refresh}
      />


      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Histórico — NF {detail?.numero_nf}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">
                  Chave de acesso: <span className="font-mono">{detail.chave_acesso}</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={() => void copyDocLink(window.location.pathname, detail.id)}
                  title="Copiar link direto desta NF"
                >
                  <Link2 className="w-3.5 h-3.5" aria-hidden="true" /> Copiar link
                </Button>
              </div>
              <div className="rounded-md border border-border p-3 text-xs space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">Vínculo SAP</span>
                  <Button
                    variant="outline" size="sm"
                    disabled={busyId === detail.id || !!detail.sap_invoice_draft_id}
                    onClick={() => handleRematch(detail.id)}
                  >
                    <Link2 className="w-3.5 h-3.5" /> Refazer vínculo SAP
                  </Button>
                </div>
                <div>
                  Fornecedor (NF): <span className="font-mono">{detail.cnpj_fornecedor || "—"}</span>
                  {detail.nome_fornecedor ? ` · ${detail.nome_fornecedor}` : ""}
                </div>
                <div>
                  CardCode SAP:{" "}
                  <span className="font-mono">{detail.sap_matched_card_code || "—"}</span>
                </div>
                <div>
                  PC vinculado:{" "}
                  <span className="font-mono">
                    {detail.sap_matched_po_doc_entry
                      ? `${detail.sap_matched_po_is_draft ? "esboço" : "PC"} ${detail.sap_matched_po_doc_entry}`
                      : "—"}
                  </span>
                </div>
                <div>
                  Motivo do match:{" "}
                  <span className="text-muted-foreground">{detail.sap_match_reason || "—"}</span>
                </div>
                {detail.sap_invoice_draft_id && (
                  <div className="text-muted-foreground">
                    Esboço de NF de entrada já criado ({detail.sap_invoice_draft_id}) — rematch desabilitado para evitar duplicata.
                  </div>
                )}
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
