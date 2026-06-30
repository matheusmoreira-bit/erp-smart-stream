import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Box,
  Plus,
  Search,
  Power,
  Pencil,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  LogOut,
  CloudUpload,
  Upload,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/ThemeToggle";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";
import { useCompanies } from "@/hooks/useCompanies";
import { useItems, toggleItemActive, createItem, type SapItem } from "@/hooks/useItems";
import { ItemFormModal } from "@/components/ItemFormModal";
import { NewItemWizardDialog } from "@/components/NewItemWizardDialog";
import { parseSapError } from "@/lib/sap-error";
import { PageTitle } from "@/components/PageTitle";
import { useModuleAccess } from "@/hooks/usePermissions";

type PendingVariante = {
  id: string;
  codigo_completo: string;
  descricao: string;
  grupo: string | null;
  tipo: "produto" | "servico";
  chave: string | null;
  syncError?: string | null;
};

function StatusBadge({ s }: { s: SapItem }) {
  if (!s.is_active) {
    return (
      <Badge variant="secondary" className="gap-1">
        <XCircle className="w-3 h-3" />
        Inativo
      </Badge>
    );
  }
  if (s.sap_sync_status === "error") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="destructive" className="gap-1 cursor-help">
            <AlertCircle className="w-3 h-3" />
            Erro SAP
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm whitespace-pre-wrap break-words">
          {s.sap_sync_error || "Falha ao sincronizar"}
        </TooltipContent>
      </Tooltip>
    );
  }
  if (s.sap_sync_status === "pending") {
    return (
      <Badge variant="outline" className="gap-1 border-warning/40 text-warning">
        <CloudUpload className="w-3 h-3" />
        Pendente SAP
      </Badge>
    );
  }
  return (
    <Badge className="gap-1 bg-success/20 text-success hover:bg-success/30 border-success/30">
      <CheckCircle2 className="w-3 h-3" />
      Ativo
    </Badge>
  );
}

export default function Items() {
  const navigate = useNavigate();
  const { session, logout } = useSap();
  const { hasAccess: canWrite } = useModuleAccess("items_write");
  const { items, isLoading, refresh, setRowOverlay } = useItems(session?.companyDB);
  const { getLabel } = useCompanies(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<SapItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [pending, setPending] = useState<PendingVariante[]>([]);
  const [pendingErrors, setPendingErrors] = useState<Record<string, string>>({});

  const loadPending = useCallback(async () => {
    const { data, error } = await supabase
      .from("item_variante")
      .select("id,codigo_completo,descricao,item_base:item_base_id(tipo,ncm,codigo_servico,grupo)")
      .order("codigo_completo", { ascending: true })
      .limit(2000);
    if (error) {
      console.warn("[Items] failed to load item_variante", error);
      return;
    }
    const sapCodes = new Set(items.map((i) => i.item_code));
    const list: PendingVariante[] = [];
    for (const v of (data || []) as any[]) {
      if (sapCodes.has(v.codigo_completo)) continue;
      const base = v.item_base || {};
      list.push({
        id: v.id,
        codigo_completo: v.codigo_completo,
        descricao: v.descricao,
        grupo: base.grupo ?? null,
        tipo: base.tipo,
        chave: base.tipo === "produto" ? base.ncm : base.codigo_servico,
      });
    }
    setPending(list);
  }, [items]);

  useEffect(() => {
    void loadPending();
  }, [loadPending]);

  const allRows = useMemo<SapItem[]>(() => {
    const sap = items;
    const pendingAsItems: SapItem[] = pending.map((p) => ({
      id: `forn:${p.id}`,
      item_code: p.codigo_completo,
      item_name: p.descricao,
      items_group_code: p.grupo ? Number(p.grupo) : null,
      valid: true,
      frozen: false,
      is_active: true,
      is_sales_item: true,
      is_inventory_item: true,
      is_purchase_item: true,
      sap_sync_status: pendingErrors[p.id] ? "error" : "pending",
      sap_sync_error: pendingErrors[p.id] || null,
    }));
    const merged = [...sap, ...pendingAsItems];
    merged.sort((a, b) => (a.item_name || "").localeCompare(b.item_name || ""));
    return merged;
  }, [items, pending, pendingErrors]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allRows;
    return allRows.filter(
      (i) =>
        i.item_name.toLowerCase().includes(q) ||
        i.item_code.toLowerCase().includes(q) ||
        String(i.items_group_code ?? "").includes(q),
    );
  }, [allRows, search]);

  const needsSync = (s: SapItem) => s.sap_sync_status === "pending" || s.sap_sync_status === "error";

  const handleToggle = async (i: SapItem) => {
    if (!session) return;
    setToggling(i.id);
    try {
      await toggleItemActive(i, session);
      toast.success(i.is_active ? "Item inativado" : "Item ativado");
      await refresh();
    } catch (e) {
      const err = parseSapError(e);
      toast.error(err.title || "Erro ao alterar status", { description: err.description });
    } finally {
      setToggling(null);
    }
  };

  const handleSendToSap = async (i: SapItem) => {
    if (!session) {
      toast.error("Sem sessão SAP ativa");
      return;
    }
    setSyncing(i.id);
    try {
      await createItem(
        {
          item_code: i.item_code,
          item_name: i.item_name,
          items_group_code: i.items_group_code,
          is_active: true,
          is_sales_item: i.is_sales_item,
          is_inventory_item: i.is_inventory_item,
          is_purchase_item: i.is_purchase_item,
        },
        session,
      );
      toast.success("Enviado ao SAP", { description: `ItemCode ${i.item_code}` });
      const variantId = i.id.startsWith("forn:") ? i.id.slice(5) : null;
      if (variantId) {
        setPendingErrors((p) => {
          const n = { ...p };
          delete n[variantId];
          return n;
        });
      } else {
        setRowOverlay(i.item_code, "synced", null);
      }
      await refresh();
      await loadPending();
    } catch (e) {
      const err = parseSapError(e);
      const msg = err.description || err.title || (e instanceof Error ? e.message : "Erro ao enviar");
      const variantId = i.id.startsWith("forn:") ? i.id.slice(5) : null;
      if (variantId) {
        setPendingErrors((p) => ({ ...p, [variantId]: msg }));
      } else {
        setRowOverlay(i.item_code, "error", msg);
      }
      toast.error("Falha ao enviar ao SAP", { description: msg });
    } finally {
      setSyncing(null);
    }
  };

  const handleBulkSync = async () => {
    if (!session) {
      toast.error("Sem sessão SAP ativa");
      return;
    }
    const targets = allRows.filter(needsSync);
    if (!targets.length) {
      toast.info("Nada a reenviar");
      return;
    }
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    for (const i of targets) {
      try {
        await createItem(
          {
            item_code: i.item_code,
            item_name: i.item_name,
            items_group_code: i.items_group_code,
            is_active: true,
            is_sales_item: i.is_sales_item,
            is_inventory_item: i.is_inventory_item,
            is_purchase_item: i.is_purchase_item,
          },
          session,
        );
        ok++;
        const variantId = i.id.startsWith("forn:") ? i.id.slice(5) : null;
        if (variantId)
          setPendingErrors((p) => {
            const n = { ...p };
            delete n[variantId];
            return n;
          });
      } catch (e) {
        fail++;
        const msg = e instanceof Error ? e.message : "Erro ao enviar";
        const variantId = i.id.startsWith("forn:") ? i.id.slice(5) : null;
        if (variantId) setPendingErrors((p) => ({ ...p, [variantId]: msg }));
        else setRowOverlay(i.item_code, "error", msg);
      }
    }
    setBulkBusy(false);
    toast[fail ? "warning" : "success"](`Reenvio: ${ok} ok, ${fail} falha(s)`);
    await refresh();
    await loadPending();
  };

  const companyLabel = getLabel(session?.companyDB || "");
  const pendingCount = allRows.filter(needsSync).length;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <PageTitle title="Itens" />
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/")}
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="p-2 rounded-lg bg-primary/10">
              <Box className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Itens</h1>
              <p className="text-xs text-muted-foreground">
                Cadastro NCM/Serviço com geração de código + sincronização SAP.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-foreground">{companyLabel}</p>
              <p className="text-xs text-muted-foreground">{session?.userName}</p>
            </div>
            <ThemeToggle />
            <button onClick={logout} className="text-xs text-muted-foreground hover:text-foreground">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[260px]">
            <label className="text-xs text-muted-foreground mb-1 block">Buscar</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ItemCode, nome, grupo..."
                className="pl-9 bg-card"
              />
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              refresh();
              void loadPending();
            }}
            disabled={isLoading}
            className="gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button
            variant="outline"
            onClick={handleBulkSync}
            disabled={bulkBusy || pendingCount === 0 || !session}
            className="gap-2"
          >
            {bulkBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Reenviar pendentes/erros {pendingCount > 0 && `(${pendingCount})`}
          </Button>
          <Button onClick={() => setCreating(true)} className="gap-2" disabled={!session}>
            <Plus className="w-4 h-4" />
            Novo Item
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2 max-w-7xl mx-auto">
          SAP: {items.length} · Locais pendentes: {pending.length} · Exibindo: {filtered.length}
        </p>
      </div>

      <main className="flex-1 px-6 py-6">
        <div className="max-w-7xl mx-auto glass-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ItemCode</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Grupo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && !isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                    Nenhum item encontrado.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((i) => {
                  const isLocal = i.id.startsWith("forn:");
                  const canSync = needsSync(i);
                  return (
                    <TableRow key={i.id} className={!i.is_active ? "opacity-60" : ""}>
                      <TableCell className="font-mono text-xs">{i.item_code}</TableCell>
                      <TableCell className="font-medium">{i.item_name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {i.items_group_code ?? "—"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge s={i} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex gap-1">
                          {canSync && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => handleSendToSap(i)}
                                  disabled={syncing === i.id || bulkBusy || !session}
                                  className="text-primary hover:text-primary"
                                >
                                  {syncing === i.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <CloudUpload className="w-4 h-4" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Enviar ao SAP</TooltipContent>
                            </Tooltip>
                          )}
                          {!isLocal && (
                            <>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button size="icon" variant="ghost" onClick={() => setEditing(i)}>
                                    <Pencil className="w-4 h-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Editar</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => handleToggle(i)}
                                    disabled={toggling === i.id}
                                    className={
                                      i.is_active
                                        ? "text-warning hover:text-warning"
                                        : "text-success hover:text-success"
                                    }
                                  >
                                    <Power className="w-4 h-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>{i.is_active ? "Inativar" : "Ativar"}</TooltipContent>
                              </Tooltip>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </main>

      <NewItemWizardDialog
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          refresh();
          void loadPending();
        }}
      />

      <ItemFormModal
        open={!!editing}
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          refresh();
        }}
      />
    </div>
  );
}
