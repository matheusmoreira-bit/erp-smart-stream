import { useMemo, useState } from "react";
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
import { useSap } from "@/contexts/SapContext";
import { useCompanies } from "@/hooks/useCompanies";
import { useItems, toggleItemActive, type SapItem } from "@/hooks/useItems";
import { ItemFormModal } from "@/components/ItemFormModal";
import { parseSapError } from "@/lib/sap-error";

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
      <Badge variant="destructive" className="gap-1">
        <AlertCircle className="w-3 h-3" />
        Erro SAP
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
  const { items, isLoading, refresh } = useItems(session?.companyDB);
  const { getLabel } = useCompanies(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<SapItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.item_name.toLowerCase().includes(q) ||
        i.item_code.toLowerCase().includes(q) ||
        String(i.items_group_code ?? "").includes(q),
    );
  }, [items, search]);

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

  const companyLabel = getLabel(session?.companyDB || "");

  return (
    <div className="min-h-screen bg-background flex flex-col">
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
              <p className="text-xs text-muted-foreground">Cadastro de itens com sincronização SAP</p>
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
          <Button variant="outline" onClick={refresh} disabled={isLoading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button onClick={() => setCreating(true)} className="gap-2" disabled={!session}>
            <Plus className="w-4 h-4" />
            Novo Item
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2 max-w-7xl mx-auto">
          Total: {items.length} · Exibindo: {filtered.length}
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
                filtered.map((i) => (
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
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </main>

      <ItemFormModal
        open={creating || !!editing}
        editing={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => {
          setCreating(false);
          setEditing(null);
          refresh();
        }}
      />
    </div>
  );
}
