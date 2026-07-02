import { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Plus,
  RefreshCw,
  ArrowLeft,
  Activity,
  LogOut,
  Loader2,
  Trash2,
  ChevronDown,
  ChevronUp,
  Shield,
  Settings2,
  Users,
  Filter,
  Search,
  Pencil,
  ShoppingCart,
  Tag,
  PlayCircle,
} from "lucide-react";
import { RuleSimulator } from "@/components/RuleSimulator";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useNavigate } from "react-router-dom";
import { useSap } from "@/contexts/SapContext";
import { toast } from "sonner";
import {
  useApprovalRules,
  OPERATOR_LABELS,
  FIELD_OPTIONS,
  DOC_TYPE_LABELS,
  type ApprovalRule,
  type ApprovalRuleLevel,
  type RuleCriterion,
  type CriterionOperator,
  type RuleDocType,
  type CreateRuleInput,
} from "@/hooks/useApprovalRules";
import { useSapUsers } from "@/hooks/useSapUsers";
import type { SapUser } from "@/lib/cache-repository";

import { useCompanies } from "@/hooks/useCompanies";
import { PageTitle } from "@/components/PageTitle";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function fieldLabel(field: string): string {
  return FIELD_OPTIONS.find((f) => f.value === field)?.label || field;
}

function criterionSummary(c: RuleCriterion): string {
  const f = fieldLabel(c.field);
  const op = OPERATOR_LABELS[c.operator];
  if (c.operator === "between") return `${f} ${op} ${c.value} e ${c.value2}`;
  return `${f} ${op} ${c.value}`;
}

/* ─── User Select with search ─── */
function UserSelect({
  users,
  isLoading,
  value,
  onSelect,
  label,
}: {
  users: SapUser[];
  isLoading: boolean;
  value: string;
  onSelect: (userName: string, email: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return users;
    const q = search.toLowerCase();
    return users.filter(
      (u) =>
        u.UserName.toLowerCase().includes(q) ||
        u.UserCode.toLowerCase().includes(q) ||
        (u.eMail || "").toLowerCase().includes(q)
    );
  }, [users, search]);

  return (
    <div>
      <PageTitle title="Regras de Aprovação" />
      {label && <label className="text-[10px] text-muted-foreground mb-1 block">{label}</label>}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="w-full h-9 justify-start text-sm font-normal px-3"
          >
            {isLoading ? (
              <Loader2 className="w-3 h-3 animate-spin mr-2" />
            ) : value ? (
              <span className="truncate">{value}</span>
            ) : (
              <span className="text-muted-foreground">Selecionar aprovador...</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0" align="start">
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar usuário..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 text-xs pl-8"
                autoFocus
              />
            </div>
          </div>
          <div className="max-h-[200px] overflow-y-auto p-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">Nenhum usuário encontrado</p>
            ) : (
              filtered.map((u) => (
                <button
                  key={u.InternalKey}
                  onClick={() => {
                    onSelect(u.UserName, u.eMail || "");
                    setOpen(false);
                    setSearch("");
                  }}
                  className={`w-full text-left px-3 py-2 rounded-md text-xs hover:bg-muted/50 transition-colors flex items-center justify-between ${
                    value === u.UserName ? "bg-primary/10 text-primary" : "text-foreground"
                  }`}
                >
                  <div>
                    <p className="font-medium">{u.UserName}</p>
                    {u.eMail && <p className="text-[10px] text-muted-foreground">{u.eMail}</p>}
                  </div>
                  <span className="text-[10px] text-muted-foreground font-mono">{u.UserCode}</span>
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* ─── Criterion Row ─── */
function CriterionRow({
  criterion,
  index,
  onChange,
  onRemove,
}: {
  criterion: RuleCriterion;
  index: number;
  onChange: (index: number, updated: RuleCriterion) => void;
  onRemove: (index: number) => void;
}) {
  const isNumericField = criterion.field === "total_amount";
  const isBetween = criterion.operator === "between";

  return (
    <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/20 border border-border">
      <div className="flex-1 grid grid-cols-12 gap-2">
        {/* Field */}
        <div className="col-span-3">
          {index === 0 && <label className="text-[10px] text-muted-foreground mb-1 block">Campo</label>}
          <Select
            value={criterion.field}
            onValueChange={(v) => onChange(index, { ...criterion, field: v })}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FIELD_OPTIONS.map((f) => (
                <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Operator */}
        <div className="col-span-3">
          {index === 0 && <label className="text-[10px] text-muted-foreground mb-1 block">Operador</label>}
          <Select
            value={criterion.operator}
            onValueChange={(v) => onChange(index, { ...criterion, operator: v as CriterionOperator })}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(OPERATOR_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Value */}
        <div className={isBetween ? "col-span-3" : "col-span-5"}>
          {index === 0 && <label className="text-[10px] text-muted-foreground mb-1 block">Valor</label>}
          <Input
            type={isNumericField ? "number" : "text"}
            value={criterion.value}
            onChange={(e) => onChange(index, { ...criterion, value: e.target.value })}
            placeholder={criterion.operator === "like" ? "Ex: %gaming%" : "Valor"}
            className="text-sm h-9"
          />
        </div>

        {/* Value2 for between */}
        {isBetween && (
          <div className="col-span-2">
            {index === 0 && <label className="text-[10px] text-muted-foreground mb-1 block">Até</label>}
            <Input
              type={isNumericField ? "number" : "text"}
              value={criterion.value2 || ""}
              onChange={(e) => onChange(index, { ...criterion, value2: e.target.value })}
              placeholder="Até"
              className="text-sm h-9"
            />
          </div>
        )}
      </div>

      <div className={index === 0 ? "mt-4" : ""}>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onRemove(index)}
          className="h-9 w-9 text-muted-foreground hover:text-destructive shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

/* ─── Rule Form Modal (create + edit) ─── */
function RuleFormModal({
  open,
  onClose,
  onSubmit,
  sapUsers,
  sapUsersLoading,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: CreateRuleInput) => Promise<void>;
  sapUsers: SapUser[];
  sapUsersLoading: boolean;
  editing?: ApprovalRule | null;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [name, setName] = useState("");
  const [priority, setPriority] = useState(0);
  const [docType, setDocType] = useState<RuleDocType>("both");
  const [criteria, setCriteria] = useState<RuleCriterion[]>([]);
  const [levels, setLevels] = useState<Omit<ApprovalRuleLevel, "id">[]>([]);

  // Hydrate form when opening / switching between create and edit
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setPriority(editing.priority || 0);
      setDocType((editing.doc_type as RuleDocType) || "both");
      setCriteria(editing.criteria || []);
      setLevels(
        (editing.levels || []).map((l) => ({
          level_order: l.level_order,
          approver_name: l.approver_name,
          approver_email: l.approver_email || "",
        }))
      );
    } else {
      setName("");
      setPriority(0);
      setDocType("both");
      setCriteria([]);
      setLevels([]);
    }
  }, [open, editing]);

  const addCriterion = () => {
    setCriteria((prev) => [
      ...prev,
      { field: "total_amount", operator: "greater_than" as CriterionOperator, value: "" },
    ]);
  };

  const updateCriterion = (index: number, updated: RuleCriterion) => {
    setCriteria((prev) => prev.map((c, i) => (i === index ? updated : c)));
  };

  const removeCriterion = (index: number) => {
    setCriteria((prev) => prev.filter((_, i) => i !== index));
  };

  const addLevel = () => {
    setLevels((prev) => [
      ...prev,
      { level_order: prev.length + 1, approver_name: "", approver_email: "" },
    ]);
  };

  const removeLevel = (index: number) => {
    setLevels((prev) =>
      prev.filter((_, i) => i !== index).map((lvl, i) => ({ ...lvl, level_order: i + 1 }))
    );
  };

  const updateLevel = (index: number, field: string, value: string) => {
    setLevels((prev) => {
      const updated = [...prev];
      (updated[index] as any)[field] = value;
      return updated;
    });
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error("Informe o nome da regra");
      return;
    }
    if (criteria.some((c) => !c.value.trim())) {
      toast.error("Todos os critérios devem ter um valor");
      return;
    }
    if (levels.length === 0) {
      toast.error("Adicione ao menos um nível de aprovação");
      return;
    }
    if (levels.some((l) => !l.approver_name.trim())) {
      toast.error("Todos os níveis devem ter um aprovador");
      return;
    }
    setIsSaving(true);
    try {
      await onSubmit({ name, priority, doc_type: docType, criteria, levels });
      toast.success(editing ? "Regra atualizada com sucesso!" : "Regra criada com sucesso!");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar regra");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            {editing ? "Editar Regra de Aprovação" : "Nova Regra de Aprovação"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {/* Basic info */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-3 sm:col-span-1">
              <label className="text-xs text-muted-foreground mb-1 block">Nome da Regra *</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Aprovação acima de R$ 10.000" />
            </div>
            <div className="col-span-3 sm:col-span-1">
              <label className="text-xs text-muted-foreground mb-1 block">Tipo de Documento</label>
              <Select value={docType} onValueChange={(v) => setDocType(v as RuleDocType)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Ambos (Compra e Venda)</SelectItem>
                  <SelectItem value="purchase">Compra</SelectItem>
                  <SelectItem value="sales">Venda</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-3 sm:col-span-1">
              <label className="text-xs text-muted-foreground mb-1 block">Prioridade</label>
              <Input type="number" value={priority} onChange={(e) => setPriority(parseInt(e.target.value) || 0)} placeholder="0" />
              <p className="text-[10px] text-muted-foreground mt-1">Maior = mais prioritário</p>
            </div>
          </div>

          {/* Dynamic Criteria */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Filter className="w-3 h-3" /> Critérios
              </p>
              <Button variant="ghost" size="sm" onClick={addCriterion} className="gap-1 text-xs h-7">
                <Plus className="w-3 h-3" /> Critério
              </Button>
            </div>
            {criteria.length === 0 ? (
              <button
                onClick={addCriterion}
                className="w-full py-6 border-2 border-dashed border-border rounded-lg text-sm text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Adicionar primeiro critério
              </button>
            ) : (
              <div className="space-y-2">
                {criteria.map((c, i) => (
                  <CriterionRow
                    key={i}
                    criterion={c}
                    index={i}
                    onChange={updateCriterion}
                    onRemove={removeCriterion}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Dynamic Levels */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Users className="w-3 h-3" /> Níveis de Aprovação
              </p>
              <Button variant="ghost" size="sm" onClick={addLevel} className="gap-1 text-xs h-7">
                <Plus className="w-3 h-3" /> Nível
              </Button>
            </div>
            {levels.length === 0 ? (
              <button
                onClick={addLevel}
                className="w-full py-6 border-2 border-dashed border-border rounded-lg text-sm text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Adicionar primeiro nível de aprovação
              </button>
            ) : (
              <div className="space-y-2">
                {levels.map((lvl, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/15 text-primary text-sm font-bold shrink-0">
                      {lvl.level_order}
                    </div>
                    <div className="flex-1 grid grid-cols-2 gap-2">
                      <UserSelect
                        users={sapUsers}
                        isLoading={sapUsersLoading}
                        value={lvl.approver_name}
                        onSelect={(userName, email) => {
                          updateLevel(i, "approver_name", userName);
                          updateLevel(i, "approver_email", email);
                        }}
                        label={i === 0 ? "Aprovador *" : undefined}
                      />
                      <div>
                        {i === 0 && <label className="text-[10px] text-muted-foreground">Email</label>}
                        <Input
                          value={lvl.approver_email || ""}
                          readOnly
                          className="text-sm h-9 bg-muted/30 text-muted-foreground"
                          placeholder="Preenchido automaticamente"
                        />
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeLevel(i)}
                      className="h-9 w-9 text-muted-foreground hover:text-destructive shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-border pt-4 flex justify-end gap-3">
            <Button variant="outline" onClick={onClose} disabled={isSaving}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={isSaving} className="gap-1.5">
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : editing ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {editing ? "Salvar Alterações" : "Criar Regra"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Rule Card ─── */
function RuleCard({
  rule,
  onToggle,
  onDelete,
  onEdit,
}: {
  rule: ApprovalRule;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const criteriaLabels = (rule.criteria || []).map(criterionSummary);
  const dt: RuleDocType = (rule.doc_type as RuleDocType) || "both";
  const docTypeBadge =
    dt === "purchase"
      ? { icon: ShoppingCart, cls: "bg-blue-500/15 text-blue-500" }
      : dt === "sales"
      ? { icon: Tag, cls: "bg-emerald-500/15 text-emerald-500" }
      : { icon: Shield, cls: "bg-muted text-muted-foreground" };
  const DocIcon = docTypeBadge.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={`glass-card p-5 transition-all ${!rule.is_active ? "opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="text-foreground font-semibold truncate">{rule.name}</h3>
            <Badge className={rule.is_active ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}>
              {rule.is_active ? "Ativa" : "Inativa"}
            </Badge>
            <Badge className={`${docTypeBadge.cls} gap-1`}>
              <DocIcon className="w-3 h-3" />
              {DOC_TYPE_LABELS[dt]}
            </Badge>
            {rule.priority > 0 && (
              <span className="text-[10px] font-mono text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                P{rule.priority}
              </span>
            )}
          </div>

          {criteriaLabels.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {criteriaLabels.map((c, i) => (
                <span key={i} className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                  {c}
                </span>
              ))}
            </div>
          )}

          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Users className="w-3 h-3" />
            {rule.levels.length} nível(is) de aprovação
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          {expanded && (
            <div className="mt-3 space-y-1.5 pl-2 border-l-2 border-primary/20">
              {rule.levels.map((lvl) => (
                <div key={lvl.id || lvl.level_order} className="flex items-center gap-2 text-sm">
                  <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">
                    {lvl.level_order}
                  </span>
                  <span className="text-foreground font-medium">{lvl.approver_name}</span>
                  {lvl.approver_email && (
                    <span className="text-xs text-muted-foreground">{lvl.approver_email}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Switch checked={rule.is_active} onCheckedChange={onToggle} />
          <Button variant="ghost" size="icon" onClick={onEdit} className="h-8 w-8 text-muted-foreground hover:text-primary" title="Editar regra">
            <Pencil className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete} className="h-8 w-8 text-muted-foreground hover:text-destructive" title="Excluir regra">
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

/* ─── Main Page ─── */
export default function ApprovalRulesPage() {
  const { session, logout } = useSap();
  const navigate = useNavigate();
  const { rules, isLoading, error, refresh, createRule, updateRule, toggleRule, deleteRule } = useApprovalRules();
  const { users: sapUsers, isLoading: sapUsersLoading } = useSapUsers();
  const { getLabel } = useCompanies(true);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<ApprovalRule | null>(null);
  const [showSimulator, setShowSimulator] = useState(false);
  const [search, setSearch] = useState("");
  const [docTypeFilter, setDocTypeFilter] = useState<"all" | RuleDocType>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const filteredRules = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rules.filter((r) => {
      if (docTypeFilter !== "all" && (r.doc_type || "both") !== docTypeFilter) return false;
      if (statusFilter === "active" && !r.is_active) return false;
      if (statusFilter === "inactive" && r.is_active) return false;
      if (!q) return true;
      if (r.name?.toLowerCase().includes(q)) return true;
      if (
        r.criteria?.some(
          (c) =>
            fieldLabel(c.field).toLowerCase().includes(q) ||
            (c.value || "").toLowerCase().includes(q) ||
            (c.value2 || "").toLowerCase().includes(q),
        )
      )
        return true;
      if (
        r.levels?.some(
          (l) =>
            (l.approver_name || "").toLowerCase().includes(q) ||
            (l.approver_email || "").toLowerCase().includes(q),
        )
      )
        return true;
      return false;
    });
  }, [rules, search, docTypeFilter, statusFilter]);

  useEffect(() => {
    if (!session) navigate("/");
  }, [session, navigate]);

  if (!session) {
    return null;
  }


  const companyLabel = getLabel(session?.companyDB || "");

  const openCreate = () => {
    setEditingRule(null);
    setShowForm(true);
  };
  const openEdit = (rule: ApprovalRule) => {
    setEditingRule(rule);
    setShowForm(true);
  };
  const closeForm = () => {
    setShowForm(false);
    setEditingRule(null);
  };

  const handleSubmit = async (input: CreateRuleInput) => {
    if (editingRule) {
      await updateRule(editingRule.id, input, session.userName);
    } else {
      await createRule(input, session.userName);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir esta regra?")) return;
    try {
      await deleteRule(id);
      toast.success("Regra excluída");
    } catch (e) {
      toast.error("Erro ao excluir regra");
    }
  };

  const handleToggle = async (id: string, current: boolean) => {
    try {
      await toggleRule(id, !current);
      toast.success(!current ? "Regra ativada" : "Regra desativada");
    } catch (e) {
      toast.error("Erro ao atualizar regra");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 glow-primary">
              <Activity className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Regras de Aprovação</h1>
              <p className="text-xs text-muted-foreground">Configure aprovadores por nível, valor e tipo de documento</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-foreground">{companyLabel}</p>
              <p className="text-xs text-muted-foreground">{session?.userName}</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-success animate-pulse-glow" />
              Conectado
            </div>
            <Button variant="ghost" size="sm" onClick={refresh} disabled={isLoading}>
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={logout}>
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4 mr-1" /> Dashboard
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setShowSimulator(true)} className="gap-1.5">
              <PlayCircle className="w-4 h-4" /> Simular pedido
            </Button>
            <Button onClick={openCreate} className="gap-1.5">
              <Plus className="w-4 h-4" /> Nova Regra
            </Button>
          </div>
        </div>

        {/* Summary */}
        <div className="flex flex-wrap gap-4">
          <div className="glass-card px-4 py-3 flex items-center gap-3">
            <Settings2 className="w-4 h-4 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Total de Regras</p>
              <p className="text-lg font-bold font-mono text-foreground">{rules.length}</p>
            </div>
          </div>
          <div className="glass-card px-4 py-3 flex items-center gap-3">
            <Shield className="w-4 h-4 text-success" />
            <div>
              <p className="text-xs text-muted-foreground">Ativas</p>
              <p className="text-lg font-bold font-mono text-success">{rules.filter((r) => r.is_active).length}</p>
            </div>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="glass-card p-3 flex flex-col sm:flex-row gap-2 sm:items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, critério, aprovador ou e-mail..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-9 text-sm"
            />
          </div>
          <Select value={docTypeFilter} onValueChange={(v) => setDocTypeFilter(v as any)}>
            <SelectTrigger className="h-9 w-full sm:w-[180px] text-sm">
              <SelectValue placeholder="Tipo de documento" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tipos</SelectItem>
              <SelectItem value="both">Ambos</SelectItem>
              <SelectItem value="purchase">Compra</SelectItem>
              <SelectItem value="sales">Venda</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
            <SelectTrigger className="h-9 w-full sm:w-[160px] text-sm">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="active">Ativas</SelectItem>
              <SelectItem value="inactive">Inativas</SelectItem>
            </SelectContent>
          </Select>
          {(search || docTypeFilter !== "all" || statusFilter !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setDocTypeFilter("all");
                setStatusFilter("all");
              }}
              className="text-xs"
            >
              Limpar
            </Button>
          )}
          <div className="text-xs text-muted-foreground sm:ml-auto whitespace-nowrap">
            {filteredRules.length} de {rules.length}
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="text-center py-20">
            <p className="text-destructive mb-4">{error}</p>
            <Button variant="outline" onClick={refresh}>Tentar novamente</Button>
          </div>
        ) : rules.length === 0 ? (
          <div className="text-center py-20">
            <Shield className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground mb-2">Nenhuma regra de aprovação configurada</p>
            <p className="text-xs text-muted-foreground mb-4">Crie regras para definir a cadeia de aprovadores com base em critérios</p>
            <Button onClick={openCreate} className="gap-1.5">
              <Plus className="w-4 h-4" /> Criar primeira regra
            </Button>
          </div>
        ) : filteredRules.length === 0 ? (
          <div className="text-center py-20">
            <Search className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground mb-2">Nenhuma regra encontrada</p>
            <p className="text-xs text-muted-foreground">Ajuste os filtros ou o termo de busca</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredRules.map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                onToggle={() => handleToggle(rule.id, rule.is_active)}
                onDelete={() => handleDelete(rule.id)}
                onEdit={() => openEdit(rule)}
              />
            ))}
          </div>
        )}
      </main>

      <RuleFormModal
        open={showForm}
        onClose={closeForm}
        onSubmit={handleSubmit}
        sapUsers={sapUsers}
        sapUsersLoading={sapUsersLoading}
        editing={editingRule}
      />
    </div>
  );
}
