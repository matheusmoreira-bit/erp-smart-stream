import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Building2,
  Plus,
  Pencil,
  Trash2,
  ArrowLeft,
  Shield,
  Key,
  ChevronDown,
  ChevronUp,
  Save,
  Loader2,
  LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Company {
  id: string;
  company_db: string;
  display_name: string;
  is_active: boolean;
  created_at: string;
}

interface Credential {
  id: string;
  system_name: string;
  credential_key: string;
  credential_value: string;
  company_db: string | null;
}

export default function Admin() {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Record<string, Credential[]>>({});
  const [credLoading, setCredLoading] = useState<string | null>(null);

  // Company dialog
  const [companyDialog, setCompanyDialog] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [companyForm, setCompanyForm] = useState({ company_db: "", display_name: "", is_active: true });
  const [saving, setSaving] = useState(false);

  // Credential dialog
  const [credDialog, setCredDialog] = useState(false);
  const [credCompanyDb, setCredCompanyDb] = useState("");
  const [credForm, setCredForm] = useState({ system_name: "", credential_key: "", credential_value: "" });
  const [credSaving, setCredSaving] = useState(false);

  const fetchCompanies = async () => {
    const { data, error } = await supabase
      .from("companies")
      .select("*")
      .order("display_name");
    if (error) {
      toast.error("Erro ao carregar empresas");
      return;
    }
    setCompanies(data || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchCompanies();
  }, []);

  const fetchCredentials = async (companyDb: string) => {
    setCredLoading(companyDb);
    const { data, error } = await supabase
      .from("system_credentials")
      .select("*")
      .eq("company_db", companyDb)
      .order("system_name");
    if (!error) {
      setCredentials((prev) => ({ ...prev, [companyDb]: data || [] }));
    }
    setCredLoading(null);
  };

  const toggleExpand = (companyDb: string) => {
    if (expandedCompany === companyDb) {
      setExpandedCompany(null);
    } else {
      setExpandedCompany(companyDb);
      if (!credentials[companyDb]) {
        fetchCredentials(companyDb);
      }
    }
  };

  // Company CRUD
  const openNewCompany = () => {
    setEditingCompany(null);
    setCompanyForm({ company_db: "", display_name: "", is_active: true });
    setCompanyDialog(true);
  };

  const openEditCompany = (c: Company) => {
    setEditingCompany(c);
    setCompanyForm({ company_db: c.company_db, display_name: c.display_name, is_active: c.is_active });
    setCompanyDialog(true);
  };

  const saveCompany = async () => {
    if (!companyForm.company_db || !companyForm.display_name) {
      toast.error("Preencha todos os campos");
      return;
    }
    setSaving(true);
    if (editingCompany) {
      const { error } = await supabase
        .from("companies")
        .update({
          company_db: companyForm.company_db,
          display_name: companyForm.display_name,
          is_active: companyForm.is_active,
        })
        .eq("id", editingCompany.id);
      if (error) toast.error("Erro ao atualizar");
      else toast.success("Empresa atualizada");
    } else {
      const { error } = await supabase.from("companies").insert({
        company_db: companyForm.company_db,
        display_name: companyForm.display_name,
        is_active: companyForm.is_active,
      });
      if (error) toast.error(error.message.includes("duplicate") ? "Código já existe" : "Erro ao criar");
      else toast.success("Empresa criada");
    }
    setSaving(false);
    setCompanyDialog(false);
    fetchCompanies();
  };

  const deleteCompany = async (c: Company) => {
    if (!confirm(`Excluir empresa "${c.display_name}"?`)) return;
    const { error } = await supabase.from("companies").delete().eq("id", c.id);
    if (error) toast.error("Erro ao excluir");
    else {
      toast.success("Empresa excluída");
      fetchCompanies();
    }
  };

  const toggleActive = async (c: Company) => {
    const { error } = await supabase
      .from("companies")
      .update({ is_active: !c.is_active })
      .eq("id", c.id);
    if (!error) fetchCompanies();
  };

  // Credential CRUD
  const openNewCredential = (companyDb: string) => {
    setCredCompanyDb(companyDb);
    setCredForm({ system_name: "", credential_key: "", credential_value: "" });
    setCredDialog(true);
  };

  const saveCredential = async () => {
    if (!credForm.system_name || !credForm.credential_key || !credForm.credential_value) {
      toast.error("Preencha todos os campos");
      return;
    }
    setCredSaving(true);
    const { error } = await supabase.from("system_credentials").upsert(
      {
        company_db: credCompanyDb,
        system_name: credForm.system_name,
        credential_key: credForm.credential_key,
        credential_value: credForm.credential_value,
      },
      { onConflict: "company_db,system_name,credential_key" }
    );
    if (error) toast.error("Erro ao salvar credencial");
    else {
      toast.success("Credencial salva");
      fetchCredentials(credCompanyDb);
    }
    setCredSaving(false);
    setCredDialog(false);
  };

  const deleteCredential = async (cred: Credential) => {
    if (!confirm(`Excluir credencial "${cred.credential_key}"?`)) return;
    const { error } = await supabase.from("system_credentials").delete().eq("id", cred.id);
    if (!error && cred.company_db) {
      toast.success("Credencial excluída");
      fetchCredentials(cred.company_db);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("admin_authenticated");
    navigate("/admin/login");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Administração</h1>
              <p className="text-xs text-muted-foreground">Gerenciamento de empresas e credenciais</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
              <ArrowLeft className="w-4 h-4 mr-1" />
              Voltar
            </Button>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              <LogOut className="w-4 h-4 mr-1" />
              Sair
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-foreground">Empresas</h2>
          <Button onClick={openNewCompany} size="sm">
            <Plus className="w-4 h-4 mr-1" />
            Nova Empresa
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3">
            {companies.map((c, i) => (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="glass-card overflow-hidden"
              >
                {/* Company row */}
                <div className="flex items-center gap-4 p-4">
                  <div className="p-2 rounded-lg bg-muted">
                    <Building2 className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground">{c.display_name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{c.company_db}</p>
                  </div>
                  <Badge variant={c.is_active ? "default" : "secondary"}>
                    {c.is_active ? "Ativa" : "Inativa"}
                  </Badge>
                  <Switch checked={c.is_active} onCheckedChange={() => toggleActive(c)} />
                  <Button variant="ghost" size="icon" onClick={() => openEditCompany(c)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => deleteCompany(c)}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => toggleExpand(c.company_db)}>
                    {expandedCompany === c.company_db ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </Button>
                </div>

                {/* Credentials panel */}
                {expandedCompany === c.company_db && (
                  <div className="border-t border-border bg-muted/20 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Key className="w-4 h-4 text-primary" />
                        Credenciais
                      </div>
                      <Button variant="outline" size="sm" onClick={() => openNewCredential(c.company_db)}>
                        <Plus className="w-3 h-3 mr-1" />
                        Adicionar
                      </Button>
                    </div>

                    {credLoading === c.company_db ? (
                      <div className="flex justify-center py-4">
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : (credentials[c.company_db] || []).length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        Nenhuma credencial configurada
                      </p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Sistema</TableHead>
                            <TableHead>Chave</TableHead>
                            <TableHead>Valor</TableHead>
                            <TableHead className="w-12" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(credentials[c.company_db] || []).map((cred) => (
                            <TableRow key={cred.id}>
                              <TableCell className="font-medium">{cred.system_name}</TableCell>
                              <TableCell className="font-mono text-xs">{cred.credential_key}</TableCell>
                              <TableCell className="font-mono text-xs">••••••••</TableCell>
                              <TableCell>
                                <Button variant="ghost" size="icon" onClick={() => deleteCredential(cred)}>
                                  <Trash2 className="w-3 h-3 text-destructive" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </main>

      {/* Company Dialog */}
      <Dialog open={companyDialog} onOpenChange={setCompanyDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCompany ? "Editar Empresa" : "Nova Empresa"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Nome</label>
              <Input
                value={companyForm.display_name}
                onChange={(e) => setCompanyForm((f) => ({ ...f, display_name: e.target.value }))}
                placeholder="Nome da empresa"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Código da Base (company_db)</label>
              <Input
                value={companyForm.company_db}
                onChange={(e) => setCompanyForm((f) => ({ ...f, company_db: e.target.value }))}
                placeholder="SBO_NOME_EMPRESA"
                className="font-mono"
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={companyForm.is_active}
                onCheckedChange={(v) => setCompanyForm((f) => ({ ...f, is_active: v }))}
              />
              <span className="text-sm text-foreground">Empresa ativa</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompanyDialog(false)}>Cancelar</Button>
            <Button onClick={saveCompany} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Credential Dialog */}
      <Dialog open={credDialog} onOpenChange={setCredDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Credencial</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Sistema</label>
              <Input
                value={credForm.system_name}
                onChange={(e) => setCredForm((f) => ({ ...f, system_name: e.target.value }))}
                placeholder="Ex: SAP, JumpCloud, PagCorp"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Chave</label>
              <Input
                value={credForm.credential_key}
                onChange={(e) => setCredForm((f) => ({ ...f, credential_key: e.target.value }))}
                placeholder="Ex: api_key, password, base_url"
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Valor</label>
              <Input
                type="password"
                value={credForm.credential_value}
                onChange={(e) => setCredForm((f) => ({ ...f, credential_value: e.target.value }))}
                placeholder="Valor da credencial"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCredDialog(false)}>Cancelar</Button>
            <Button onClick={saveCredential} disabled={credSaving}>
              {credSaving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
