import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Building2, Plus, Search, RefreshCw, Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ThemeToggle } from "@/components/ThemeToggle";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSap } from "@/contexts/SapContext";
import {
  createSupplier,
  findSupplierByTaxId,
  type SupplierInput,
} from "@/hooks/useSuppliers";
import type { SapSession } from "@/lib/sap-client";


type Fornecedor = {
  id: string;
  tipo_pessoa: "pj" | "pf";
  cnpj: string | null;
  cpf: string | null;
  razao_social: string | null;
  nome_fantasia: string | null;
  municipio: string | null;
  uf: string | null;
  situacao_cadastral: string | null;
};

const digits = (s: string) => (s || "").replace(/\D+/g, "");

export default function CadastroFornecedores() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { session } = useSap();
  const [rows, setRows] = useState<Fornecedor[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [openNew, setOpenNew] = useState(false);


  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("fornecedores")
      .select("id,tipo_pessoa,cnpj,cpf,razao_social,nome_fantasia,municipio,uf,situacao_cadastral")
      .order("razao_social", { ascending: true })
      .limit(1000);
    if (error) toast.error(error.message);
    setRows((data ?? []) as any);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        (r.razao_social ?? "").toLowerCase().includes(q) ||
        (r.nome_fantasia ?? "").toLowerCase().includes(q) ||
        (r.cnpj ?? "").includes(digits(q)) ||
        (r.cpf ?? "").includes(digits(q)),
    );
  }, [rows, search]);

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
              <h1 className="text-xl font-bold text-foreground">Cadastro de Fornecedores</h1>
              <p className="text-xs text-muted-foreground">PJ via CNPJ (Receita) ou PF manual — sem dados bancários.</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <button onClick={signOut} className="text-xs text-muted-foreground hover:text-foreground">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[260px]">
            <Label className="text-xs text-muted-foreground mb-1 block">Buscar</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Razão social, nome fantasia, CNPJ, CPF..."
                className="pl-9 bg-card"
              />
            </div>
          </div>
          <Button variant="outline" onClick={load} disabled={loading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button onClick={() => setOpenNew(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            Novo Fornecedor
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2 max-w-7xl mx-auto">
          Total: {rows.length} · Exibindo: {filtered.length}
        </p>
      </div>

      <main className="flex-1 px-6 py-6">
        <div className="max-w-7xl mx-auto glass-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Razão Social / Nome</TableHead>
                <TableHead>CNPJ / CPF</TableHead>
                <TableHead>Município/UF</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && !loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                    Nenhum fornecedor.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Badge variant="secondary">{r.tipo_pessoa.toUpperCase()}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">
                      {r.razao_social ?? r.nome_fantasia ?? "—"}
                      {r.nome_fantasia && r.razao_social ? (
                        <span className="block text-xs text-muted-foreground">{r.nome_fantasia}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.cnpj ?? r.cpf ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {[r.municipio, r.uf].filter(Boolean).join("/") || "—"}
                    </TableCell>
                    <TableCell className="text-xs">{r.situacao_cadastral ?? "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </main>

      <NewFornecedorDialog
        open={openNew}
        session={session as SapSession | null}
        onClose={() => setOpenNew(false)}
        onSaved={() => {
          setOpenNew(false);
          load();
        }}
      />
    </div>
  );
}

/**
 * Promotes a fornecedor (local) to suppliers + SAP for the active company.
 * - If the same federal tax id already exists in suppliers for this companyDB, skips.
 * - Otherwise creates a BusinessPartner in SAP and a row in suppliers via createSupplier.
 */
async function syncFornecedorToSap(
  fornecedor: any,
  session: SapSession,
): Promise<{ ok: boolean; skipped?: boolean; message?: string }> {
  const taxId = digits(String(fornecedor?.cnpj || fornecedor?.cpf || ""));
  if (!taxId) return { ok: false, message: "Sem CNPJ/CPF para enviar ao SAP" };

  // Skip if already mirrored for this company
  const existing = await findSupplierByTaxId(taxId, session.companyDB);
  if (existing) {
    return { ok: true, skipped: true, message: `Já existe em ${session.companyDB} (CardCode ${existing.card_code || "?"})` };
  }

  const name = String(fornecedor?.razao_social || fornecedor?.nome_fantasia || "").trim();
  if (!name) return { ok: false, message: "Sem razão social/nome" };

  const street = [fornecedor?.logradouro, fornecedor?.numero].filter(Boolean).join(", ") || null;
  const input: SupplierInput = {
    company_db: session.companyDB,
    card_code: null,
    card_name: name.slice(0, 100),
    card_type: "S",
    federal_tax_id: taxId,
    u_fgr_taxid0: taxId,
    email: fornecedor?.email || null,
    phone1: fornecedor?.telefone1 || null,
    phone2: fornecedor?.telefone2 || null,
    currency: "BRL",
    bill_to_street: street,
    bill_to_zip: (fornecedor?.cep || "").replace(/\D/g, "") || null,
    bill_to_city: fornecedor?.municipio || null,
    bill_to_state: fornecedor?.uf || null,
    bill_to_country: fornecedor?.pais && String(fornecedor.pais).toUpperCase() !== "BRASIL" ? fornecedor.pais : "BR",
    bill_to_block: fornecedor?.bairro || null,
    bill_to_building: fornecedor?.complemento || null,
    is_active: true,
    source: "local",
  };

  try {
    const created = await createSupplier(input, session);
    if (created.sap_sync_status === "error") {
      return { ok: false, message: created.sap_sync_error || "Erro ao criar no SAP" };
    }
    return { ok: true, message: `Criado no SAP (CardCode ${created.card_code || "?"})` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Erro ao sincronizar SAP" };
  }
}


function NewFornecedorDialog({
  open,
  session,
  onClose,
  onSaved,
}: {
  open: boolean;
  session: SapSession | null;
  onClose: () => void;
  onSaved: () => void;
}) {

  const [tipo, setTipo] = useState<"pj" | "pf">("pj");
  const [cnpj, setCnpj] = useState("");
  const [form, setForm] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!open) {
      setTipo("pj");
      setCnpj("");
      setForm({});
      setHydrated(false);
    }
  }, [open]);

  const buscarCnpj = async () => {
    const d = digits(cnpj);
    if (d.length !== 14) {
      toast.error("CNPJ deve ter 14 dígitos");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("cnpj-lookup", { body: { cnpj: d } });
      if (error) throw error;
      if (data?.exists) {
        // Já existe em fornecedores — carrega os dados existentes para permitir
        // promover ao SAP da empresa ativa (caso ainda não esteja lá).
        setForm(data.fornecedor ?? {});
        setHydrated(true);
        toast.warning("Fornecedor já cadastrado localmente", {
          description: "Você pode revisar e enviar ao SAP da empresa ativa.",
        });
        return;
      }
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      setForm(data?.data ?? {});
      setHydrated(true);
      toast.success("Dados carregados da Receita");
    } catch (e: any) {
      toast.error(e?.message || "Falha ao consultar CNPJ");
    } finally {
      setBusy(false);
    }
  };


  const salvarPj = async () => {
    if (!hydrated) {
      toast.error("Busque o CNPJ primeiro");
      return;
    }
    setBusy(true);
    try {
      const payload = { ...form, tipo_pessoa: "pj", cnpj: digits(form.cnpj || cnpj) };
      const { data, error } = await supabase.functions.invoke("fornecedor-save", { body: { payload } });
      if (error) {
        const msg = (data as any)?.error || error.message || "Falha ao cadastrar";
        toast.error(msg);
        return;
      }
      if ((data as any)?.error) {
        toast.error((data as any).error);
        return;
      }
      toast.success("Fornecedor cadastrado");
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  const salvarPf = async () => {
    const d = digits(form.cpf || "");
    if (d.length !== 11) {
      toast.error("CPF deve ter 11 dígitos");
      return;
    }
    if (!form.razao_social?.trim()) {
      toast.error("Nome obrigatório");
      return;
    }
    setBusy(true);
    try {
      const payload = { ...form, tipo_pessoa: "pf", cpf: d };
      const { data, error } = await supabase.functions.invoke("fornecedor-save", { body: { payload } });
      if (error) {
        const msg = (data as any)?.error || error.message || "Falha ao cadastrar";
        toast.error(msg);
        return;
      }
      if ((data as any)?.error) {
        toast.error((data as any).error);
        return;
      }
      toast.success("Fornecedor cadastrado");
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  const field = (key: string, label: string, opts: { type?: string; col?: number } = {}) => (
    <div className={`grid gap-1 ${opts.col === 2 ? "col-span-2" : ""}`}>
      <Label className="text-xs">{label}</Label>
      <Input
        type={opts.type ?? "text"}
        value={form[key] ?? ""}
        onChange={(e) => setForm((f: any) => ({ ...f, [key]: e.target.value }))}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo Fornecedor</DialogTitle>
          <DialogDescription>
            Sem campos bancários ou formas de pagamento — esses dados são configurados depois no SAP.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>Tipo de pessoa</Label>
            <Select value={tipo} onValueChange={(v) => { setTipo(v as any); setForm({}); setHydrated(false); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pj">Pessoa Jurídica (busca por CNPJ)</SelectItem>
                <SelectItem value="pf">Pessoa Física (manual)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {tipo === "pj" ? (
            <>
              <div className="flex gap-2 items-end">
                <div className="flex-1 grid gap-1">
                  <Label className="text-xs">CNPJ</Label>
                  <Input value={cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="00.000.000/0000-00" />
                </div>
                <Button onClick={buscarCnpj} disabled={busy} className="gap-2">
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  Buscar dados
                </Button>
              </div>
              {hydrated && (
                <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
                  {field("razao_social", "Razão Social", { col: 2 })}
                  {field("nome_fantasia", "Nome Fantasia", { col: 2 })}
                  {field("tipo_estabelecimento", "Tipo")}
                  {field("situacao_cadastral", "Situação")}
                  {field("data_inicio_atividade", "Início Atividade", { type: "date" })}
                  {field("porte", "Porte")}
                  {field("natureza_juridica_descricao", "Natureza Jurídica", { col: 2 })}
                  {field("capital_social", "Capital Social", { type: "number" })}
                  {field("cnae_principal_codigo", "CNAE Principal")}
                  {field("cnae_principal_descricao", "Descrição CNAE Principal", { col: 2 })}
                  {field("logradouro", "Logradouro", { col: 2 })}
                  {field("numero", "Número")}
                  {field("complemento", "Complemento")}
                  {field("bairro", "Bairro")}
                  {field("cep", "CEP")}
                  {field("municipio", "Município")}
                  {field("uf", "UF")}
                  {field("pais", "País")}
                  {field("telefone1", "Telefone 1")}
                  {field("telefone2", "Telefone 2")}
                  {field("email", "E-mail", { col: 2 })}
                  {field("inscricao_estadual", "Inscrição Estadual", { col: 2 })}
                </div>
              )}
            </>
          ) : (
            <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
              {field("cpf", "CPF (somente dígitos)")}
              {field("razao_social", "Nome completo", { col: 2 })}
              {field("logradouro", "Logradouro", { col: 2 })}
              {field("numero", "Número")}
              {field("complemento", "Complemento")}
              {field("bairro", "Bairro")}
              {field("cep", "CEP")}
              {field("municipio", "Município")}
              {field("uf", "UF")}
              {field("telefone1", "Telefone")}
              {field("email", "E-mail", { col: 2 })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={tipo === "pj" ? salvarPj : salvarPf} disabled={busy} className="gap-2">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
