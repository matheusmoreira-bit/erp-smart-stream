import { useCallback, useEffect, useMemo, useState } from "react";
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
  
  Upload,
  CloudUpload,
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
import {
  useSuppliers,
  toggleSupplierActive,
  retrySupplierToSap,
  type Supplier,
} from "@/hooks/useSuppliers";
import { SupplierFormModal } from "@/components/SupplierFormModal";
import { NewFornecedorDialog } from "@/components/NewFornecedorDialog";
import { syncFornecedorToSap } from "@/lib/promote-fornecedor";
import { PageTitle } from "@/components/PageTitle";
import { useModuleAccess } from "@/hooks/usePermissions";

type PendingFornecedor = {
  kind: "fornecedor";
  id: string;
  tipo_pessoa: "pj" | "pf";
  raw: any;
  display: Supplier;
};

const digits = (s: string) => (s || "").replace(/\D+/g, "");

function StatusBadge({ s }: { s: Supplier }) {
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
          {s.sap_sync_error || "Falha ao sincronizar com o SAP"}
        </TooltipContent>
      </Tooltip>
    );
  }
  if (s.sap_sync_status === "pending" || s.sap_sync_status === "skipped") {
    return (
      <Badge variant="outline" className="gap-1 border-warning/40 text-warning">
        <CloudUpload className="w-3 h-3" />
        Pendente SAP
      </Badge>
    );
  }
  if (s.sap_sync_status === "synced") {
    return (
      <Badge className="gap-1 bg-success/20 text-success hover:bg-success/30 border-success/30">
        <CheckCircle2 className="w-3 h-3" />
        Sincronizado
      </Badge>
    );
  }
  return <Badge variant="outline">{s.sap_sync_status || "—"}</Badge>;
}

export default function Suppliers() {
  const navigate = useNavigate();
  const { session, logout } = useSap();
  const { hasAccess: canWrite } = useModuleAccess("suppliers_write");
  const { suppliers, isLoading, refresh } = useSuppliers(session?.companyDB);
  const { getLabel } = useCompanies(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [creating, setCreating] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Local fornecedores (table /fornecedores) — promoted to pending rows when not
  // yet present in `suppliers` for the active company.
  const [pending, setPending] = useState<PendingFornecedor[]>([]);

  const loadFornecedores = useCallback(async () => {
    if (!session?.companyDB) {
      setPending([]);
      return;
    }
    const { data, error } = await supabase
      .from("fornecedores")
      .select("*")
      .order("razao_social", { ascending: true })
      .limit(2000);
    if (error) {
      console.warn("[Suppliers] failed to load fornecedores", error);
      return;
    }
    const synced = new Set(
      suppliers
        .filter((s) => !s.id.startsWith("forn:"))
        .map((s) => digits(s.federal_tax_id || ""))
        .filter(Boolean),
    );
    const result: PendingFornecedor[] = [];
    for (const f of (data || []) as any[]) {
      const tax = digits(String(f.cnpj || f.cpf || ""));
      if (!tax) continue;
      if (synced.has(tax)) continue;
      const display: Supplier = {
        id: `forn:${f.id}`,
        company_db: session.companyDB,
        card_code: null,
        card_name: f.razao_social || f.nome_fantasia || "(sem nome)",
        card_type: "S",
        federal_tax_id: tax,
        u_fgr_taxid0: tax,
        email: f.email || null,
        phone1: f.telefone1 || null,
        phone2: f.telefone2 || null,
        currency: "BRL",
        bill_to_street: [f.logradouro, f.numero].filter(Boolean).join(", ") || null,
        bill_to_zip: f.cep || null,
        bill_to_city: f.municipio || null,
        bill_to_state: f.uf || null,
        bill_to_country: "BR",
        bill_to_block: f.bairro || null,
        bill_to_building: f.complemento || null,
        is_active: true,
        sap_sync_status: "pending",
        sap_sync_error: null,
        sap_last_synced_at: null,
        source: "local",
        created_at: f.created_at,
        updated_at: f.updated_at,
      };
      result.push({ kind: "fornecedor", id: f.id, tipo_pessoa: f.tipo_pessoa, raw: f, display });
    }
    setPending(result);
  }, [session?.companyDB, suppliers]);

  useEffect(() => {
    void loadFornecedores();
  }, [loadFornecedores]);

  const allRows = useMemo(() => {
    const arr: Supplier[] = [...suppliers, ...pending.map((p) => p.display)];
    arr.sort((a, b) => (a.card_name || "").localeCompare(b.card_name || ""));
    return arr;
  }, [suppliers, pending]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allRows;
    const qDigits = q.replace(/\D/g, "");
    return allRows.filter((s) => {
      if (s.card_name.toLowerCase().includes(q)) return true;
      if ((s.card_code || "").toLowerCase().includes(q)) return true;
      if ((s.email || "").toLowerCase().includes(q)) return true;
      if (qDigits.length >= 3) {
        const taxDigits = (s.federal_tax_id || "").replace(/\D/g, "");
        if (taxDigits.includes(qDigits)) return true;
        const phoneDigits = `${s.phone1 || ""}${s.phone2 || ""}`.replace(/\D/g, "");
        if (phoneDigits.includes(qDigits)) return true;
      }
      return false;
    });
  }, [allRows, search]);

  const needsSync = (s: Supplier) =>
    s.id.startsWith("forn:") || s.sap_sync_status === "error" || s.sap_sync_status === "pending" || s.sap_sync_status === "skipped";

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

  const handleSendToSap = async (s: Supplier) => {
    if (!session) {
      toast.error("Sem sessão SAP ativa");
      return;
    }
    setSyncing(s.id);
    try {
      if (s.id.startsWith("forn:")) {
        const pf = pending.find((p) => `forn:${p.id}` === s.id);
        if (!pf) return;
        const r = await syncFornecedorToSap(pf.raw, session);
        if (r.ok) {
          toast.success(r.skipped ? "Já existia no SAP" : "Enviado ao SAP", { description: r.message });
        } else {
          toast.error("Falha ao enviar ao SAP", { description: r.message });
        }
      } else {
        const updated = await retrySupplierToSap(s, session);
        if (updated.sap_sync_status === "synced") {
          toast.success("Enviado ao SAP", { description: `CardCode ${updated.card_code || ""}` });
        } else {
          toast.error("Falha ao enviar ao SAP", { description: updated.sap_sync_error || undefined });
        }
      }
      await refresh();
      await loadFornecedores();
    } catch (e) {
      toast.error("Erro ao enviar ao SAP", { description: e instanceof Error ? e.message : undefined });
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
    for (const s of targets) {
      try {
        if (s.id.startsWith("forn:")) {
          const pf = pending.find((p) => `forn:${p.id}` === s.id);
          if (!pf) continue;
          const r = await syncFornecedorToSap(pf.raw, session);
          if (r.ok) ok++;
          else fail++;
        } else {
          const updated = await retrySupplierToSap(s, session);
          if (updated.sap_sync_status === "synced") ok++;
          else fail++;
        }
      } catch {
        fail++;
      }
    }
    setBulkBusy(false);
    toast[fail ? "warning" : "success"](`Reenvio concluído: ${ok} ok, ${fail} falha(s)`);
    await refresh();
    await loadFornecedores();
  };

  const companyLabel = getLabel(session?.companyDB || "");
  const pendingCount = allRows.filter(needsSync).length;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <PageTitle title="Fornecedores" />
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
              <Building2 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Fornecedores</h1>
              <p className="text-xs text-muted-foreground">
                Cadastro PJ via CNPJ (Receita) / PF, listagem SAP + locais e reenvio ao SAP.
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
                placeholder="Nome, CNPJ/CPF, CardCode..."
                className="pl-9 bg-card"
              />
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              void refresh();
              void loadFornecedores();
            }}
            disabled={isLoading}
            className="gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          {canWrite && (
            <>
              <Button
                variant="outline"
                onClick={handleBulkSync}
                disabled={bulkBusy || pendingCount === 0 || !session}
                className="gap-2"
              >
                {bulkBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                Reenviar pendentes/erros {pendingCount > 0 && `(${pendingCount})`}
              </Button>
              <Button onClick={() => setCreating(true)} className="gap-2">
                <Plus className="w-4 h-4" />
                Novo Fornecedor
              </Button>
            </>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-2 max-w-7xl mx-auto">
          SAP+local: {suppliers.length} · Locais pendentes: {pending.length} · Exibindo: {filtered.length}
        </p>
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
                filtered.map((s) => {
                  const isLocalPending = s.id.startsWith("forn:");
                  const canSync = needsSync(s);
                  return (
                    <TableRow key={s.id} className={!s.is_active ? "opacity-60" : ""}>
                      <TableCell className="font-mono text-xs">
                        {s.card_code || (isLocalPending ? <Badge variant="outline">Local</Badge> : "—")}
                      </TableCell>
                      <TableCell className="font-medium">{s.card_name}</TableCell>
                      <TableCell className="text-xs">
                        {(() => {
                          const c = (s.bill_to_country || "BR").toUpperCase();
                          return (
                            <span
                              className={
                                c === "BR"
                                  ? "text-muted-foreground"
                                  : "px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold"
                              }
                            >
                              {c}
                            </span>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{s.federal_tax_id || "—"}</TableCell>
                      <TableCell className="text-xs">{s.email || "—"}</TableCell>
                      <TableCell className="text-xs">{s.phone1 || "—"}</TableCell>
                      <TableCell>{s.currency}</TableCell>
                      <TableCell>
                        <StatusBadge s={s} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex gap-1">
                          {canSync && canWrite && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => handleSendToSap(s)}
                                  disabled={syncing === s.id || bulkBusy || !session}
                                  className="text-primary hover:text-primary"
                                >
                                  {syncing === s.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <CloudUpload className="w-4 h-4" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Enviar ao SAP</TooltipContent>
                            </Tooltip>
                          )}
                          {!isLocalPending && canWrite && (
                            <>
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
                                    className={
                                      s.is_active
                                        ? "text-warning hover:text-warning"
                                        : "text-success hover:text-success"
                                    }
                                  >
                                    <Power className="w-4 h-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>{s.is_active ? "Desativar" : "Ativar"}</TooltipContent>
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

      <NewFornecedorDialog
        open={creating}
        session={session}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          void refresh();
          void loadFornecedores();
        }}
      />

      <SupplierFormModal
        open={!!editing}
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void refresh();
        }}
      />
    </div>
  );
}
