import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  Plus,
  Search,
  Power,
  Pencil,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  LogOut,
  Sparkles,
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useSap } from "@/contexts/SapContext";
import { useCompanies } from "@/hooks/useCompanies";
import {
  useSuppliers,
  toggleSupplierActive,
  type Supplier,
} from "@/hooks/useSuppliers";
import { SupplierFormModal } from "@/components/SupplierFormModal";

function StatusBadge({ s }: { s: Supplier }) {
  if (!s.is_active) {
    return <Badge variant="secondary" className="gap-1"><XCircle className="w-3 h-3" />Inativo</Badge>;
  }
  if (s.sap_sync_status === "error") {
    return <Badge variant="destructive" className="gap-1"><AlertCircle className="w-3 h-3" />Erro SAP</Badge>;
  }
  if (s.sap_sync_status === "synced") {
    return <Badge className="gap-1 bg-success/20 text-success hover:bg-success/30 border-success/30"><CheckCircle2 className="w-3 h-3" />Sincronizado</Badge>;
  }
  return <Badge variant="outline">Pendente</Badge>;
}

export default function Suppliers() {
  const navigate = useNavigate();
  const { session, logout } = useSap();
  const { suppliers, isLoading, refresh } = useSuppliers(session?.companyDB);
  const { getLabel } = useCompanies(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [creating, setCreating] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter(
      (s) =>
        s.card_name.toLowerCase().includes(q) ||
        (s.card_code || "").toLowerCase().includes(q) ||
        (s.federal_tax_id || "").includes(q.replace(/\D/g, "")),
    );
  }, [suppliers, search]);

  const handleToggle = async (s: Supplier) => {
    setToggling(s.id);
    try {
      const updated = await toggleSupplierActive(s, session);
      if (updated.sap_sync_status === "error") {
        toast.warning("Status alterado localmente, falha no SAP", {
          description: updated.sap_sync_error || undefined,
        });
      } else {
        toast.success(updated.is_active ? "Fornecedor ativado" : "Fornecedor desativado");
      }
      await refresh();
    } catch (e) {
      toast.error("Erro ao alterar status", {
        description: e instanceof Error ? e.message : undefined,
      });
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
            <Button variant="ghost" size="icon" onClick={() => navigate("/")} className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="p-2 rounded-lg bg-primary/10">
              <Building2 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Fornecedores</h1>
              <p className="text-xs text-muted-foreground">Cadastro local + sincronização SAP</p>
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
                placeholder="Nome, CNPJ, CardCode..."
                className="pl-9 bg-card"
              />
            </div>
          </div>
          <Button variant="outline" onClick={refresh} disabled={isLoading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate("/suppliers/import-pagcorp")}
            className="gap-2"
          >
            <Sparkles className="w-4 h-4" />
            Importar do PagCorp
          </Button>
          <Button onClick={() => setCreating(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            Novo Fornecedor
          </Button>
        </div>
      </div>

      <main className="flex-1 px-6 py-6">
        <div className="max-w-7xl mx-auto glass-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>CardCode</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>País</TableHead>
                <TableHead>CNPJ/Tax ID</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Moeda</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && !isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                    Nenhum fornecedor encontrado.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((s) => (
                  <TableRow key={s.id} className={!s.is_active ? "opacity-60" : ""}>
                    <TableCell className="font-mono text-xs">{s.card_code || "—"}</TableCell>
                    <TableCell className="font-medium">{s.card_name}</TableCell>
                    <TableCell className="font-mono text-xs">{s.federal_tax_id || "—"}</TableCell>
                    <TableCell className="text-xs">{s.email || "—"}</TableCell>
                    <TableCell className="text-xs">{s.phone1 || "—"}</TableCell>
                    <TableCell>{s.currency}</TableCell>
                    <TableCell><StatusBadge s={s} /></TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="icon" variant="ghost" onClick={() => setEditing(s)}>
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
                              onClick={() => handleToggle(s)}
                              disabled={toggling === s.id}
                              className={s.is_active ? "text-warning hover:text-warning" : "text-success hover:text-success"}
                            >
                              <Power className="w-4 h-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{s.is_active ? "Desativar" : "Ativar"}</TooltipContent>
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

      <SupplierFormModal
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
