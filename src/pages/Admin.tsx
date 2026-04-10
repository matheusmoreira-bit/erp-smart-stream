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
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  ScrollText,
  RefreshCw,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { SYSTEMS, type SystemConfig } from "@/lib/system-definitions";
import { useAuth } from "@/hooks/useAuth";
import { useAuditLog } from "@/hooks/useAuditLog";
import AuditLogTable from "@/components/AuditLogTable";
import PermissionManager from "@/components/PermissionManager";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
/* ── Types ── */

interface Company {
  id: string;
  company_db: string;
  display_name: string;
  service_layer_url: string | null;
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

/* ── System Credential Modal ── */

function SystemCredentialModal({
  system,
  companyDb,
  existingKeys,
  open,
  onOpenChange,
  onSaved,
}: {
  system: SystemConfig;
  companyDb: string;
  existingKeys: string[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const Icon = system.icon;

  const handleSave = async () => {
    const creds = system.fields
      .filter((f) => values[f.key]?.trim())
      .map((f) => ({
        company_db: companyDb,
        system_name: system.name,
        credential_key: f.key,
        credential_value: values[f.key].trim(),
      }));

    if (creds.length === 0) {
      toast.error("Preencha pelo menos um campo");
      return;
    }

    setSaving(true);
    for (const cred of creds) {
      const { error } = await supabase.from("system_credentials").upsert(cred, {
        onConflict: "company_db,system_name,credential_key",
      });
      if (error) {
        toast.error(`Erro ao salvar ${cred.credential_key}`);
        setSaving(false);
        return;
      }
    }
    toast.success(`Credenciais do ${system.label} salvas`);
    setSaving(false);
    setValues({});
    onSaved();
    onOpenChange(false);
  };

  const handleDeleteAll = async () => {
    if (!confirm(`Remover todas as credenciais do ${system.label}?`)) return;
    setSaving(true);
    await supabase
      .from("system_credentials")
      .delete()
      .eq("company_db", companyDb)
      .eq("system_name", system.name);
    toast.success(`Credenciais do ${system.label} removidas`);
    setSaving(false);
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Icon className="w-5 h-5 text-primary" />
            </div>
            <div>
              <DialogTitle>{system.label}</DialogTitle>
              <DialogDescription>{system.description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
          {system.fields.map((field) => {
            const isConfigured = existingKeys.includes(field.key);
            const isPassword = field.type === "password";
            const showPw = showPasswords[field.key];

            return (
              <div key={field.key} className="space-y-1.5">
                <Label className="text-sm text-muted-foreground flex items-center gap-2">
                  {field.label}
                  {isConfigured && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
                </Label>
                <div className="relative">
                  <Input
                    type={isPassword && !showPw ? "password" : "text"}
                    placeholder={isConfigured ? "••••••• (já configurado)" : field.placeholder}
                    value={values[field.key] || ""}
                    onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    className="bg-card pr-10"
                  />
                  {isPassword && (
                    <button
                      type="button"
                      onClick={() =>
                        setShowPasswords((prev) => ({ ...prev, [field.key]: !prev[field.key] }))
                      }
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {existingKeys.length > 0 && (
            <Button
              variant="outline"
              onClick={handleDeleteAll}
              disabled={saving}
              className="gap-2 text-destructive hover:text-destructive mr-auto"
            >
              <Trash2 className="w-4 h-4" />
              Remover
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Main Admin Page ── */

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
  const [companyForm, setCompanyForm] = useState({ company_db: "", display_name: "", service_layer_url: "", is_active: true });
  const [saving, setSaving] = useState(false);

  // System credential modal
  const [selectedSystem, setSelectedSystem] = useState<SystemConfig | null>(null);
  const [selectedCompanyDb, setSelectedCompanyDb] = useState("");

  // Audit log
  const [activeTab, setActiveTab] = useState<"companies" | "audit" | "permissions">("companies");
  const [auditCompanyFilter, setAuditCompanyFilter] = useState("all");
  const auditCompanyDb = auditCompanyFilter === "all" ? undefined : auditCompanyFilter;
  const { entries: auditEntries, isLoading: auditLoading, refresh: auditRefresh } = useAuditLog(auditCompanyDb);

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

    // Realtime: sync credentials changes from other sessions
    const channel = supabase
      .channel("admin-credentials-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "system_credentials" },
        () => {
          // Refresh credentials for the currently expanded company
          if (expandedCompany) {
            fetchCredentials(expandedCompany);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "companies" },
        () => {
          fetchCompanies();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [expandedCompany]);

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
      fetchCredentials(companyDb);
    }
  };

  const getKeysForSystem = (companyDb: string, systemName: string) =>
    (credentials[companyDb] || [])
      .filter((c) => c.system_name === systemName)
      .map((c) => c.credential_key);

  // Company CRUD
  const openNewCompany = () => {
    setEditingCompany(null);
    setCompanyForm({ company_db: "", display_name: "", service_layer_url: "", is_active: true });
    setCompanyDialog(true);
  };

  const openEditCompany = (c: Company) => {
    setEditingCompany(c);
    setCompanyForm({ company_db: c.company_db, display_name: c.display_name, service_layer_url: c.service_layer_url || "", is_active: c.is_active });
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
          service_layer_url: companyForm.service_layer_url || null,
          is_active: companyForm.is_active,
        })
        .eq("id", editingCompany.id);
      if (error) toast.error("Erro ao atualizar");
      else toast.success("Empresa atualizada");
    } else {
      const { error } = await supabase.from("companies").insert({
        company_db: companyForm.company_db,
        display_name: companyForm.display_name,
        service_layer_url: companyForm.service_layer_url || null,
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

  const { signOut } = useAuth();

  const handleLogout = async () => {
    await signOut();
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
        {/* Tabs */}
        <div className="flex items-center gap-1 mb-6 border-b border-border">
          <button
            onClick={() => setActiveTab("companies")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "companies"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Building2 className="w-4 h-4 inline mr-1.5" />
            Empresas
          </button>
          <button
            onClick={() => setActiveTab("permissions")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "permissions"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Users className="w-4 h-4 inline mr-1.5" />
            Permissões
          </button>
          <button
            onClick={() => setActiveTab("audit")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "audit"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <ScrollText className="w-4 h-4 inline mr-1.5" />
            Logs de Auditoria
          </button>
        </div>

        {activeTab === "companies" && (
          <>
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

                    {/* Credentials panel — system cards */}
                    {expandedCompany === c.company_db && (
                      <div className="border-t border-border bg-muted/20 p-4">
                        <div className="flex items-center gap-2 text-sm font-medium text-foreground mb-4">
                          <Key className="w-4 h-4 text-primary" />
                          Credenciais
                        </div>

                        {credLoading === c.company_db ? (
                          <div className="flex justify-center py-4">
                            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            {SYSTEMS.map((sys) => {
                              const keys = getKeysForSystem(c.company_db, sys.name);
                              const isConfigured = keys.length > 0;
                              const configuredCount = keys.length;
                              const totalFields = sys.fields.length;
                              const Icon = sys.icon;

                              return (
                                <button
                                  key={sys.name}
                                  onClick={() => {
                                    setSelectedSystem(sys);
                                    setSelectedCompanyDb(c.company_db);
                                  }}
                                  className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:border-primary/40 transition-all text-left"
                                >
                                  <div className="p-2 rounded-lg bg-primary/10">
                                    <Icon className="w-4 h-4 text-primary" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-foreground">{sys.label}</p>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                      {isConfigured ? (
                                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                                          <CheckCircle2 className="w-2.5 h-2.5" />
                                          {configuredCount}/{totalFields}
                                        </Badge>
                                      ) : (
                                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1">
                                          <XCircle className="w-2.5 h-2.5" />
                                          Não configurado
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === "permissions" && <PermissionManager />}

        {activeTab === "audit" && (
          <>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-foreground">Logs de Auditoria</h2>
                <Select value={auditCompanyFilter} onValueChange={setAuditCompanyFilter}>
                  <SelectTrigger className="w-[240px] bg-card">
                    <SelectValue placeholder="Empresa" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as empresas</SelectItem>
                    {companies.map((c) => (
                      <SelectItem key={c.company_db} value={c.company_db}>{c.display_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" size="sm" onClick={auditRefresh} disabled={auditLoading}>
                <RefreshCw className={`w-4 h-4 mr-2 ${auditLoading ? "animate-spin" : ""}`} />
                Atualizar
              </Button>
            </div>
            <AuditLogTable entries={auditEntries} isLoading={auditLoading} showCompanyColumn={auditCompanyFilter === "all"} />
          </>
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
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">URL do Service Layer</label>
              <Input
                value={companyForm.service_layer_url}
                onChange={(e) => setCompanyForm((f) => ({ ...f, service_layer_url: e.target.value }))}
                placeholder="https://servidor:50000/b1s/v1/"
                className="font-mono text-sm"
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

      {/* System Credential Modal */}
      {selectedSystem && (
        <SystemCredentialModal
          system={selectedSystem}
          companyDb={selectedCompanyDb}
          existingKeys={getKeysForSystem(selectedCompanyDb, selectedSystem.name)}
          open={!!selectedSystem}
          onOpenChange={(o) => {
            if (!o) setSelectedSystem(null);
          }}
          onSaved={() => fetchCredentials(selectedCompanyDb)}
        />
      )}
    </div>
  );
}
