import { useState, useMemo, useEffect, useCallback } from "react";
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
  UserCog,
} from "lucide-react";
import SubstituteApproversTab from "@/components/SubstituteApproversTab";
import { useAuth } from "@/hooks/useAuth";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNavigate } from "react-router-dom";
import { useSap } from "@/contexts/SapContext";
import { toast } from "sonner";
import {
  useApprovalRules,
  OPERATOR_LABELS,
  FIELD_OPTIONS,
  ENTITY_OPTIONS,
  FIELD_TO_ENTITY,
  DOC_TYPE_LABELS,
  type ApprovalRule,
  type ApprovalRuleLevel,
  type RuleCriterion,
  type CriterionOperator,
  type RuleDocType,
  type CreateRuleInput,
} from "@/hooks/useApprovalRules";
import { useSapUsers } from "@/hooks/useSapUsers";
import { useSapCachedList } from "@/hooks/useSapCachedList";
import { supabase } from "@/integrations/supabase/client";
import type { SapUser } from "@/lib/cache-repository";

import { useCompanies } from "@/hooks/useCompanies";
import { PageTitle } from "@/components/PageTitle";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function fieldLabel(field: string): string {
  return FIELD_OPTIONS.find((f) => f.value === field)?.label || field;
}

function normalizeSearch(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function criterionSummary(c: RuleCriterion): string {
  const f = fieldLabel(c.field);
  const op = OPERATOR_LABELS[c.operator];
  const formatVal = (v: string) =>
    c.field === "doc_type" ? (DOC_TYPE_LABELS[v as RuleDocType] || v) : v;
  if (c.operator === "between") return `${f} ${op} ${formatVal(c.value)} e ${formatVal(c.value2 || "")}`;
  return `${f} ${op} ${formatVal(c.value)}`;
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
    const q = normalizeSearch(search);
    return users.filter((u) => {
      const haystack = [u.UserName, u.UserCode, u.eMail, (u as any).searchText]
        .map(normalizeSearch)
        .join(" ");
      return haystack.includes(q);
    });
  }, [users, search]);

  return (
    <div>
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
        <PopoverContent className="w-[320px] p-0" align="start">
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
          <div className="max-h-[240px] overflow-y-auto p-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-4 space-y-2">
                <p className="text-xs text-muted-foreground text-center">Nenhum usuário encontrado</p>
                {search.trim() && (
                  <button
                    onClick={() => {
                      onSelect(search.trim(), search.includes("@") ? search.trim() : "");
                      setOpen(false);
                      setSearch("");
                    }}
                    className="w-full text-left px-3 py-2 rounded-md text-xs bg-primary/10 text-primary hover:bg-primary/15"
                  >
                    Usar "<span className="font-medium">{search.trim()}</span>" mesmo assim
                  </button>
                )}
              </div>
            ) : (
              filtered.map((u) => (
                <button
                  key={`${u.InternalKey}-${u.UserCode}-${u.eMail || ""}`}
                  onClick={() => {
                    onSelect(u.UserName, u.eMail || "");
                    setOpen(false);
                    setSearch("");
                  }}
                  className={`w-full text-left px-3 py-2 rounded-md text-xs hover:bg-muted/50 transition-colors flex items-center justify-between ${
                    value === u.UserName ? "bg-primary/10 text-primary" : "text-foreground"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{u.UserName}</p>
                    {u.eMail && <p className="text-[10px] text-muted-foreground truncate">{u.eMail}</p>}
                  </div>
                  {u.UserCode && (
                    <span className="text-[10px] text-muted-foreground font-mono ml-2 shrink-0">{u.UserCode}</span>
                  )}
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* ─── Catalog Value Select (cost center / project / supplier / item) ─── */
function CatalogValueSelect({
  options,
  isLoading,
  value,
  onChange,
  placeholder,
  field,
  operator,
}: {
  options: { code: string; name?: string }[];
  isLoading: boolean;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  field: string;
  operator: CriterionOperator;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = normalizeSearch(search);
    if (!q) return options.slice(0, 200);
    return options
      .filter((o) => normalizeSearch(o.code).includes(q) || normalizeSearch(o.name).includes(q))
      .slice(0, 200);
  }, [options, search]);

  const formatSelectedValue = (code: string) => {
    const normalizedCode = code.trim();
    if (operator === "like" && field === "cost_center" && !/%|_/.test(normalizedCode)) {
      return `${normalizedCode}%`;
    }
    return normalizedCode;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full h-9 justify-start text-sm font-normal px-3">
          {isLoading ? (
            <Loader2 className="w-3 h-3 animate-spin mr-2" />
          ) : value ? (
            <span className="truncate">{value}</span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0" align="start">
        <div className="p-2 border-b border-border">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-xs pl-8"
              autoFocus
            />
          </div>
        </div>
        <div className="max-h-[240px] overflow-y-auto p-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-4 space-y-2">
              <p className="text-xs text-muted-foreground text-center">Nenhum resultado</p>
              {search.trim() && (
                <button
                  onClick={() => {
                    onChange(search.trim());
                    setOpen(false);
                    setSearch("");
                  }}
                  className="w-full text-left px-3 py-2 rounded-md text-xs bg-primary/10 text-primary hover:bg-primary/15"
                >
                  Usar "<span className="font-medium">{search.trim()}</span>" mesmo assim
                </button>
              )}
            </div>
          ) : (
            filtered.map((o) => (
              <button
                key={o.code}
                onClick={() => {
                  onChange(formatSelectedValue(o.code));
                  setOpen(false);
                  setSearch("");
                }}
                className={`w-full text-left px-3 py-2 rounded-md text-xs hover:bg-muted/50 transition-colors flex items-center justify-between ${
                  value === o.code ? "bg-primary/10 text-primary" : "text-foreground"
                }`}
              >
                <span className="font-mono">{o.code}</span>
                {o.name && <span className="text-[10px] text-muted-foreground truncate ml-2">{o.name}</span>}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ─── Criterion Row ─── */
/** Campos que suportam busca em catálogo (SAP cached lists) para o valor. */
const CATALOG_FIELDS = new Set([
  "cost_center",
  "project",
  "supplier_name",
  "supplier.name",
  "supplier.code",
  "item_codes",
  "item.any",
  "item.code",
  "item.name",
  "item_groups",
]);
const TEXT_OPERATORS: CriterionOperator[] = ["equal", "not_equal", "contains", "not_contains", "like"];
const NUMERIC_OPERATORS: CriterionOperator[] = ["greater_than", "less_than", "between", "equal", "not_equal"];
const DOC_TYPE_OPERATORS: CriterionOperator[] = ["equal", "not_equal"];

function defaultOperatorForField(field: string): CriterionOperator {
  if (field === "total_amount") return "greater_than";
  if (field === "cost_center" || field === "item_codes" || field === "item.any" || field === "item.code") return "like";
  if (field === "supplier_name" || field === "supplier.name" || field === "item.name") return "contains";
  if (field === "requester_name") return "equal";
  if (field === "doc_type") return "equal";
  if (field === "supplier.status") return "equal";
  return "equal";
}

function operatorAllowedForField(field: string, operator: CriterionOperator): boolean {
  if (field === "total_amount") return NUMERIC_OPERATORS.includes(operator);
  if (field === "doc_type") return DOC_TYPE_OPERATORS.includes(operator);
  return TEXT_OPERATORS.includes(operator);
}

function entityAndAttrFromField(field: string): { entity: string; attribute?: string } {
  if (FIELD_TO_ENTITY[field]) return FIELD_TO_ENTITY[field];
  // fallback: parse "entity.attribute"
  if (field.includes(".")) {
    const [entity, attribute] = field.split(".", 2);
    return { entity, attribute };
  }
  return { entity: field };
}

function fieldFromEntityAttr(entity: string, attribute?: string): string {
  const ent = ENTITY_OPTIONS.find((e) => e.value === entity);
  if (!ent) return entity;
  if (!ent.attributes || ent.attributes.length === 0) {
    return ent.fieldWhenNoAttribute || ent.value;
  }
  const attr = attribute || ent.attributes[0].value;
  return `${entity}.${attr}`;
}

function CriterionRow({
  criterion,
  index,
  onChange,
  onRemove,
  catalogs,
  users,
  usersLoading,
  showLogicConnector,
}: {
  criterion: RuleCriterion;
  index: number;
  onChange: (index: number, updated: RuleCriterion) => void;
  onRemove: (index: number) => void;
  catalogs: {
    cost_center: { options: { code: string; name?: string }[]; isLoading: boolean };
    project: { options: { code: string; name?: string }[]; isLoading: boolean };
    supplier_name: { options: { code: string; name?: string }[]; isLoading: boolean };
    item_codes: { options: { code: string; name?: string }[]; isLoading: boolean };
    item_groups: { options: { code: string; name?: string }[]; isLoading: boolean };
  };
  users: SapUser[];
  usersLoading: boolean;
  /** Se true, não é o primeiro critério do grupo — mostra o conector local (E/OU). */
  showLogicConnector?: boolean;
}) {
  const isNumericField = criterion.field === "total_amount";
  const isRequesterField = criterion.field === "requester_name";
  const isDocTypeField = criterion.field === "doc_type";
  const isBetween = criterion.operator === "between";
  const useCatalog = CATALOG_FIELDS.has(criterion.field) && !isBetween;
  const effectiveOperator = operatorAllowedForField(criterion.field, criterion.operator)
    ? criterion.operator
    : defaultOperatorForField(criterion.field);
  const operatorOptions = isNumericField
    ? NUMERIC_OPERATORS
    : isDocTypeField
      ? DOC_TYPE_OPERATORS
      : TEXT_OPERATORS;

  const catalog =
    useCatalog && (criterion.field as any) in catalogs
      ? (catalogs as any)[criterion.field] as { options: { code: string; name?: string }[]; isLoading: boolean }
      : null;

  useEffect(() => {
    if (criterion.operator !== effectiveOperator) {
      onChange(index, { ...criterion, operator: effectiveOperator });
    }
  }, [criterion, effectiveOperator, index, onChange]);

  const handleFieldChange = (field: string) => {
    const nextOperator = operatorAllowedForField(field, criterion.operator)
      ? criterion.operator
      : defaultOperatorForField(field);
    onChange(index, { ...criterion, field, operator: nextOperator, value: "", value2: undefined });
  };

  return (
    <div className="space-y-1">
      {showLogicConnector && (
        <div className="flex items-center gap-2 pl-1">
          <div className="h-3 w-px bg-border" />
          <Select
            value={(criterion.logic === "or" ? "or" : "and")}
            onValueChange={(v) => onChange(index, { ...criterion, logic: v as "and" | "or" })}
          >
            <SelectTrigger className="h-6 w-[70px] text-[10px] font-semibold uppercase tracking-wider px-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="and" className="text-xs">E</SelectItem>
              <SelectItem value="or" className="text-xs">OU</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-[10px] text-muted-foreground">com o critério anterior</span>
        </div>
      )}
      <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/20 border border-border">
        <div className="flex-1 grid grid-cols-12 gap-2">
        {/* Field = Entity + optional Attribute */}
        <div className="col-span-4">
          {index === 0 && <label className="text-[10px] text-muted-foreground mb-1 block">Campo</label>}
          {(() => {
            const parsed = entityAndAttrFromField(criterion.field);
            const entity = ENTITY_OPTIONS.find((e) => e.value === parsed.entity);
            const hasAttrs = !!entity?.attributes?.length;
            return (
              <div className={hasAttrs ? "grid grid-cols-2 gap-1.5" : ""}>
                <Select
                  value={parsed.entity}
                  onValueChange={(v) => handleFieldChange(fieldFromEntityAttr(v))}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENTITY_OPTIONS.map((e) => (
                      <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {hasAttrs && (
                  <Select
                    value={parsed.attribute || entity!.attributes![0].value}
                    onValueChange={(v) => handleFieldChange(fieldFromEntityAttr(parsed.entity, v))}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {entity!.attributes!.map((a) => (
                        <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            );
          })()}
        </div>

        {/* Operator */}
        <div className="col-span-3">
          {index === 0 && <label className="text-[10px] text-muted-foreground mb-1 block">Operador</label>}
          <Select
            value={effectiveOperator}
            onValueChange={(v) => onChange(index, { ...criterion, operator: v as CriterionOperator })}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {operatorOptions.map((key) => (
                <SelectItem key={key} value={key}>{OPERATOR_LABELS[key]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Value */}
        <div className={isBetween ? "col-span-3" : "col-span-5"}>
          {index === 0 && <label className="text-[10px] text-muted-foreground mb-1 block">Valor</label>}
          {isRequesterField ? (
            <UserSelect
              users={users}
              isLoading={usersLoading}
              value={criterion.value}
              onSelect={(userName) => onChange(index, { ...criterion, value: userName })}
            />
          ) : isDocTypeField ? (
            <Select
              value={criterion.value || ""}
              onValueChange={(v) => onChange(index, { ...criterion, value: v })}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Selecionar tipo..." />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(DOC_TYPE_LABELS) as RuleDocType[]).map((key) => (
                  <SelectItem key={key} value={key}>{DOC_TYPE_LABELS[key]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : catalog ? (
            <CatalogValueSelect
              options={catalog.options}
              isLoading={catalog.isLoading}
              value={criterion.value}
              onChange={(v) => onChange(index, { ...criterion, value: v })}
              placeholder={criterion.field === "item_codes" ? "Buscar por código ou descrição..." : "Buscar..."}
              field={criterion.field}
              operator={effectiveOperator}
            />
          ) : (
            <Input
              type={isNumericField ? "number" : "text"}
              value={criterion.value}
              onChange={(e) => onChange(index, { ...criterion, value: e.target.value })}
              placeholder={criterion.operator === "like" ? "Ex: 1.6.% ou %gaming%" : "Valor"}
              className="text-sm h-9"
            />
          )}
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
  const { session } = useSap();
  const [isSaving, setIsSaving] = useState(false);
  const [name, setName] = useState("");
  const [priority, setPriority] = useState(0);
  const [docType, setDocType] = useState<RuleDocType>("both");
  const [criteria, setCriteria] = useState<RuleCriterion[]>([]);
  const [levels, setLevels] = useState<Omit<ApprovalRuleLevel, "id">[]>([]);

  // ── Catálogos SAP (busca no campo Valor) ───────────────────────────────
  const ccMapRow = useCallback((row: any) => ({ code: row.CenterCode, name: row.CenterName }), []);
  const { options: rawCcOptions, isLoading: ccLoading } = useSapCachedList({
    cacheKey: "cost_centers",
    endpoint: "ProfitCenters",
    params: { $filter: "Active eq 'tYES'", $select: "CenterCode,CenterName" },
    mapRow: ccMapRow,
    enabled: open,
  });
  const ccOptions = useMemo(
    () => rawCcOptions
      .filter((o) => !(o.name || "").toLowerCase().startsWith("centro geral"))
      .map((o) => ({ code: o.code, name: o.name })),
    [rawCcOptions],
  );

  const projMapRow = useCallback((row: any) => ({ code: row.Code, name: row.Name }), []);
  const { options: projOptions, isLoading: projLoading } = useSapCachedList({
    cacheKey: "projects",
    endpoint: "Projects",
    params: { $filter: "Active eq 'tYES'", $select: "Code,Name" },
    mapRow: projMapRow,
    enabled: open,
  });

  const supMapRow = useCallback((row: any) => ({ code: row.CardCode, name: row.CardName }), []);
  const { options: supOptions, isLoading: supLoading } = useSapCachedList({
    cacheKey: "suppliers_active_v3",
    endpoint: "BusinessPartners",
    params: { $select: "CardCode,CardName", $filter: "CardType eq 'cSupplier' and Frozen ne 'tYES'" },
    mapRow: supMapRow,
    enabled: open,
  });

  const itemMapRow = useCallback((row: any) => ({ code: row.ItemCode, name: row.ItemName }), []);
  const { options: itemOptions, isLoading: itemLoading } = useSapCachedList({
    cacheKey: "items_purchase_active_v4",
    endpoint: "Items",
    params: { $filter: "Valid eq 'tYES' and Frozen ne 'tYES'", $select: "ItemCode,ItemName" },
    mapRow: itemMapRow,
    enabled: open,
  });

  const groupMapRow = useCallback((row: any) => ({ code: String(row.Number ?? ""), name: row.GroupName }), []);
  const { options: groupOptions, isLoading: groupLoading } = useSapCachedList({
    cacheKey: "item_groups_v1",
    endpoint: "ItemGroups",
    params: { $select: "Number,GroupName" },
    mapRow: groupMapRow,
    enabled: open,
  });

  const catalogs = useMemo(() => {
    const sup = { options: supOptions.map((o) => ({ code: o.code, name: o.name })), isLoading: supLoading };
    const item = { options: itemOptions.map((o) => ({ code: o.code, name: o.name })), isLoading: itemLoading };
    return {
      cost_center: { options: ccOptions.map((o) => ({ code: o.code, name: o.name })), isLoading: ccLoading },
      project: { options: projOptions.map((o) => ({ code: o.code, name: o.name })), isLoading: projLoading },
      // Fornecedor: mesma lista para nome e código (o Select mostra ambos).
      supplier_name: sup,
      "supplier.name": sup,
      "supplier.code": sup,
      // Item: mesma lista para código, descrição e "qualquer".
      item_codes: item,
      "item.any": item,
      "item.code": item,
      "item.name": item,
      item_groups: { options: groupOptions.map((o) => ({ code: o.code, name: o.name })), isLoading: groupLoading },
    };
  }, [ccOptions, ccLoading, projOptions, projLoading, supOptions, supLoading, itemOptions, itemLoading, groupOptions, groupLoading]);

  // ── Fallback de aprovadores: mescla SAP Users + user_profiles ─────────
  const [profileUsers, setProfileUsers] = useState<SapUser[]>([]);
  const [idpUsers, setIdpUsers] = useState<SapUser[]>([]);
  const [profileLoading, setProfileLoading] = useState(false);
  useEffect(() => {
    if (!open || !session?.companyDB) return;
    let cancelled = false;
    setProfileLoading(true);
    (async () => {
      try {
        const { data } = await supabase
          .from("user_profiles")
          .select("user_code, display_name, email")
          .eq("company_db", session.companyDB || "")
          .order("display_name", { ascending: true });
        if (cancelled) return;
        const rows: SapUser[] = (data || []).map((p: any, i: number) => ({
          InternalKey: -(i + 1), // pseudo key negativo para não colidir com SAP
          UserCode: p.user_code || "",
          UserName: p.display_name || p.user_code || p.email || "",
          eMail: p.email || undefined,
          Locked: "tNO" as const,
          LastLoginDate: undefined,
          LastLoginTime: undefined,
        }));
        const { data: idpData } = await supabase
          .from("idp_user_mapping")
          .select("sap_user_code, sap_user_name, sap_email, idp_email, idp_display_name, status")
          .order("sap_user_name", { ascending: true });
        const idpRows: SapUser[] = (idpData || []).map((p: any, i: number) => ({
          InternalKey: -(10_000 + i + 1),
          UserCode: p.sap_user_code || "",
          UserName: p.sap_user_name || p.idp_display_name || p.sap_user_code || p.sap_email || p.idp_email || "",
          eMail: p.sap_email || p.idp_email || undefined,
          Locked: p.status === "disabled" ? "tYES" as const : "tNO" as const,
          LastLoginDate: undefined,
          LastLoginTime: undefined,
          searchText: [p.sap_user_code, p.sap_user_name, p.sap_email, p.idp_email, p.idp_display_name]
            .filter(Boolean)
            .join(" "),
        } as SapUser & { searchText?: string }));
        setProfileUsers(rows);
        setIdpUsers(idpRows);
      } catch (e) {
        console.warn("Falha ao carregar user_profiles para fallback:", e);
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, session?.companyDB]);

  const mergedUsers: SapUser[] = useMemo(() => {
    const byKey = new Map<string, SapUser>();
    const add = (u: SapUser) => {
      const key = (u.eMail || "").trim().toLowerCase()
        || (u.UserCode || "").trim().toLowerCase()
        || (u.UserName || "").trim().toLowerCase();
      if (!key) return;
      if (!byKey.has(key)) {
        byKey.set(key, u);
        return;
      }
      const existing = byKey.get(key)! as SapUser & { searchText?: string };
      existing.searchText = [
        existing.searchText,
        (u as any).searchText,
        u.UserName,
        u.UserCode,
        u.eMail,
      ].filter(Boolean).join(" ");
      if (!existing.eMail && u.eMail) existing.eMail = u.eMail;
      if (!existing.UserName && u.UserName) existing.UserName = u.UserName;
    };
    sapUsers.forEach(add);
    profileUsers.forEach(add);
    idpUsers.forEach(add);
    return Array.from(byKey.values()).sort((a, b) => a.UserName.localeCompare(b.UserName));
  }, [sapUsers, profileUsers, idpUsers]);
  const usersLoading = sapUsersLoading || profileLoading;

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

  // Grupo do último critério (para "adicionar critério" ir para o grupo mais recente).
  const lastGroupId = () => {
    if (criteria.length === 0) return 0;
    return Math.max(...criteria.map((c) => (typeof c.group === "number" ? c.group : 0)));
  };

  const addCriterion = (group?: number) => {
    const g = typeof group === "number" ? group : lastGroupId();
    // Se este critério não for o primeiro do grupo, começa com "and".
    const hasSiblings = criteria.some((c) => (c.group ?? 0) === g);
    setCriteria((prev) => [
      ...prev,
      {
        field: "total_amount",
        operator: "greater_than" as CriterionOperator,
        value: "",
        group: g,
        logic: hasSiblings ? "and" : undefined,
      },
    ]);
  };

  const addGroup = () => {
    const nextGroup = criteria.length === 0 ? 0 : lastGroupId() + 1;
    setCriteria((prev) => [
      ...prev,
      {
        field: "total_amount",
        operator: "greater_than" as CriterionOperator,
        value: "",
        group: nextGroup,
        groupLogic: nextGroup === 0 ? undefined : "or",
      },
    ]);
  };

  const updateCriterion = (index: number, updated: RuleCriterion) => {
    setCriteria((prev) => prev.map((c, i) => (i === index ? updated : c)));
  };

  const removeCriterion = (index: number) => {
    setCriteria((prev) => {
      const removed = prev[index];
      const next = prev.filter((_, i) => i !== index);
      // Se removemos o primeiro critério de um grupo (que carrega o groupLogic),
      // e ainda restam critérios no mesmo grupo, transfere o groupLogic para o
      // novo primeiro do grupo.
      if (removed && typeof removed.group === "number" && removed.groupLogic) {
        const firstIdx = next.findIndex((c) => (c.group ?? 0) === removed.group);
        if (firstIdx >= 0 && !next[firstIdx].groupLogic) {
          next[firstIdx] = { ...next[firstIdx], groupLogic: removed.groupLogic };
        }
      }
      return next;
    });
  };

  const setGroupLogic = (group: number, logic: "and" | "or") => {
    setCriteria((prev) => {
      const firstIdx = prev.findIndex((c) => (c.group ?? 0) === group);
      if (firstIdx < 0) return prev;
      return prev.map((c, i) => (i === firstIdx ? { ...c, groupLogic: logic } : c));
    });
  };

  const removeGroup = (group: number) => {
    setCriteria((prev) => prev.filter((c) => (c.group ?? 0) !== group));
  };

  // Estrutura auxiliar: ordena grupos por ordem de primeira aparição e devolve
  // pares [groupId, itens com índice global].
  const criteriaGroups = useMemo(() => {
    const order: number[] = [];
    const map = new Map<number, Array<{ idx: number; criterion: RuleCriterion }>>();
    criteria.forEach((c, idx) => {
      const g = c.group ?? 0;
      if (!map.has(g)) { map.set(g, []); order.push(g); }
      map.get(g)!.push({ idx, criterion: c });
    });
    return order.map((g) => ({ group: g, items: map.get(g)! }));
  }, [criteria]);


  // ── Níveis (agora agrupados por level_order, permitindo paralelismo) ──
  const levelsGrouped = useMemo(() => {
    const map = new Map<number, Array<{ idx: number; approver_name: string; approver_email?: string }>>();
    levels.forEach((l, idx) => {
      const key = l.level_order;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ idx, approver_name: l.approver_name, approver_email: l.approver_email });
    });
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [levels]);

  const nextLevelOrder = () => {
    if (levels.length === 0) return 1;
    return Math.max(...levels.map((l) => l.level_order)) + 1;
  };

  const addLevel = () => {
    const lo = nextLevelOrder();
    setLevels((prev) => [
      ...prev,
      { level_order: lo, approver_name: "", approver_email: "" },
    ]);
  };

  const addParallelApprover = (levelOrder: number) => {
    setLevels((prev) => [
      ...prev,
      { level_order: levelOrder, approver_name: "", approver_email: "" },
    ]);
  };

  const removeApproverRow = (index: number) => {
    setLevels((prev) => {
      // Remove a linha e, se um nível ficar sem ninguém, renumera os posteriores.
      const removedLevel = prev[index]?.level_order;
      const next = prev.filter((_, i) => i !== index);
      if (removedLevel != null && !next.some((l) => l.level_order === removedLevel)) {
        // Renumera níveis > removido para fechar o gap
        const remaining = next
          .sort((a, b) => a.level_order - b.level_order)
          .map((l) => ({ ...l }));
        // Constrói mapping para renumerar
        const distinct = Array.from(new Set(remaining.map((l) => l.level_order))).sort((a, b) => a - b);
        const rank: Record<number, number> = {};
        distinct.forEach((lo, i) => { rank[lo] = i + 1; });
        return remaining.map((l) => ({ ...l, level_order: rank[l.level_order] }));
      }
      return next;
    });
  };

  const updateLevelRow = (index: number, field: "approver_name" | "approver_email", value: string) => {
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
                  <SelectItem value="advance">Adiantamento</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-3 sm:col-span-1">
              <label className="text-xs text-muted-foreground mb-1 block">Prioridade</label>
              <Input type="number" value={priority} onChange={(e) => setPriority(parseInt(e.target.value) || 0)} placeholder="0" />
              <p className="text-[10px] text-muted-foreground mt-1">Maior = mais prioritário</p>
            </div>
          </div>

          {/* Dynamic Criteria (com suporte a grupos) */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Filter className="w-3 h-3" /> Critérios
              </p>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => addGroup()} className="gap-1 text-xs h-7">
                  <Plus className="w-3 h-3" /> Grupo
                </Button>
              </div>
            </div>
            {criteria.length === 0 ? (
              <button
                onClick={() => addGroup()}
                className="w-full py-6 border-2 border-dashed border-border rounded-lg text-sm text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Adicionar primeiro grupo de critérios
              </button>
            ) : (
              <div className="space-y-3">
                {criteriaGroups.map(({ group, items }, gIdx) => {
                  const first = items[0]?.criterion;
                  const groupLogic = first?.groupLogic === "and" ? "and" : "or";
                  return (
                    <div key={`grp-${group}`}>
                      {gIdx > 0 && (
                        <div className="flex items-center gap-2 mb-2 pl-1">
                          <div className="h-px flex-1 bg-border" />
                          <Select
                            value={groupLogic}
                            onValueChange={(v) => setGroupLogic(group, v as "and" | "or")}
                          >
                            <SelectTrigger className="h-7 w-[80px] text-[10px] font-semibold uppercase tracking-wider px-2">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="and" className="text-xs">E</SelectItem>
                              <SelectItem value="or" className="text-xs">OU</SelectItem>
                            </SelectContent>
                          </Select>
                          <span className="text-[10px] text-muted-foreground">com o grupo anterior</span>
                          <div className="h-px flex-1 bg-border" />
                        </div>
                      )}
                      <div className="rounded-xl border border-primary/20 bg-primary/[0.03] p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded">
                            Grupo {gIdx + 1}
                          </span>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => addCriterion(group)}
                              className="gap-1 text-[11px] h-6 px-2"
                            >
                              <Plus className="w-3 h-3" /> Critério
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeGroup(group)}
                              className="h-6 w-6 text-muted-foreground hover:text-destructive"
                              title="Remover grupo"
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-2">
                          {items.map(({ idx, criterion }, i) => (
                            <CriterionRow
                              key={idx}
                              criterion={criterion}
                              index={idx}
                              onChange={updateCriterion}
                              onRemove={removeCriterion}
                              catalogs={catalogs}
                              users={mergedUsers}
                              usersLoading={usersLoading}
                              showLogicConnector={i > 0}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>


          {/* Dynamic Levels — grouped by level_order (parallel approvers) */}
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
              <div className="space-y-3">
                {levelsGrouped.map(([lo, rows]) => (
                  <div key={lo} className="rounded-lg border border-border bg-muted/10 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/15 text-primary text-xs font-bold shrink-0">
                          {lo}
                        </span>
                        <div>
                          <p className="text-xs font-medium text-foreground">Nível {lo}</p>
                          {rows.length > 1 && (
                            <p className="text-[10px] text-muted-foreground">
                              Aprovação em paralelo — {rows.length} aprovadores. O primeiro que decidir encerra o nível.
                            </p>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => addParallelApprover(lo)}
                        className="gap-1 text-[11px] h-7"
                      >
                        <Plus className="w-3 h-3" /> Aprovador paralelo
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {rows.map((row) => (
                        <div key={row.idx} className="flex items-start gap-2">
                          <div className="flex-1 grid grid-cols-2 gap-2">
                            <UserSelect
                              users={mergedUsers}
                              isLoading={usersLoading}
                              value={row.approver_name}
                              onSelect={(userName, email) => {
                                updateLevelRow(row.idx, "approver_name", userName);
                                updateLevelRow(row.idx, "approver_email", email);
                              }}
                              label={undefined}
                            />
                            <Input
                              value={row.approver_email || ""}
                              readOnly
                              className="text-sm h-9 bg-muted/30 text-muted-foreground"
                              placeholder="Preenchido automaticamente"
                            />
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeApproverRow(row.idx)}
                            className="h-9 w-9 text-muted-foreground hover:text-destructive shrink-0"
                            title="Remover aprovador"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
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
      : dt === "advance"
      ? { icon: Tag, cls: "bg-amber-500/15 text-amber-500" }
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

          {criteriaLabels.length > 0 && (() => {
            // Agrupa por `group` para renderização com conector entre grupos.
            const order: number[] = [];
            const buckets = new Map<number, Array<{ label: string; c: any; idx: number }>>();
            (rule.criteria || []).forEach((c: any, idx: number) => {
              const g = typeof c.group === "number" ? c.group : 0;
              if (!buckets.has(g)) { buckets.set(g, []); order.push(g); }
              buckets.get(g)!.push({ label: criteriaLabels[idx], c, idx });
            });
            return (
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                {order.map((g, gIdx) => {
                  const items = buckets.get(g)!;
                  const gLogic = (items[0]?.c?.groupLogic === "and") ? "E" : "OU";
                  return (
                    <span key={`g-${g}`} className="flex flex-wrap items-center gap-1.5">
                      {gIdx > 0 && (
                        <span className="text-[9px] font-bold uppercase tracking-wider text-primary bg-primary/15 px-1.5 py-0.5 rounded">
                          {gLogic}
                        </span>
                      )}
                      <span className="flex flex-wrap items-center gap-1.5 border border-primary/20 rounded-lg px-2 py-1 bg-primary/[0.03]">
                        {items.map(({ label, c }, i) => {
                          const logic = c.logic === "or" ? "OU" : "E";
                          return (
                            <span key={i} className="flex items-center gap-1.5">
                              {i > 0 && (
                                <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                                  {logic}
                                </span>
                              )}
                              <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                                {label}
                              </span>
                            </span>
                          );
                        })}
                      </span>
                    </span>
                  );
                })}
              </div>
            );
          })()}

          {(() => {
            const distinctCount = new Set(rule.levels.map((l) => l.level_order)).size;
            return (
              <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1 mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Users className="w-3 h-3" />
                {distinctCount} nível(is) de aprovação
                {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            );
          })()}

          {expanded && (() => {
            // Agrupa por level_order para renderizar aprovadores paralelos
            const grouped = new Map<number, typeof rule.levels>();
            for (const l of rule.levels) {
              if (!grouped.has(l.level_order)) grouped.set(l.level_order, [] as any);
              (grouped.get(l.level_order) as any).push(l);
            }
            const entries = Array.from(grouped.entries()).sort((a, b) => a[0] - b[0]);
            return (
              <div className="mt-3 space-y-2 pl-2 border-l-2 border-primary/20">
                {entries.map(([lo, rows]) => (
                  <div key={lo} className="text-sm">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">
                        {lo}
                      </span>
                      {rows.length > 1 && (
                        <span className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded-full font-medium">
                          Paralelo — 1º decide
                        </span>
                      )}
                    </div>
                    <div className="ml-7 space-y-0.5">
                      {rows.map((lvl) => (
                        <div key={lvl.id || `${lo}-${lvl.approver_name}`} className="flex items-center gap-2 text-sm">
                          <span className="text-foreground">{lvl.approver_name}</span>
                          {lvl.approver_email && (
                            <span className="text-xs text-muted-foreground">{lvl.approver_email}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}

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
  const [activeTab, setActiveTab] = useState<"standard" | "custom" | "substitutes">("standard");
  const { isAdmin } = useAuth();

  const CUSTOM_PRIORITY = 9999;
  const isCustomRule = (r: ApprovalRule) => (r.priority || 0) >= CUSTOM_PRIORITY;
  const standardRules = useMemo(() => rules.filter((r) => !isCustomRule(r)), [rules]);
  const customRules = useMemo(() => rules.filter(isCustomRule), [rules]);

  const filteredRules = useMemo(() => {
    const q = search.trim().toLowerCase();
    const source = activeTab === "custom" ? customRules : standardRules;
    return source.filter((r) => {
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
  }, [standardRules, customRules, activeTab, search, docTypeFilter, statusFilter]);

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

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
          <TabsList className="grid grid-cols-3 w-full sm:w-[720px]">
            <TabsTrigger value="standard" className="gap-1.5">
              <Settings2 className="w-3.5 h-3.5" />
              Regras padrão
              <span className="ml-1 text-[10px] font-mono bg-muted/60 px-1.5 py-0.5 rounded">
                {standardRules.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="custom" className="gap-1.5">
              <Shield className="w-3.5 h-3.5" />
              Regras personalizadas
              <span className="ml-1 text-[10px] font-mono bg-muted/60 px-1.5 py-0.5 rounded">
                {customRules.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="substitutes" className="gap-1.5">
              <UserCog className="w-3.5 h-3.5" />
              Substitutos
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {activeTab === "substitutes" ? (
          <SubstituteApproversTab isAdmin={isAdmin} />
        ) : null}

        {activeTab !== "substitutes" && activeTab === "custom" && (
          <div className="glass-card p-4 border-l-2 border-l-primary/40">
            <p className="text-sm text-foreground font-medium mb-1 flex items-center gap-1.5">
              <Shield className="w-4 h-4 text-primary" />
              Regras personalizadas (prioridade {CUSTOM_PRIORITY})
            </p>
            <p className="text-xs text-muted-foreground">
              Regras de sobreposição aplicadas por tipo de rateio ou item — Fiscal (IMP), Folha (FOL) e Reembolso.
              Quando aplicáveis, elas prevalecem sobre a matriz normal de centro de custo e valor.
            </p>
          </div>
        )}

        {activeTab !== "substitutes" && (<>
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
              <SelectItem value="advance">Adiantamento</SelectItem>
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
            {filteredRules.length} de {activeTab === "custom" ? customRules.length : standardRules.length}
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
        </>)}
      </main>

      <RuleFormModal
        open={showForm}
        onClose={closeForm}
        onSubmit={handleSubmit}
        sapUsers={sapUsers}
        sapUsersLoading={sapUsersLoading}
        editing={editingRule}
      />

      <RuleSimulator
        open={showSimulator}
        onClose={() => setShowSimulator(false)}
        rules={rules}
      />
    </div>
  );
}
