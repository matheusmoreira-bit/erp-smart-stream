import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Plus, Save, Trash2, Search, X, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type SapSearchOption } from "@/components/SapSearchCombobox";
import { CachedSearchCombobox } from "@/components/CachedSearchCombobox";
import { useMergedSupplierOptions } from "@/hooks/useMergedSupplierOptions";
import { toast } from "sonner";
import { usePagCorpSupplierRules } from "@/hooks/usePagCorpSupplierRules";
import { findSupplierRule, type SupplierRuleMatchType } from "@/lib/pagcorp-supplier-rules";

interface EditableRule {
  id?: string;
  pattern: string;
  match_type: SupplierRuleMatchType;
  supplier_code: string;
  supplier_name: string;
  priority: number;
  is_active: boolean;
  isNew?: boolean;
}

export function PagcorpSupplierRulesTab({ companyDb }: { companyDb: string }) {
  const { rules, isLoading, reload } = usePagCorpSupplierRules(companyDb || undefined);
  // Fornecedores vêm da base local (cache em public.sap_cache + public.suppliers),
  // sem consultar o ERP a cada digitação.
  const { options: supplierOptions, isLoading: isLoadingSuppliers } = useMergedSupplierOptions({ companyDb });
  const [draft, setDraft] = useState<EditableRule[] | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [testText, setTestText] = useState("");

  const rows: EditableRule[] = useMemo(() => {
    if (draft) return draft;
    return rules.map((r) => ({
      id: r.id,
      pattern: r.pattern,
      match_type: r.match_type,
      supplier_code: r.supplier_code,
      supplier_name: r.supplier_name || "",
      priority: r.priority ?? 100,
      is_active: r.is_active !== false,
    }));
  }, [rules, draft]);

  const update = (index: number, patch: Partial<EditableRule>) =>
    setDraft(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const addRow = () =>
    setDraft([
      ...rows,
      {
        pattern: "",
        match_type: "startswith",
        supplier_code: "",
        supplier_name: "",
        priority: 100,
        is_active: true,
        isNew: true,
      },
    ]);

  async function removeRow(index: number) {
    const row = rows[index];
    if (!row.id) {
      setDraft(rows.filter((_, i) => i !== index));
      return;
    }
    const { sapFunctionFetch } = await import("@/lib/auth-fetch");
    const res = await sapFunctionFetch("pagcorp-card-mapping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete-supplier-rule", id: row.id }),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || result.success === false) {
      toast.error(result.error || "Erro ao excluir regra");
      return;
    }
    setDraft(null);
    await reload();
    toast.success("Regra excluída");
  }

  async function save() {
    if (!companyDb) {
      toast.error("Selecione uma empresa antes de salvar");
      return;
    }
    const payload = rows
      .filter((r) => r.pattern.trim() && r.supplier_code.trim())
      .map((r) => ({
        id: r.id,
        pattern: r.pattern.trim(),
        match_type: r.match_type,
        supplier_code: r.supplier_code.trim(),
        supplier_name: r.supplier_name || null,
        priority: r.priority,
        is_active: r.is_active,
      }));
    if (payload.length === 0) {
      toast.error("Preencha o trecho da descrição e o fornecedor");
      return;
    }
    setIsSaving(true);
    try {
      const { sapFunctionFetch } = await import("@/lib/auth-fetch");
      const res = await sapFunctionFetch("pagcorp-card-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save-supplier-rules", company_db: companyDb, rules: payload }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || result.success === false) throw new Error(result.error || `Erro ${res.status}`);
      setDraft(null);
      await reload();
      toast.success("Regras de fornecedor salvas");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setIsSaving(false);
    }
  }

  const visibleRows = useMemo(() => {
    const list = rows.map((r, index) => ({ r, index }));
    const term = search.trim().toLowerCase();
    if (!term) return list;
    return list.filter(({ r }) =>
      r.isNew ||
      [r.pattern, r.supplier_code, r.supplier_name].join(" ").toLowerCase().includes(term),
    );
  }, [rows, search]);

  const testMatch = useMemo(() => {
    if (!testText.trim()) return null;
    return findSupplierRule(
      rows.map((r) => ({
        company_db: companyDb,
        pattern: r.pattern,
        match_type: r.match_type,
        supplier_code: r.supplier_code,
        supplier_name: r.supplier_name,
        priority: r.priority,
        is_active: r.is_active,
      })),
      testText,
    );
  }, [rows, testText, companyDb]);

  if (!companyDb) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <Store className="w-12 h-12 mx-auto mb-4 opacity-30" />
        <p className="text-lg font-medium">Selecione uma empresa</p>
        <p className="text-sm mt-1">As regras de fornecedor são por empresa.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Defina o <strong>fornecedor padrão</strong> a partir de um trecho da descrição da transação.
          Ex.: descrição que <Badge variant="secondary">começa com</Badge> <code>CURSOR,</code> → fornecedor{" "}
          <code>F001636</code>. Empresa atual: <strong>{companyDb}</strong>
        </p>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" onClick={addRow} className="gap-2">
            <Plus className="w-4 h-4" /> Adicionar
          </Button>
          <Button onClick={save} disabled={isSaving} className="gap-2">
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por trecho ou fornecedor…"
            aria-label="Buscar regras de fornecedor"
            className="pl-9"
          />
        </div>
        {search && (
          <Button variant="ghost" size="sm" onClick={() => setSearch("")} className="gap-1">
            <X className="w-3.5 h-3.5" /> Limpar
          </Button>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <Input
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            placeholder="Testar uma descrição…"
            aria-label="Testar descrição contra as regras"
            className="w-72"
          />
          {testText.trim() && (
            <span className="text-xs text-muted-foreground">
              {testMatch
                ? `→ ${testMatch.supplier_code}${testMatch.supplier_name ? ` — ${testMatch.supplier_name}` : ""}`
                : "Nenhuma regra corresponde"}
            </span>
          )}
        </div>
      </div>

      {isLoading && !draft ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Store className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">Nenhuma regra cadastrada</p>
          <Button onClick={addRow} variant="outline" className="mt-4 gap-2">
            <Plus className="w-4 h-4" /> Adicionar
          </Button>
        </div>
      ) : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card overflow-visible">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground w-40">Condição</TableHead>
                <TableHead className="text-muted-foreground">Trecho da descrição</TableHead>
                <TableHead className="text-muted-foreground">Fornecedor</TableHead>
                <TableHead className="text-muted-foreground w-24">Prioridade</TableHead>
                <TableHead className="text-muted-foreground w-20">Ativa</TableHead>
                <TableHead className="text-muted-foreground w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.length === 0 && (
                <TableRow className="border-border hover:bg-transparent">
                  <TableCell colSpan={6} className="text-center py-10 text-sm text-muted-foreground">
                    Nenhuma regra encontrada para "{search}".
                  </TableCell>
                </TableRow>
              )}
              {visibleRows.map(({ r, index }) => (
                <TableRow key={r.id || `new-rule-${index}`} className="border-border">
                  <TableCell>
                    <Select
                      value={r.match_type}
                      onValueChange={(v) => update(index, { match_type: v as SupplierRuleMatchType })}
                    >
                      <SelectTrigger aria-label="Tipo de correspondência">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="startswith">Começa com</SelectItem>
                        <SelectItem value="contains">Contém</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      value={r.pattern}
                      onChange={(e) => update(index, { pattern: e.target.value })}
                      placeholder="Ex.: CURSOR,"
                      aria-label="Trecho da descrição"
                    />
                  </TableCell>
                  <TableCell>
                    <SapSearchCombobox
                      endpoint="BusinessPartners"
                      filterTemplate="CardType eq 'cSupplier' and Frozen ne 'tYES' and (contains(tolower(CardName),'{qLower}') or contains(tolower(CardCode),'{qLower}') or contains(tolower(AliasName),'{qLower}') or contains(FederalTaxID,'{q}'))"
                      selectFields="CardCode,CardName,AliasName,FederalTaxID"
                      mapRow={(row: Record<string, unknown>) => ({
                        code: String(row.CardCode ?? ""),
                        name: String(row.CardName ?? ""),
                        extra: (row.FederalTaxID as string) || undefined,
                      })}
                      value={
                        r.supplier_code
                          ? ({ code: r.supplier_code, name: r.supplier_name || r.supplier_code } as SapSearchOption)
                          : null
                      }
                      onChange={(opt) =>
                        update(index, {
                          supplier_code: opt?.code || "",
                          supplier_name: opt?.name || "",
                        })
                      }
                      placeholder="Buscar fornecedor…"
                      topResults={50}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={r.priority}
                      onChange={(e) => update(index, { priority: Number(e.target.value) || 0 })}
                      aria-label="Prioridade"
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={r.is_active}
                      onCheckedChange={(v) => update(index, { is_active: v })}
                      aria-label="Regra ativa"
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Excluir regra"
                      title="Excluir regra"
                      onClick={() => removeRow(index)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </motion.div>
      )}
    </div>
  );
}
