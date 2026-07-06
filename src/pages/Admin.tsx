import { useState, useEffect } from "react";
import { DEFAULT_TARGETS, type CompanyTargets } from "@/hooks/useCompanies";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Target, Server, Box, Cloud, Layers, Globe, DollarSign, ImageIcon } from "lucide-react";
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
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
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
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { SYSTEMS, type SystemConfig } from "@/lib/system-definitions";
import { CustomFieldsEditor } from "@/components/CustomFieldsEditor";
import { useAuth } from "@/hooks/useAuth";
import { useAuditLog } from "@/hooks/useAuditLog";
import { useEnabledErpTypes } from "@/hooks/useEnabledErpTypes";
import AuditLogTable from "@/components/AuditLogTable";
import IntegrationsTab from "@/components/IntegrationsTab";
import PermissionManager from "@/components/PermissionManager";
import AdminUsersManager from "@/components/AdminUsersManager";
import TransferApprovalsTool from "@/components/TransferApprovalsTool";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageTitle } from "@/components/PageTitle";
/* ── Types ── */

interface Company {
  id: string;
  company_db: string;
  display_name: string;
  service_layer_url: string | null;
  is_active: boolean;
  created_at: string;
  targets: CompanyTargets;
  erp_type: string;
  default_currency: string;
  timezone: string;
  logo_url: string | null;
  legal_name: string | null;
  trade_name: string | null;
  tax_id: string | null;
  foreign_name: string | null;
  is_foreign: boolean;
  is_test?: boolean;
}

const ERP_TYPE_LABELS: Record<string, { label: string; icon: typeof Server }> = {
  sap: { label: "SAP Business One", icon: Server },
  omie: { label: "OMIE", icon: Box },
  s4hana_cloud: { label: "SAP S/4HANA Cloud", icon: Cloud },
  s4hana_cloud_private: { label: "SAP S/4HANA Cloud Private", icon: Cloud },
  s4hana_onprem: { label: "SAP S/4HANA On-Premise", icon: Building2 },
  totvs_protheus: { label: "TOTVS Protheus", icon: Layers },
  totvs_rm: { label: "TOTVS RM", icon: Layers },
  totvs_datasul: { label: "TOTVS Datasul", icon: Layers },
  netsuite: { label: "Oracle NetSuite", icon: Cloud },
};

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
  const [confirmDeleteAllOpen, setConfirmDeleteAllOpen] = useState(false);
  const Icon = system.icon;

  // Load existing non-secret values (custom_fields, toggle, default_branch_id) when dialog opens
  useEffect(() => {
    if (!open) return;
    const loadableKeys = system.fields
      .filter(
        (f) =>
          f.type !== "password" &&
          existingKeys.includes(f.key) &&
          (f.type === "custom_fields" ||
            f.type === "toggle" ||
            f.key === "default_branch_id"),
      )
      .map((f) => f.key);
    if (loadableKeys.length === 0) return;
    (async () => {
      const { data } = await supabase
        .from("system_credentials")
        .select("credential_key, credential_value")
        .eq("company_db", companyDb)
        .eq("system_name", system.name)
        .in("credential_key", loadableKeys);
      if (data) {
        const map: Record<string, string> = {};
        for (const row of data) map[row.credential_key] = row.credential_value;
        setValues((prev) => ({ ...map, ...prev }));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, system.name, companyDb]);

  const handleSave = async () => {
    const creds = system.fields
      .filter((f) => {
        if (f.type === "toggle") return values[f.key] !== undefined;
        return values[f.key]?.trim();
      })
      .map((f) => ({
        company_db: companyDb,
        system_name: system.name,
        credential_key: f.key,
        credential_value:
          f.type === "toggle"
            ? values[f.key] === "true"
              ? "true"
              : "false"
            : values[f.key].trim(),
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
    setConfirmDeleteAllOpen(false);
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
            const isCustom = field.type === "custom_fields";
            const isToggle = field.type === "toggle";
            const showPw = showPasswords[field.key];

            if (isCustom) {
              return (
                <CustomFieldsEditor
                  key={field.key}
                  value={values[field.key] || ""}
                  onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
                />
              );
            }

            if (isToggle) {
              const checked = values[field.key] === "true";
              return (
                <div
                  key={field.key}
                  className="md:col-span-2 flex items-start justify-between gap-4 rounded-lg border border-border bg-card p-4"
                >
      <PageTitle title="Backoffice" />
                  <div className="space-y-1">
                    <Label className="text-sm font-medium text-foreground flex items-center gap-2">
                      {field.label}
                      {isConfigured && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
                    </Label>
                    {field.description && (
                      <p className="text-xs text-muted-foreground">{field.description}</p>
                    )}
                  </div>
                  <Switch
                    checked={checked}
                    onCheckedChange={(v) =>
                      setValues((prev) => ({ ...prev, [field.key]: v ? "true" : "false" }))
                    }
                  />
                </div>
              );
            }

            return (
              <div key={field.key} className="space-y-1.5">
                <Label className="text-sm text-muted-foreground flex items-center gap-2">
                  {field.label}
                  {isConfigured && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
                </Label>
                <div className="relative">
                  <Input
                    type={isPassword && !showPw ? "password" : "text"}
                    placeholder={
                      isConfigured && isPassword
                        ? "••••••• (já configurado)"
                        : field.placeholder
                    }
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
              onClick={() => setConfirmDeleteAllOpen(true)}
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
      <ConfirmDialog
        open={confirmDeleteAllOpen}
        onOpenChange={setConfirmDeleteAllOpen}
        title={`Remover credenciais do ${system.label}?`}
        description="Esta ação remove permanentemente todas as credenciais deste sistema para a empresa."
        confirmLabel="Remover"
        destructive
        onConfirm={handleDeleteAll}
      />
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
  const { enabledNames } = useEnabledErpTypes();

  // Company dialog
  const [companyDialog, setCompanyDialog] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [companyForm, setCompanyForm] = useState({ company_db: "", display_name: "", service_layer_url: "", is_active: true, erp_type: "sap", default_currency: "BRL", timezone: "America/Sao_Paulo", logo_url: "" as string, legal_name: "", trade_name: "", tax_id: "", foreign_name: "", is_foreign: false, is_test: false, targets: { ...DEFAULT_TARGETS } });
  const [saving, setSaving] = useState(false);
  const [companyToDelete, setCompanyToDelete] = useState<Company | null>(null);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [wizardCreds, setWizardCreds] = useState<Record<string, string>>({});
  const [showWizardPasswords, setShowWizardPasswords] = useState<Record<string, boolean>>({});

  // System credential modal
  const [selectedSystem, setSelectedSystem] = useState<SystemConfig | null>(null);
  const [selectedCompanyDb, setSelectedCompanyDb] = useState("");

  // Audit log
  const [activeTab, setActiveTab] = useState<"companies" | "integrations" | "audit" | "permissions" | "admin_users" | "tools">("companies");
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
    setCompanies(
      (data || []).map((c) => ({
        ...c,
        targets: { ...DEFAULT_TARGETS, ...(c.targets as Record<string, number>) },
      })) as Company[]
    );
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
    setCompanyForm({ company_db: "", display_name: "", service_layer_url: "", is_active: true, erp_type: "", default_currency: "BRL", timezone: "America/Sao_Paulo", logo_url: "", legal_name: "", trade_name: "", tax_id: "", foreign_name: "", is_foreign: false, is_test: false, targets: { ...DEFAULT_TARGETS } });
    setWizardStep(1);
    setWizardCreds({});
    setShowWizardPasswords({});
    setCompanyDialog(true);
  };

  const openEditCompany = async (c: Company) => {
    setEditingCompany(c);
    setCompanyForm({ company_db: c.company_db, display_name: c.display_name, service_layer_url: c.service_layer_url || "", is_active: c.is_active, erp_type: c.erp_type || "sap", default_currency: c.default_currency || "BRL", timezone: c.timezone || "America/Sao_Paulo", logo_url: c.logo_url || "", legal_name: c.legal_name || "", trade_name: c.trade_name || "", tax_id: c.tax_id || "", foreign_name: c.foreign_name || "", is_foreign: !!c.is_foreign, is_test: !!c.is_test, targets: c.targets || { ...DEFAULT_TARGETS } });
    setWizardStep(1);
    setShowWizardPasswords({});
    setWizardCreds({});
    setCompanyDialog(true);

    // Pre-load existing ERP credentials so edit form shows saved values
    // (passwords are intentionally not pre-filled for safety).
    const erpType = c.erp_type || "sap";
    const system = SYSTEMS.find((s) => s.name === erpType);
    if (!system) return;
    const loadableKeys = system.fields
      .filter((f) => f.type !== "password")
      .map((f) => f.key);
    if (loadableKeys.length === 0) return;
    const { data } = await supabase
      .from("system_credentials")
      .select("credential_key, credential_value")
      .eq("company_db", c.company_db)
      .eq("system_name", erpType)
      .in("credential_key", loadableKeys);
    const map: Record<string, string> = {};
    for (const row of data || []) map[row.credential_key] = row.credential_value;
    setWizardCreds(map);
  };

  const saveCompany = async () => {
    if (!companyForm.company_db || !companyForm.display_name) {
      toast.error("Preencha todos os campos");
      return;
    }
    setSaving(true);
    const isNew = !editingCompany;
    let hasError = false;
    if (editingCompany) {
      const { error } = await supabase
        .from("companies")
        .update({
          company_db: companyForm.company_db,
          display_name: companyForm.display_name,
          service_layer_url: companyForm.service_layer_url || null,
          is_active: companyForm.is_active,
          erp_type: companyForm.erp_type,
          default_currency: companyForm.default_currency,
          timezone: companyForm.timezone,
          logo_url: companyForm.logo_url || null,
          targets: companyForm.targets,
          legal_name: companyForm.legal_name || null,
          trade_name: companyForm.trade_name || null,
          tax_id: companyForm.tax_id || null,
          foreign_name: companyForm.foreign_name || null,
          is_foreign: companyForm.is_foreign,
          is_test: companyForm.is_test,
        })
        .eq("id", editingCompany.id);
      if (error) { toast.error("Erro ao atualizar"); hasError = true; }
    } else {
      const { error } = await supabase.from("companies").insert({
        company_db: companyForm.company_db,
        display_name: companyForm.display_name,
        service_layer_url: companyForm.service_layer_url || null,
        is_active: companyForm.is_active,
        erp_type: companyForm.erp_type,
        default_currency: companyForm.default_currency,
        timezone: companyForm.timezone,
        logo_url: companyForm.logo_url || null,
        targets: companyForm.targets,
        legal_name: companyForm.legal_name || null,
        trade_name: companyForm.trade_name || null,
        tax_id: companyForm.tax_id || null,
        foreign_name: companyForm.foreign_name || null,
        is_foreign: companyForm.is_foreign,
        is_test: companyForm.is_test,
      });
      if (error) { toast.error(error.message.includes("duplicate") ? "Código já existe" : "Erro ao criar"); hasError = true; }
    }

    // Save ERP credentials from wizard step 3
    if (!hasError) {
      const wizardSystem = SYSTEMS.find((s) => s.name === companyForm.erp_type);
      const credEntries = (wizardSystem?.fields || [])
        .filter((field) => {
          if (field.type === "toggle") return wizardCreds[field.key] !== undefined;
          return !!wizardCreds[field.key]?.trim();
        })
        .map((field) => [
          field.key,
          field.type === "toggle"
            ? wizardCreds[field.key] === "true"
              ? "true"
              : "false"
            : wizardCreds[field.key].trim(),
        ] as const);
      if (credEntries.length > 0) {
        for (const [key, value] of credEntries) {
          await supabase.from("system_credentials").upsert(
            { company_db: companyForm.company_db, system_name: companyForm.erp_type, credential_key: key, credential_value: value },
            { onConflict: "company_db,system_name,credential_key" }
          );
        }
      }
      toast.success(isNew ? "Empresa criada com sucesso" : "Empresa atualizada");
    }

    setSaving(false);
    setCompanyDialog(false);
    await fetchCompanies();
    if (isNew) {
      setExpandedCompany(companyForm.company_db);
      fetchCredentials(companyForm.company_db);
    }
  };

  const deleteCompany = (c: Company) => {
    setCompanyToDelete(c);
  };

  const confirmDeleteCompany = async () => {
    if (!companyToDelete) return;
    const { error } = await supabase.from("companies").delete().eq("id", companyToDelete.id);
    if (error) toast.error("Erro ao excluir");
    else {
      toast.success("Empresa excluída");
      fetchCompanies();
    }
    setCompanyToDelete(null);
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
    navigate("/backoffice/login");
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
              <h1 className="text-xl font-bold text-foreground">Backoffice</h1>
              <p className="text-xs text-muted-foreground">Gerenciamento de empresas e credenciais</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
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
            onClick={() => setActiveTab("integrations")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "integrations"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Key className="w-4 h-4 inline mr-1.5" />
            Integrações
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
          <button
            onClick={() => setActiveTab("admin_users")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "admin_users"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <ShieldCheck className="w-4 h-4 inline mr-1.5" />
            Administradores
          </button>
          <button
            onClick={() => setActiveTab("tools")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "tools"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <RefreshCw className="w-4 h-4 inline mr-1.5" />
            Ferramentas
          </button>
          <button
            onClick={() => navigate("/backoffice/audit-trail")}
            className="px-4 py-2.5 text-sm font-medium border-b-2 border-transparent text-muted-foreground hover:text-foreground transition-colors"
          >
            <Shield className="w-4 h-4 inline mr-1.5" />
            Audit Trail
          </button>
          <button
            onClick={() => navigate("/backoffice/sap-users")}
            className="px-4 py-2.5 text-sm font-medium border-b-2 border-transparent text-muted-foreground hover:text-foreground transition-colors"
          >
            <Users className="w-4 h-4 inline mr-1.5" />
            Usuários SAP
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
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-foreground">{c.display_name}</p>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {ERP_TYPE_LABELS[c.erp_type]?.label || c.erp_type}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground font-mono">
                          {c.company_db}
                          {c.is_foreign && c.foreign_name ? ` · ${c.foreign_name}` : ""}
                          {!c.is_foreign && c.legal_name ? ` · ${c.legal_name}` : ""}
                          {!c.is_foreign && c.tax_id ? ` · ${c.tax_id}` : ""}
                        </p>
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

        {activeTab === "integrations" && <IntegrationsTab />}

        {activeTab === "permissions" && <PermissionManager />}

        {activeTab === "admin_users" && <AdminUsersManager />}

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

      {/* Company Dialog — Wizard */}
      <Dialog open={companyDialog} onOpenChange={setCompanyDialog}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingCompany ? "Editar Empresa" : "Nova Empresa"}
              {wizardStep >= 2 && companyForm.erp_type && (
                <span className="text-muted-foreground font-normal text-sm ml-2">
                  — {ERP_TYPE_LABELS[companyForm.erp_type]?.label || companyForm.erp_type}
                </span>
              )}
            </DialogTitle>
            <DialogDescription>
              {wizardStep === 1 && "Etapa 1 de 3 — Selecione o tipo de ERP"}
              {wizardStep === 2 && "Etapa 2 de 3 — Dados da empresa"}
              {wizardStep === 3 && "Etapa 3 de 3 — Configuração do ERP"}
            </DialogDescription>
          </DialogHeader>

          {/* Step indicator */}
          <div className="flex items-center gap-2 px-1">
            {[1, 2, 3].map((s) => (
              <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${s <= wizardStep ? "bg-primary" : "bg-muted"}`} />
            ))}
          </div>

          {wizardStep === 1 && (
            /* ── Step 1: ERP Selection ── */
            <div className="grid grid-cols-2 gap-3 py-4">
              {enabledNames.map((erpKey) => {
                const erp = ERP_TYPE_LABELS[erpKey];
                if (!erp) return null;
                const ErpIcon = erp.icon;
                const isSelected = companyForm.erp_type === erpKey;
                return (
                  <button
                    key={erpKey}
                    onClick={() => {
                      setCompanyForm((f) => ({ ...f, erp_type: erpKey }));
                      setWizardStep(2);
                    }}
                    className={`flex items-center gap-3 p-4 rounded-lg border-2 transition-all text-left hover:border-primary/60 ${
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:bg-muted/30"
                    }`}
                  >
                    <div className={`p-2 rounded-lg ${isSelected ? "bg-primary/10" : "bg-muted"}`}>
                      <ErpIcon className={`w-5 h-5 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                    </div>
                    <span className="text-sm font-medium text-foreground">{erp.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {wizardStep === 2 && (
            /* ── Step 2: Company Form ── */
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Nome</label>
                <Input
                  value={companyForm.display_name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setCompanyForm((f) => ({
                      ...f,
                      display_name: name,
                      // Auto-generate company_db only for new companies
                      ...(!editingCompany ? { company_db: name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") } : {}),
                    }));
                  }}
                  placeholder="Nome da empresa"
                  autoFocus
                />
              </div>

              <div className="flex items-center gap-6">
                <div className="flex items-center gap-3">
                  <Switch
                    checked={companyForm.is_active}
                    onCheckedChange={(v) => setCompanyForm((f) => ({ ...f, is_active: v }))}
                  />
                  <span className="text-sm text-foreground">Empresa ativa</span>
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={companyForm.is_foreign}
                    onCheckedChange={(v) => setCompanyForm((f) => ({ ...f, is_foreign: v }))}
                  />
                  <span className="text-sm text-foreground">Empresa estrangeira</span>
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={companyForm.is_test}
                    onCheckedChange={(v) => setCompanyForm((f) => ({ ...f, is_test: v }))}
                  />
                  <span className="text-sm text-foreground">Empresa de teste</span>
                </div>
              </div>

              {/* Identificação fiscal */}
              {companyForm.is_foreign ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Nome no exterior</label>
                  <Input
                    value={companyForm.foreign_name}
                    onChange={(e) => setCompanyForm((f) => ({ ...f, foreign_name: e.target.value }))}
                    placeholder="Foreign legal name"
                  />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Razão Social</label>
                    <Input
                      value={companyForm.legal_name}
                      onChange={(e) => setCompanyForm((f) => ({ ...f, legal_name: e.target.value }))}
                      placeholder="Razão social"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Nome Fantasia</label>
                    <Input
                      value={companyForm.trade_name}
                      onChange={(e) => setCompanyForm((f) => ({ ...f, trade_name: e.target.value }))}
                      placeholder="Nome fantasia"
                    />
                  </div>
                  <div className="space-y-2 col-span-2">
                    <label className="text-sm font-medium text-foreground">CNPJ</label>
                    <Input
                      value={companyForm.tax_id}
                      onChange={(e) => setCompanyForm((f) => ({ ...f, tax_id: e.target.value }))}
                      placeholder="00.000.000/0000-00"
                    />
                  </div>
                </div>
              )}

              {/* Currency & Timezone */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-primary" />
                    Moeda padrão
                  </label>
                  <Select value={companyForm.default_currency} onValueChange={(v) => setCompanyForm((f) => ({ ...f, default_currency: v }))}>
                    <SelectTrigger className="bg-card">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[
                        { value: "BRL", label: "R$ — Real Brasileiro" },
                        { value: "USD", label: "US$ — Dólar Americano" },
                        { value: "EUR", label: "€ — Euro" },
                        { value: "GBP", label: "£ — Libra Esterlina" },
                        { value: "ARS", label: "ARS — Peso Argentino" },
                        { value: "CLP", label: "CLP — Peso Chileno" },
                        { value: "MXN", label: "MXN — Peso Mexicano" },
                        { value: "COP", label: "COP — Peso Colombiano" },
                      ].map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground flex items-center gap-2">
                    <Globe className="w-4 h-4 text-primary" />
                    Fuso horário
                  </label>
                  <Select value={companyForm.timezone} onValueChange={(v) => setCompanyForm((f) => ({ ...f, timezone: v }))}>
                    <SelectTrigger className="bg-card">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[
                        { value: "America/Sao_Paulo", label: "São Paulo (GMT-3)" },
                        { value: "America/Manaus", label: "Manaus (GMT-4)" },
                        { value: "America/Belem", label: "Belém (GMT-3)" },
                        { value: "America/Cuiaba", label: "Cuiabá (GMT-4)" },
                        { value: "America/Rio_Branco", label: "Rio Branco (GMT-5)" },
                        { value: "America/Noronha", label: "Noronha (GMT-2)" },
                        { value: "America/New_York", label: "New York (GMT-5)" },
                        { value: "America/Chicago", label: "Chicago (GMT-6)" },
                        { value: "America/Los_Angeles", label: "Los Angeles (GMT-8)" },
                        { value: "America/Argentina/Buenos_Aires", label: "Buenos Aires (GMT-3)" },
                        { value: "America/Santiago", label: "Santiago (GMT-4)" },
                        { value: "America/Mexico_City", label: "Cidade do México (GMT-6)" },
                        { value: "Europe/London", label: "Londres (GMT+0)" },
                        { value: "Europe/Berlin", label: "Berlim (GMT+1)" },
                        { value: "Europe/Lisbon", label: "Lisboa (GMT+0)" },
                        { value: "Asia/Tokyo", label: "Tóquio (GMT+9)" },
                      ].map((tz) => (
                        <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Logo */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-primary" />
                  Logo da empresa
                </label>
                <Input
                  value={companyForm.logo_url}
                  onChange={(e) => setCompanyForm((f) => ({ ...f, logo_url: e.target.value }))}
                  placeholder="https://exemplo.com/logo.png"
                  className="text-sm"
                />
                <p className="text-xs text-muted-foreground">URL do logo para dashboards e relatórios</p>
              </div>

              <div className="space-y-3 pt-2 border-t border-border">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Target className="w-4 h-4 text-primary" />
                  Metas do Fluxo de Compras (dias)
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { key: "requisicao", label: "Requisição" },
                    { key: "cotacao", label: "Cotação" },
                    { key: "aprovacao", label: "Aprovação" },
                    { key: "pedido_compra", label: "Pedido Compra" },
                    { key: "nf_entrada", label: "NF Entrada" },
                    { key: "pagamento", label: "Pagamento" },
                    { key: "aprovador", label: "Aprovador" },
                  ] as { key: keyof CompanyTargets; label: string }[]).map(({ key, label }) => (
                    <div key={key} className="space-y-1">
                      <label className="text-xs text-muted-foreground">{label}</label>
                      <Input
                        type="number"
                        min={1}
                        value={companyForm.targets[key]}
                        onChange={(e) =>
                          setCompanyForm((f) => ({
                            ...f,
                            targets: { ...f.targets, [key]: Number(e.target.value) || 1 },
                          }))
                        }
                        className="h-8 text-sm"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {wizardStep === 3 && (
            /* ── Step 3: ERP Credentials ── */
            <div className="space-y-4 py-2">
              {(() => {
                const system = SYSTEMS.find((s) => s.name === companyForm.erp_type);
                if (!system) return <p className="text-sm text-muted-foreground">Nenhuma configuração disponível para este ERP.</p>;
                const SysIcon = system.icon;
                return (
                  <>
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <SysIcon className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{system.label}</p>
                        <p className="text-xs text-muted-foreground">{system.description}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {system.fields.map((field) => {
                        const isPassword = field.type === "password";
                        const isCustom = field.type === "custom_fields";
                        const isToggle = field.type === "toggle";
                        const showPw = showWizardPasswords[field.key];

                        if (isCustom) {
                          return (
                            <CustomFieldsEditor
                              key={field.key}
                              value={wizardCreds[field.key] || ""}
                              onChange={(v) => setWizardCreds((prev) => ({ ...prev, [field.key]: v }))}
                            />
                          );
                        }

                        if (isToggle) {
                          return (
                            <div
                              key={field.key}
                              className="md:col-span-2 flex items-start justify-between gap-4 rounded-lg border border-border bg-card p-4"
                            >
                              <div className="space-y-1">
                                <Label className="text-sm font-medium text-foreground">{field.label}</Label>
                                {field.description && (
                                  <p className="text-xs text-muted-foreground">{field.description}</p>
                                )}
                              </div>
                              <Switch
                                checked={wizardCreds[field.key] === "true"}
                                onCheckedChange={(checked) =>
                                  setWizardCreds((prev) => ({ ...prev, [field.key]: checked ? "true" : "false" }))
                                }
                              />
                            </div>
                          );
                        }

                        return (
                          <div key={field.key} className="space-y-1.5">
                            <Label className="text-sm text-muted-foreground">{field.label}</Label>
                            <div className="relative">
                              <Input
                                type={isPassword && !showPw ? "password" : "text"}
                                placeholder={field.placeholder}
                                value={wizardCreds[field.key] || ""}
                                onChange={(e) => setWizardCreds((prev) => ({ ...prev, [field.key]: e.target.value }))}
                                className="bg-card pr-10"
                              />
                              {isPassword && (
                                <button
                                  type="button"
                                  onClick={() => setShowWizardPasswords((prev) => ({ ...prev, [field.key]: !prev[field.key] }))}
                                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Você pode preencher as credenciais agora ou configurar depois na aba de credenciais da empresa.
                    </p>
                  </>
                );
              })()}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            {wizardStep > 1 && (
              <Button variant="outline" onClick={() => setWizardStep((s) => (s - 1) as 1 | 2 | 3)} className="mr-auto">
                <ArrowLeft className="w-4 h-4 mr-1" />
                Voltar
              </Button>
            )}
            <Button variant="outline" onClick={() => setCompanyDialog(false)}>Cancelar</Button>
            {wizardStep === 2 && (
              <Button onClick={() => {
                if (!companyForm.display_name) {
                  toast.error("Preencha o nome da empresa");
                  return;
                }
                setWizardStep(3);
              }}>
                Próximo
              </Button>
            )}
            {wizardStep === 3 && (
              <Button onClick={saveCompany} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
                Salvar
              </Button>
            )}
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

      <ConfirmDialog
        open={!!companyToDelete}
        onOpenChange={(o) => !o && setCompanyToDelete(null)}
        title={`Excluir empresa "${companyToDelete?.display_name ?? ""}"?`}
        description="Esta ação remove a empresa e suas credenciais associadas. Não pode ser desfeita."
        confirmLabel="Excluir"
        destructive
        onConfirm={confirmDeleteCompany}
      />
    </div>
  );
}
