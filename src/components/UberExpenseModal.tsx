import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Car,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Save,
  Send,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CachedSearchCombobox } from "@/components/CachedSearchCombobox";
import type { SapSearchOption } from "@/components/SapSearchCombobox";
import { useMergedSupplierOptions } from "@/hooks/useMergedSupplierOptions";
import { useSapCachedList } from "@/hooks/useSapCachedList";
import type { CreateExpenseInput } from "@/hooks/useExpenses";
import { supabase } from "@/integrations/supabase/client";
import { sapFunctionFetch } from "@/lib/auth-fetch";

type WizardStep = "users" | "projects";

const UBER_DEFAULT_SUPPLIER_NAME = "UBER DO BRASIL TECNOLOGIA LTDA";
const UBER_DEFAULT_ITEM_NAME = "Transporte de passageiros Uber";
const UBER_DEFAULT_SUPPLIER: SapSearchOption = {
  code: "",
  name: UBER_DEFAULT_SUPPLIER_NAME,
};
const UBER_DEFAULT_ITEM: SapSearchOption = {
  code: "",
  name: UBER_DEFAULT_ITEM_NAME,
};

interface SapSessionLike {
  companyDB?: string | null;
  erpType?: string | null;
}

interface UberTrip {
  trip_id: string;
  source_label: string;
  employee_name: string;
  email: string;
  requested_at_local: string | null;
  group: string;
  program: string;
  service: string;
  city: string;
  origin_address: string;
  destination_address: string;
  expense_code: string;
  transaction_type: string;
  currency: string;
  amount: number;
}

interface UberSummaryEmployee {
  user_key: string;
  employee_name: string;
  email: string;
  amount: number;
  transaction_count: number;
  sources: string[];
}

interface UberSummaryRow {
  row_key?: string;
  user_key?: string;
  employee_name?: string;
  email?: string;
  cost_center_code: string;
  cost_center_label: string;
  amount: number;
  transaction_count: number;
  employee_count?: number;
  employees?: UberSummaryEmployee[];
  sources: string[];
}

interface UberException {
  reason: string;
  trip: UberTrip;
  matched_user: unknown | null;
}

interface UberUserRow {
  key: string;
  employee_name: string;
  email: string;
  amount: number;
  transaction_count: number;
  sources: string[];
  reasons: string[];
  cost_center_code: string;
  cost_center_label: string;
}

interface UberCostCenterRow {
  row_key: string;
  cost_center_code: string;
  cost_center_label: string;
  amount: number;
  transaction_count: number;
  employee_count: number;
  employees: string[];
  sources: string[];
}

interface UberTripsResponse {
  ok: true;
  generated_at: string;
  integration?: {
    display_name?: string | null;
    company_db?: string | null;
    is_active?: boolean | null;
  };
  summary: UberSummaryRow[];
  exceptions: UberException[];
  totals: {
    amount: number;
    transaction_count: number;
    exception_amount: number;
    exception_count: number;
  };
}

interface UberExpenseModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (input: CreateExpenseInput) => Promise<unknown>;
  sapSession: SapSessionLike | null;
  onCreated?: () => void;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function employeeKey(name: string, email: string, fallback: string) {
  return (email || normalizeText(name).replace(/\s+/g, "") || fallback).toLowerCase();
}

function roundMoney(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function optionFromCodeName(code?: string | null, name?: string | null): SapSearchOption | null {
  const cleanCode = String(code || "").trim();
  if (!cleanCode) return null;
  return { code: cleanCode, name: String(name || cleanCode).trim() || cleanCode };
}

function findOptionByNeedle(options: SapSearchOption[], needles: string[]) {
  const normalizedNeedles = needles.map(normalizeText).filter(Boolean);
  return options.find((opt) => {
    const haystack = normalizeText(`${opt.code} ${opt.name} ${opt.extra || ""}`);
    return normalizedNeedles.some((needle) => haystack.includes(needle));
  }) || null;
}

function isAbortLikeError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    /abort|aborted|signal has been aborted/i.test(message)
  );
}

function isMissingPersistenceError(err: unknown) {
  const message = err instanceof Error ? err.message : String((err as any)?.message || err || "");
  return /(does not exist|schema cache|relation .* does not exist)/i.test(message);
}

function localOptionFromQuery(query: string, fallbackName: string, prefix: string): SapSearchOption {
  const name = query.trim() || fallbackName;
  const codeSeed = normalizeText(name).replace(/\s+/g, "_").toUpperCase().slice(0, 32) || prefix;
  return {
    code: `LOCAL_${prefix}_${codeSeed}`,
    name,
    extra: "Fallback local",
  };
}

export function UberExpenseModal({
  open,
  onClose,
  onCreate,
  sapSession,
  onCreated,
}: UberExpenseModalProps) {
  const dialogBodyRef = useRef<HTMLDivElement>(null);
  const companyDb = sapSession?.companyDB || null;
  const activeCompanyDb = open ? companyDb : null;
  const isOmie = String(sapSession?.erpType || "").toLowerCase() === "omie";
  const supplierPrefillResolvedRef = useRef(false);
  const itemPrefillResolvedRef = useRef(false);

  const [step, setStep] = useState<WizardStep>("users");
  const [data, setData] = useState<UberTripsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingMappings, setSavingMappings] = useState(false);
  const [supplier, setSupplier] = useState<SapSearchOption | null>(null);
  const [item, setItem] = useState<SapSearchOption | null>(null);
  const [docDate, setDocDate] = useState(todayIso);
  const [dueDate, setDueDate] = useState(todayIso);
  const [userCostCenters, setUserCostCenters] = useState<Record<string, SapSearchOption | null>>({});
  const [lineProjects, setLineProjects] = useState<Record<string, SapSearchOption | null>>({});

  const { options: supplierOptions, isLoading: suppliersLoading } = useMergedSupplierOptions({
    companyDb: activeCompanyDb,
    isSales: false,
  });
  const { options: itemOptions, isLoading: itemsLoading } = useSapCachedList({
    cacheKey: isOmie ? "omie_purchase_products_v1" : "items_purchase_active_v4",
    endpoint: "Items",
    params: isOmie
      ? undefined
      : {
          $filter: "PurchaseItem eq 'tYES' and Valid eq 'tYES' and Frozen eq 'tNO'",
          $select: "ItemCode,ItemName,ItemsGroupCode",
        },
    mapRow: (row) => ({
      code: String(row.ItemCode || ""),
      name: String(row.ItemName || ""),
      extra: row.ItemsGroupCode ? `Grupo ${row.ItemsGroupCode}` : undefined,
    }),
    enabled: open,
  });
  const { options: costCenterOptions, isLoading: costCentersLoading } = useSapCachedList({
    cacheKey: isOmie ? "omie_categories_expense_v1" : "cost_centers",
    endpoint: "ProfitCenters",
    params: isOmie ? undefined : { $filter: "Active eq 'tYES'", $select: "CenterCode,CenterName" },
    mapRow: (row) => ({
      code: String(row.CenterCode || row.codigo || row.code || ""),
      name: String(row.CenterName || row.descricao || row.name || row.descr || ""),
    }),
    enabled: open,
  });
  const { options: projectOptions, isLoading: projectsLoading } = useSapCachedList({
    cacheKey: "projects",
    endpoint: "Projects",
    params: { $filter: "Active eq 'tYES'", $select: "Code,Name" },
    mapRow: (row) => ({ code: String(row.Code || ""), name: String(row.Name || "") }),
    enabled: open && !isOmie,
  });

  const loadTrips = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setError(null);
    try {
      const response = await sapFunctionFetch("uber-trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_db: companyDb }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Falha ao carregar viagens Uber");
      }
      setData(payload as UberTripsResponse);
    } catch (err) {
      const message = isAbortLikeError(err)
        ? "Tempo esgotado ao carregar viagens Uber. Tente novamente em alguns segundos."
        : err instanceof Error
          ? err.message
          : "Falha ao carregar viagens Uber";
      setError(message);
      toast.error(message, { duration: 8000 });
    } finally {
      setLoading(false);
    }
  }, [companyDb, open]);

  useEffect(() => {
    if (!open) return;
    void loadTrips();
  }, [open, loadTrips]);

  useEffect(() => {
    if (!open) return;
    supplierPrefillResolvedRef.current = false;
    itemPrefillResolvedRef.current = false;
    setStep("users");
    setSupplier(UBER_DEFAULT_SUPPLIER);
    setItem(UBER_DEFAULT_ITEM);
    setDocDate(todayIso());
    setDueDate(todayIso());
    setUserCostCenters({});
    setLineProjects({});
  }, [open]);

  useEffect(() => {
    if (!open || supplierPrefillResolvedRef.current || supplierOptions.length === 0) return;
    const found = findOptionByNeedle(supplierOptions, [UBER_DEFAULT_SUPPLIER_NAME, "UBER"]);
    if (found) {
      supplierPrefillResolvedRef.current = true;
      setSupplier(found);
    }
  }, [open, supplierOptions]);

  useEffect(() => {
    if (!open || itemPrefillResolvedRef.current || itemOptions.length === 0) return;
    const found = findOptionByNeedle(itemOptions, [UBER_DEFAULT_ITEM_NAME, "Uber", "Transporte"]);
    if (found) {
      itemPrefillResolvedRef.current = true;
      setItem(found);
    }
  }, [open, itemOptions]);

  useEffect(() => {
    if (!open || !companyDb) return;
    let cancelled = false;
    void (async () => {
      const { data: defaults, error: defaultsError } = await (supabase as any)
        .from("uber_cost_center_project_defaults")
        .select("cost_center_code,cost_center_label,project_code,project_name")
        .eq("company_db", companyDb);
      if (cancelled) return;
      if (defaultsError) {
        if (!/(does not exist|schema cache|relation .* does not exist)/i.test(defaultsError.message || "")) {
          console.warn("[UberExpenseModal] Falha ao carregar projetos padrão do Uber.", defaultsError);
        }
        return;
      }
      const next: Record<string, SapSearchOption | null> = {};
      for (const row of defaults || []) {
        if (row.cost_center_code && row.project_code) {
          next[row.cost_center_code] = { code: row.project_code, name: row.project_name || row.project_code };
        }
      }
      setLineProjects((prev) => ({ ...next, ...prev }));
    })();
    return () => {
      cancelled = true;
    };
  }, [companyDb, open]);

  const userRows = useMemo<UberUserRow[]>(() => {
    const rows = new Map<string, UberUserRow>();

    const addRow = (input: UberUserRow) => {
      const current = rows.get(input.key) || {
        ...input,
        amount: 0,
        transaction_count: 0,
        sources: [],
        reasons: [],
      };
      current.amount += input.amount;
      current.transaction_count += input.transaction_count;
      current.sources = Array.from(new Set([...current.sources, ...input.sources])).sort((a, b) =>
        a.localeCompare(b, "pt-BR"),
      );
      current.reasons = Array.from(new Set([...current.reasons, ...input.reasons])).sort((a, b) =>
        a.localeCompare(b, "pt-BR"),
      );
      if (!current.cost_center_code && input.cost_center_code) {
        current.cost_center_code = input.cost_center_code;
        current.cost_center_label = input.cost_center_label;
      }
      rows.set(input.key, current);
    };

    for (const summaryRow of data?.summary || []) {
      const employees = summaryRow.employees?.length
        ? summaryRow.employees
        : [{
            user_key: summaryRow.user_key || "",
            employee_name: summaryRow.employee_name || "",
            email: summaryRow.email || "",
            amount: summaryRow.amount,
            transaction_count: summaryRow.transaction_count,
            sources: summaryRow.sources || [],
          }];

      for (const employee of employees) {
        const name = employee.employee_name || employee.email || "Sem nome";
        const email = employee.email || "";
        addRow({
          key: employeeKey(name, email, employee.user_key || `${summaryRow.cost_center_code}:${name}`),
          employee_name: name,
          email,
          amount: roundMoney(employee.amount || 0),
          transaction_count: employee.transaction_count || 0,
          sources: employee.sources || summaryRow.sources || [],
          reasons: [],
          cost_center_code: summaryRow.cost_center_code,
          cost_center_label: summaryRow.cost_center_label || summaryRow.cost_center_code,
        });
      }
    }

    for (const exception of data?.exceptions || []) {
      const name = exception.trip.employee_name || exception.trip.email || "Sem nome";
      const email = exception.trip.email || "";
      addRow({
        key: employeeKey(name, email, exception.trip.trip_id),
        employee_name: name,
        email,
        amount: roundMoney(exception.trip.amount || 0),
        transaction_count: 1,
        sources: exception.trip.source_label ? [exception.trip.source_label] : [],
        reasons: [exception.reason],
        cost_center_code: "",
        cost_center_label: "",
      });
    }

    return Array.from(rows.values())
      .map((row) => ({ ...row, amount: roundMoney(row.amount) }))
      .sort((a, b) => a.employee_name.localeCompare(b.employee_name, "pt-BR"));
  }, [data?.exceptions, data?.summary]);

  const effectiveCostCenterForUser = useCallback(
    (row: UberUserRow) => userCostCenters[row.key] || optionFromCodeName(row.cost_center_code, row.cost_center_label),
    [userCostCenters],
  );

  const unresolvedUsers = useMemo(
    () => userRows.filter((row) => !effectiveCostCenterForUser(row)),
    [effectiveCostCenterForUser, userRows],
  );

  const costCenterRows = useMemo<UberCostCenterRow[]>(() => {
    const rows = new Map<string, UberCostCenterRow>();

    for (const user of userRows) {
      const costCenter = effectiveCostCenterForUser(user);
      if (!costCenter?.code) continue;
      const existing = rows.get(costCenter.code) || {
        row_key: costCenter.code,
        cost_center_code: costCenter.code,
        cost_center_label: costCenter.name || costCenter.code,
        amount: 0,
        transaction_count: 0,
        employee_count: 0,
        employees: [],
        sources: [],
      };
      existing.amount += user.amount;
      existing.transaction_count += user.transaction_count;
      existing.employee_count += 1;
      existing.employees.push(user.employee_name);
      existing.sources = Array.from(new Set([...existing.sources, ...user.sources])).sort((a, b) =>
        a.localeCompare(b, "pt-BR"),
      );
      rows.set(costCenter.code, existing);
    }

    return Array.from(rows.values())
      .map((row) => ({ ...row, amount: roundMoney(row.amount) }))
      .sort((a, b) => a.cost_center_code.localeCompare(b.cost_center_code, "pt-BR", { numeric: true }));
  }, [effectiveCostCenterForUser, userRows]);

  const missingProjects = costCenterRows.filter((row) => !lineProjects[row.row_key]);
  const totalAmount = costCenterRows.reduce((sum, row) => sum + row.amount, 0);
  const supplierReady = !!supplier?.code;
  const itemReady = !!item?.code;
  const canAdvance =
    userRows.length > 0 &&
    unresolvedUsers.length === 0 &&
    !loading &&
    !savingMappings &&
    !submitting;
  const canSubmit =
    supplierReady &&
    itemReady &&
    !!docDate &&
    !!dueDate &&
    costCenterRows.length > 0 &&
    unresolvedUsers.length === 0 &&
    missingProjects.length === 0 &&
    totalAmount > 0 &&
    !loading &&
    !savingMappings &&
    !submitting;

  const saveUserMappings = useCallback(async () => {
    if (unresolvedUsers.length > 0 || userRows.length === 0) return false;
    if (!companyDb) {
      toast.warning("Sem empresa ativa para persistir o mapeamento. Avançando apenas nesta sessão.");
      return true;
    }
    setSavingMappings(true);
    try {
      const rows = userRows
        .map((row) => {
          const costCenter = effectiveCostCenterForUser(row);
          if (!costCenter?.code) return null;
          return {
            company_db: companyDb,
            source: "uber",
            employee_key: row.key,
            employee_name: row.employee_name,
            employee_email: row.email || null,
            cost_center_code: costCenter.code,
            cost_center_label: costCenter.name || costCenter.code,
            updated_at: new Date().toISOString(),
          };
        })
        .filter(Boolean);

      if (rows.length > 0) {
        const response = await sapFunctionFetch("uber-trips", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "save_user_mappings",
            company_db: companyDb,
            rows,
          }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || "Falha ao salvar mapeamento Uber");
        }
      }
      toast.success("Mapeamento de usuários salvo.");
      return true;
    } catch (err) {
      if (isMissingPersistenceError(err)) {
        toast.warning("Tabela de mapeamento Uber ainda não aplicada neste ambiente. Avançando apenas nesta sessão.");
        return true;
      }
      toast.error(err instanceof Error ? err.message : "Falha ao salvar mapeamento Uber");
      return false;
    } finally {
      setSavingMappings(false);
    }
  }, [companyDb, effectiveCostCenterForUser, unresolvedUsers.length, userRows]);

  const saveProjectDefaults = useCallback(async () => {
    if (missingProjects.length > 0 || costCenterRows.length === 0) return false;
    if (!companyDb) return true;
    const rows = costCenterRows
      .map((row) => {
        const project = lineProjects[row.row_key];
        if (!project?.code) return null;
        return {
          company_db: companyDb,
          cost_center_code: row.cost_center_code,
          cost_center_label: row.cost_center_label,
          project_code: project.code,
          project_name: project.name || project.code,
          updated_at: new Date().toISOString(),
        };
      })
      .filter(Boolean);

    if (rows.length > 0) {
      const response = await sapFunctionFetch("uber-trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_project_defaults",
          company_db: companyDb,
          rows,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        if (isMissingPersistenceError(payload?.error)) {
          toast.warning("Projeto padrão ainda não pode ser persistido neste ambiente. O pedido seguirá com os projetos selecionados.");
          return true;
        }
        throw new Error(payload?.error || "Falha ao salvar projeto padrão Uber");
      }
    }
    return true;
  }, [companyDb, costCenterRows, lineProjects, missingProjects.length]);

  const handleAdvance = async () => {
    if (!canAdvance) return;
    const saved = await saveUserMappings();
    if (saved) setStep("projects");
  };

  const handleSubmit = async () => {
    if (!supplier?.code || !item?.code || !canSubmit) return;
    setSubmitting(true);
    try {
      await saveProjectDefaults();

      const items = costCenterRows.map((row) => {
        const project = lineProjects[row.row_key];
        return {
          item_code: item.code,
          description: `Transporte de passageiros Uber - ${row.cost_center_label}`,
          quantity: 1,
          unit_price: row.amount,
          line_total: row.amount,
          cost_center: row.cost_center_code,
          project: project?.code || "",
        };
      });

      await onCreate({
        supplier_code: supplier.code,
        supplier_name: supplier.name || UBER_DEFAULT_SUPPLIER_NAME,
        supplier_tax_id: supplier.extra || null,
        currency: "BRL",
        doc_type: "purchase",
        origin: "uber",
        rateio_type: "viagens",
        doc_date: docDate,
        due_date: dueDate,
        cost_center: items[0]?.cost_center,
        project: items[0]?.project,
        remarks: `Despesa Uber - ${data?.totals.transaction_count || 0} viagens - ${
          data?.integration?.display_name || companyDb || "Integração Uber"
        }`,
        items,
        files: [],
      });
      toast.success("Despesa Uber enviada para aprovação.");
      onCreated?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao criar despesa Uber");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !submitting) onClose(); }}>
      <DialogContent
        ref={dialogBodyRef}
        className="max-w-[min(1120px,calc(100vw-2rem))] max-h-[92vh] overflow-hidden"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Car className="h-5 w-5 text-primary" aria-hidden="true" />
            Despesa Uber
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[72vh] pr-4">
          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_160px_160px]">
              <CachedSearchCombobox
                label="Fornecedor"
                options={supplierOptions}
                isLoading={suppliersLoading}
                value={supplier}
                onChange={setSupplier}
                placeholder={UBER_DEFAULT_SUPPLIER_NAME}
                suggestedQuery={supplierReady ? undefined : UBER_DEFAULT_SUPPLIER_NAME}
                footerHint={!suppliersLoading && supplierOptions.length === 0 ? "Nenhum fornecedor carregado para a empresa atual." : undefined}
                renderEmptyState={(query) => (
                  <div className="space-y-2 text-center">
                    <div className="text-sm text-muted-foreground">Nenhum fornecedor encontrado.</div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setSupplier(localOptionFromQuery(query, UBER_DEFAULT_SUPPLIER_NAME, "SUPPLIER"))}
                    >
                      Usar texto informado
                    </Button>
                  </div>
                )}
                portalContainer={dialogBodyRef.current}
                required
              />
              <CachedSearchCombobox
                label="Item"
                options={itemOptions}
                isLoading={itemsLoading}
                value={item}
                onChange={setItem}
                placeholder={UBER_DEFAULT_ITEM_NAME}
                suggestedQuery={itemReady ? undefined : UBER_DEFAULT_ITEM_NAME}
                footerHint={!itemsLoading && itemOptions.length === 0 ? "Nenhum item carregado para a empresa atual." : undefined}
                renderEmptyState={(query) => (
                  <div className="space-y-2 text-center">
                    <div className="text-sm text-muted-foreground">Nenhum item encontrado.</div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setItem(localOptionFromQuery(query, UBER_DEFAULT_ITEM_NAME, "ITEM"))}
                    >
                      Usar texto informado
                    </Button>
                  </div>
                )}
                portalContainer={dialogBodyRef.current}
                required
              />
              <div className="space-y-1.5">
                <Label>Data doc.</Label>
                <Input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Vencimento</Label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/70 bg-muted/20 p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="secondary">{data?.totals.transaction_count || 0} viagens</Badge>
                <Badge variant="secondary">{formatCurrency(data?.totals.amount || 0)}</Badge>
                {data?.integration?.display_name && (
                  <Badge variant="outline">{data.integration.display_name}</Badge>
                )}
                <Badge variant={unresolvedUsers.length > 0 ? "destructive" : "outline"}>
                  {unresolvedUsers.length} usuários sem CC
                </Badge>
                <Badge variant={missingProjects.length > 0 && step === "projects" ? "destructive" : "outline"}>
                  {missingProjects.length} CCs sem projeto
                </Badge>
              </div>
              <Button variant="outline" size="sm" onClick={() => void loadTrips()} disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Atualizar viagens
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-2 rounded-md bg-muted p-1 text-sm">
              <button
                type="button"
                className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 font-medium transition ${
                  step === "users" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
                }`}
                onClick={() => setStep("users")}
              >
                <Users className="h-4 w-4" />
                1. Mapeamento de usuários
              </button>
              <button
                type="button"
                className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 font-medium transition ${
                  step === "projects" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
                }`}
                onClick={() => {
                  if (canAdvance) setStep("projects");
                }}
              >
                <CheckCircle2 className="h-4 w-4" />
                2. Projetos por centro de custo
              </button>
            </div>

            {error && (
              <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {step === "users" ? (
              <section className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-foreground">Mapeamento de usuários</h3>
                  <span className="text-xs text-muted-foreground">Um vínculo por colaborador para próximos lançamentos</span>
                </div>
                <div className="overflow-hidden rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Colaborador</TableHead>
                        <TableHead>Viagens</TableHead>
                        <TableHead className="w-[330px]">Centro de custo</TableHead>
                        <TableHead>Origem</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {userRows.map((row) => {
                        const selected = effectiveCostCenterForUser(row);
                        return (
                          <TableRow key={row.key}>
                            <TableCell>
                              <div className="font-medium">{row.employee_name}</div>
                              <div className="text-xs text-muted-foreground">{row.email || "Sem e-mail"}</div>
                              {row.reasons.length > 0 && (
                                <div className="mt-1">
                                  <Badge variant="destructive">{row.reasons.join(", ")}</Badge>
                                </div>
                              )}
                            </TableCell>
                            <TableCell>{row.transaction_count}</TableCell>
                            <TableCell>
                              <CachedSearchCombobox
                                options={costCenterOptions}
                                isLoading={costCentersLoading}
                                value={selected}
                                onChange={(value) => setUserCostCenters((prev) => ({ ...prev, [row.key]: value }))}
                                placeholder="Buscar CC..."
                                portalContainer={dialogBodyRef.current}
                                required
                              />
                            </TableCell>
                            <TableCell className="max-w-[220px]">
                              <div className="truncate text-sm">{row.sources.join(", ")}</div>
                            </TableCell>
                            <TableCell className="text-right font-semibold">{formatCurrency(row.amount)}</TableCell>
                          </TableRow>
                        );
                      })}
                      {!loading && userRows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                            Nenhuma viagem com valor para mapear.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </section>
            ) : (
              <section className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-foreground">Rateio por centro de custo</h3>
                  <span className="text-xs text-muted-foreground">Projeto padrão salvo por centro de custo</span>
                </div>
                <div className="overflow-hidden rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Centro de custo</TableHead>
                        <TableHead>Viagens</TableHead>
                        <TableHead>Colaboradores</TableHead>
                        <TableHead className="w-[300px]">Projeto padrão</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {costCenterRows.map((row) => (
                        <TableRow key={row.row_key}>
                          <TableCell>
                            <div className="font-medium">{row.cost_center_code}</div>
                            <div className="text-xs text-muted-foreground">{row.cost_center_label}</div>
                          </TableCell>
                          <TableCell>{row.transaction_count}</TableCell>
                          <TableCell className="max-w-[260px]">
                            <div className="truncate">{row.employee_count} colaborador(es)</div>
                            <div className="truncate text-xs text-muted-foreground">{row.employees.join(", ")}</div>
                          </TableCell>
                          <TableCell>
                            <CachedSearchCombobox
                              options={projectOptions}
                              isLoading={projectsLoading}
                              value={lineProjects[row.row_key] || null}
                              onChange={(value) => setLineProjects((prev) => ({ ...prev, [row.row_key]: value }))}
                              placeholder="Buscar projeto..."
                              portalContainer={dialogBodyRef.current}
                              required
                            />
                          </TableCell>
                          <TableCell className="text-right font-semibold">{formatCurrency(row.amount)}</TableCell>
                        </TableRow>
                      ))}
                      {!loading && costCenterRows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                            Nenhum centro de custo pronto para montar o pedido.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </section>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="items-center gap-3 sm:justify-between">
          <div className="mr-auto flex items-center gap-2 text-sm text-muted-foreground">
            {canSubmit ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />}
            <span>Total do pedido: <strong className="text-foreground">{formatCurrency(totalAmount)}</strong></span>
          </div>
          {step === "users" ? (
            <>
              <Button variant="outline" onClick={onClose} disabled={savingMappings || submitting}>Cancelar</Button>
              <Button onClick={() => void handleAdvance()} disabled={!canAdvance}>
                {savingMappings ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Salvar e avançar
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep("users")} disabled={submitting}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Voltar
              </Button>
              <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Enviar para aprovação
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
