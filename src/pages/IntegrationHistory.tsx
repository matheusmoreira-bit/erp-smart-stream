import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Search,
  History,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  RefreshCw,
  FileText,
  Ban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
interface IntegrationLog {
  id: string;
  pagcorp_expense_id: number;
  pagcorp_data: any;
  sap_doc_entry: number | null;
  sap_doc_num: number | null;
  sap_payload: any;
  sap_response: any;
  status: string;
  error_message: string | null;
  integration_type: string;
  integrated_by: string | null;
  company_db: string | null;
  created_at: string;
}

function formatDate(dateStr: string) {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

function formatCurrency(value: number, currency: string = "BRL") {
  const validCode = /^[A-Z]{3}$/.test(currency) ? currency : "BRL";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: validCode }).format(value);
  } catch {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
  }
}

const STATUS_CONFIG: Record<string, { label: string; icon: typeof CheckCircle2; className: string }> = {
  success: { label: "Sucesso", icon: CheckCircle2, className: "bg-success/20 text-success border-success/30" },
  error: { label: "Erro", icon: XCircle, className: "bg-destructive/20 text-destructive border-destructive/30" },
  pending: { label: "Pendente", icon: Clock, className: "bg-warning/20 text-warning border-warning/30" },
  cancelled: { label: "Cancelado", icon: Ban, className: "bg-muted text-muted-foreground border-border" },
};

const TYPE_LABELS: Record<string, string> = {
  generic: "Genérico",
  accountability: "Com Prestação",
};

export default function IntegrationHistory() {
  const navigate = useNavigate();
  const [logs, setLogs] = useState<IntegrationLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [selectedLog, setSelectedLog] = useState<IntegrationLog | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const [startDate, setStartDate] = useState(thirtyDaysAgo.toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(today.toISOString().slice(0, 10));

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from("pagcorp_integration_log")
        .select("*")
        .order("created_at", { ascending: false });

      if (startDate) {
        query = query.gte("created_at", `${startDate}T00:00:00`);
      }
      if (endDate) {
        query = query.lte("created_at", `${endDate}T23:59:59`);
      }
      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }
      if (typeFilter !== "all") {
        query = query.eq("integration_type", typeFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      setLogs((data as IntegrationLog[]) || []);
    } catch (e) {
      console.error("Error fetching integration logs:", e);
    } finally {
      setIsLoading(false);
    }
  };

  const cancelIntegration = async (log: IntegrationLog) => {
    try {
      const { error } = await supabase
        .from("pagcorp_integration_log")
        .update({ status: "cancelled" } as any)
        .eq("id", log.id);
      if (error) throw error;
      toast.success("Integração cancelada");
      fetchLogs();
    } catch (e: any) {
      toast.error(e.message || "Erro ao cancelar");
    }
  };


  useEffect(() => {
    fetchLogs();
  }, []);

  const filteredLogs = useMemo(() => {
    if (!search.trim()) return logs;
    const q = search.toLowerCase();
    return logs.filter(
      (l) =>
        String(l.pagcorp_expense_id).includes(q) ||
        (l.pagcorp_data?.description || "").toLowerCase().includes(q) ||
        (l.pagcorp_data?.accountAlias || "").toLowerCase().includes(q) ||
        (l.integrated_by || "").toLowerCase().includes(q) ||
        (l.company_db || "").toLowerCase().includes(q)
    );
  }, [logs, search]);

  const pendingInView = useMemo(() => filteredLogs.filter((l) => l.status === "pending"), [filteredLogs]);

  const allPendingSelected = pendingInView.length > 0 && pendingInView.every((l) => selectedIds.has(l.id));

  const toggleAll = useCallback(() => {
    if (allPendingSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingInView.map((l) => l.id)));
    }
  }, [allPendingSelected, pendingInView]);

  const toggleOne = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const cancelBatch = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      const { error } = await supabase
        .from("pagcorp_integration_log")
        .update({ status: "cancelled" } as any)
        .in("id", ids);
      if (error) throw error;
      toast.success(`${ids.length} integração(ões) cancelada(s)`);
      setSelectedIds(new Set());
      fetchLogs();
    } catch (e: any) {
      toast.error(e.message || "Erro ao cancelar em lote");
    }
  };

  const statusIcon = (status: string) => {
    const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
    const Icon = cfg.icon;
    return (
      <Badge variant="secondary" className={`${cfg.className} font-semibold text-xs`}>
        <Icon className="w-3 h-3 mr-1" />
        {cfg.label}
      </Badge>
    );
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/pagcorp")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="p-2 rounded-lg bg-primary/10">
              <History className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Histórico de Integrações</h1>
              <p className="text-xs text-muted-foreground">Log de auditoria PagCorp → SAP</p>
            </div>
          </div>
        </div>
      </header>

      <div className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Data Início</label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40 bg-card" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Data Fim</label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40 bg-card" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Status</label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36 bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="success">Sucesso</SelectItem>
                <SelectItem value="error">Erro</SelectItem>
                <SelectItem value="pending">Pendente</SelectItem>
                <SelectItem value="cancelled">Cancelado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Tipo</label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-40 bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="generic">Genérico</SelectItem>
                <SelectItem value="accountability">Com Prestação</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <label className="text-xs text-muted-foreground">Buscar</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="ID, descrição, portador, usuário..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-card"
              />
            </div>
          </div>
          <Button onClick={fetchLogs} disabled={isLoading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            Buscar
          </Button>
        </div>
      </div>

      <main className="flex-1 px-6 py-6">
        <div className="max-w-7xl mx-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">
              <History className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="text-lg font-medium">Nenhum registro encontrado</p>
              <p className="text-sm mt-1">Ajuste os filtros ou clique em Buscar</p>
            </div>
          ) : (
            <>
              {selectedIds.size > 0 && (
                <div className="flex items-center gap-3 px-4 py-2 mb-2 bg-muted/50 rounded-lg border border-border">
                  <span className="text-sm text-muted-foreground">{selectedIds.size} selecionado(s)</span>
                  <Button variant="destructive" size="sm" className="gap-2" onClick={cancelBatch}>
                    <Ban className="w-4 h-4" />
                    Cancelar selecionados
                  </Button>
                </div>
              )}
              <div className="rounded-xl border border-border overflow-hidden bg-card">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead className="w-10">
                        {pendingInView.length > 0 && (
                          <Checkbox checked={allPendingSelected} onCheckedChange={toggleAll} />
                        )}
                      </TableHead>
                      <TableHead className="text-muted-foreground">Data</TableHead>
                      <TableHead className="text-muted-foreground">Expense ID</TableHead>
                      <TableHead className="text-muted-foreground">Descrição</TableHead>
                      <TableHead className="text-muted-foreground">Portador</TableHead>
                      <TableHead className="text-muted-foreground text-right">Valor</TableHead>
                      <TableHead className="text-muted-foreground text-center">Tipo</TableHead>
                      <TableHead className="text-muted-foreground text-center">Status</TableHead>
                      <TableHead className="text-muted-foreground">SAP Doc</TableHead>
                      <TableHead className="text-muted-foreground">Usuário</TableHead>
                      <TableHead className="text-muted-foreground text-center">Detalhes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLogs.map((log) => (
                      <TableRow key={log.id} className="border-border">
                        <TableCell>
                          {log.status === "pending" ? (
                            <Checkbox
                              checked={selectedIds.has(log.id)}
                              onCheckedChange={() => toggleOne(log.id)}
                            />
                          ) : null}
                        </TableCell>
                        <TableCell className="text-sm text-foreground whitespace-nowrap">
                          {formatDate(log.created_at)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground font-mono">
                          {log.pagcorp_expense_id}
                        </TableCell>
                        <TableCell className="text-sm text-foreground max-w-[200px] truncate">
                          {log.pagcorp_data?.description || "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {log.pagcorp_data?.accountAlias || "—"}
                        </TableCell>
                        <TableCell className="text-sm font-medium text-right text-foreground whitespace-nowrap">
                          {formatCurrency(log.pagcorp_data?.amount || 0, log.pagcorp_data?.currency)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="text-xs">
                            {TYPE_LABELS[log.integration_type] || log.integration_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          {statusIcon(log.status)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground font-mono">
                          {log.sap_doc_num ? `#${log.sap_doc_num}` : "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground truncate max-w-[120px]">
                          {log.integrated_by || "—"}
                        </TableCell>
                        <TableCell className="text-center flex items-center justify-center gap-1">
                          {log.status === "pending" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => cancelIntegration(log)}
                              title="Cancelar integração"
                            >
                              <Ban className="w-4 h-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setSelectedLog(log)}
                          >
                            <FileText className="w-4 h-4 text-muted-foreground" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>
      </main>

      {/* Detail Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Detalhes da Integração
            </DialogTitle>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Data</p>
                  <p className="font-medium">{formatDate(selectedLog.created_at)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <div className="mt-0.5">{statusIcon(selectedLog.status)}</div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">PagCorp Expense ID</p>
                  <p className="font-mono font-medium">{selectedLog.pagcorp_expense_id}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Tipo</p>
                  <p className="font-medium">{TYPE_LABELS[selectedLog.integration_type] || selectedLog.integration_type}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Usuário</p>
                  <p className="font-medium">{selectedLog.integrated_by || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Empresa</p>
                  <p className="font-medium">{selectedLog.company_db || "—"}</p>
                </div>
              </div>

              {(selectedLog.sap_doc_entry || selectedLog.sap_doc_num) && (
                <div className="border-t border-border pt-3">
                  <p className="text-xs text-muted-foreground mb-2 font-semibold uppercase tracking-wider">Documento SAP</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground">DocEntry</p>
                      <p className="font-mono font-medium">{selectedLog.sap_doc_entry || "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">DocNum</p>
                      <p className="font-mono font-medium">{selectedLog.sap_doc_num || "—"}</p>
                    </div>
                  </div>
                </div>
              )}

              {selectedLog.error_message && (
                <div className="border-t border-border pt-3">
                  <p className="text-xs text-muted-foreground mb-1 font-semibold uppercase tracking-wider">Erro</p>
                  <p className="text-destructive bg-destructive/10 rounded-lg p-3 text-xs font-mono">
                    {selectedLog.error_message}
                  </p>
                </div>
              )}

              <div className="border-t border-border pt-3">
                <p className="text-xs text-muted-foreground mb-2 font-semibold uppercase tracking-wider">Dados PagCorp</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Descrição</p>
                    <p className="font-medium">{selectedLog.pagcorp_data?.description || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Portador</p>
                    <p className="font-medium">{selectedLog.pagcorp_data?.accountAlias || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Valor</p>
                    <p className="font-medium">{formatCurrency(selectedLog.pagcorp_data?.amount || 0, selectedLog.pagcorp_data?.currency)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Data Transação</p>
                    <p className="font-medium">{selectedLog.pagcorp_data?.date ? formatDate(selectedLog.pagcorp_data.date) : "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Prestação</p>
                    <p className="font-medium">{selectedLog.pagcorp_data?.hasAccountability ? "Sim" : "Não"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Aprovada</p>
                    <p className="font-medium">{selectedLog.pagcorp_data?.accountabilityApproved ? "Sim" : "Não"}</p>
              </div>

              {selectedLog.sap_payload && (
                <div className="border-t border-border pt-3">
                  <p className="text-xs text-muted-foreground mb-2 font-semibold uppercase tracking-wider">Payload enviado ao SAP</p>
                  <pre className="bg-muted/50 rounded-lg p-3 text-xs font-mono overflow-x-auto max-h-48 overflow-y-auto">
                    {JSON.stringify(selectedLog.sap_payload, null, 2)}
                  </pre>
                </div>
              )}

              {selectedLog.sap_response && (
                <div className="border-t border-border pt-3">
                  <p className="text-xs text-muted-foreground mb-2 font-semibold uppercase tracking-wider">Retorno do SAP</p>
                  <pre className="bg-muted/50 rounded-lg p-3 text-xs font-mono overflow-x-auto max-h-48 overflow-y-auto">
                    {JSON.stringify(selectedLog.sap_response, null, 2)}
                  </pre>
                </div>
              )}
            </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
