import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Plus,
  Save,
  Trash2,
  Loader2,
  MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CachedSearchCombobox } from "@/components/CachedSearchCombobox";
import { useSapCachedList } from "@/hooks/useSapCachedList";
import { usePagCorp } from "@/hooks/usePagCorp";
import type { SapSearchOption } from "@/components/SapSearchCombobox";

interface AccountMapping {
  id?: string;
  account_code: string;
  account_name: string;
  cost_center: string;
  project: string;
  isNew?: boolean;
}

export default function PagCorpMapping() {
  const navigate = useNavigate();
  const [mappings, setMappings] = useState<AccountMapping[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const costCenterCache = useSapCachedList({
    cacheKey: "CostCenters",
    endpoint: "CostCenters",
    mapRow: (r: any) => ({ code: r.CenterCode, name: r.CenterName, extra: "" }),
  });

  const projectCache = useSapCachedList({
    cacheKey: "Projects",
    endpoint: "Projects",
    mapRow: (r: any) => ({ code: r.Code, name: r.Name, extra: "" }),
  });

  // Fetch PagCorp transactions from last 30 days for account code suggestions
  const { transactions: recentTransactions, fetchTransactions } = usePagCorp();

  useEffect(() => {
    const today = new Date();
    const thirtyDaysAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30);
    fetchTransactions(thirtyDaysAgo.toISOString().slice(0, 10), today.toISOString().slice(0, 10));
  }, []);

  // Build unique account code options from recent transactions
  const accountCodeOptions: SapSearchOption[] = useMemo(() => {
    const map = new Map<string, string>();
    recentTransactions.forEach((t) => {
      const code = t.accountCode || "";
      const name = t.accountName || "";
      if (code && !map.has(code)) {
        map.set(code, name);
      }
    });
    return Array.from(map.entries()).map(([code, name]) => ({
      code,
      name,
      extra: "",
    }));
  }, [recentTransactions]);

  useEffect(() => {
    loadMappings();
  }, []);

  async function loadMappings() {
    setIsLoading(true);
    const { data, error } = await supabase
      .from("pagcorp_account_mapping")
      .select("*")
      .order("account_name");

    if (error) {
      toast.error("Erro ao carregar mapeamentos");
      console.error(error);
    } else {
      setMappings(
        (data || []).map((r: any) => ({
          id: r.id,
          account_code: r.account_code,
          account_name: r.account_name || "",
          cost_center: r.cost_center || "",
          project: r.project || "",
        }))
      );
    }
    setIsLoading(false);
  }

  function addRow() {
    setMappings((prev) => [
      ...prev,
      { account_code: "", account_name: "", cost_center: "", project: "", isNew: true },
    ]);
  }

  function updateRow(index: number, field: keyof AccountMapping, value: string) {
    setMappings((prev) =>
      prev.map((m, i) => (i === index ? { ...m, [field]: value } : m))
    );
  }

  function removeRow(index: number) {
    const mapping = mappings[index];
    if (mapping.id) {
      handleDelete(mapping.id, index);
    } else {
      setMappings((prev) => prev.filter((_, i) => i !== index));
    }
  }

  async function handleDelete(id: string, index: number) {
    const { error } = await supabase
      .from("pagcorp_account_mapping")
      .delete()
      .eq("id", id);
    if (error) {
      toast.error("Erro ao excluir mapeamento");
    } else {
      setMappings((prev) => prev.filter((_, i) => i !== index));
      toast.success("Mapeamento excluído");
    }
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      for (const m of mappings) {
        if (!m.account_code) continue;

        if (m.id) {
          const { error } = await supabase
            .from("pagcorp_account_mapping")
            .update({
              account_name: m.account_name,
              cost_center: m.cost_center || null,
              project: m.project || null,
            })
            .eq("id", m.id);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from("pagcorp_account_mapping")
            .upsert(
              {
                account_code: m.account_code,
                account_name: m.account_name,
                cost_center: m.cost_center || null,
                project: m.project || null,
              },
              { onConflict: "account_code" }
            );
          if (error) throw error;
        }
      }
      toast.success("Mapeamentos salvos com sucesso");
      loadMappings();
    } catch (e: any) {
      toast.error(e.message || "Erro ao salvar");
    } finally {
      setIsSaving(false);
    }
  }

  function findOption(options: SapSearchOption[], code: string): SapSearchOption | null {
    if (!code) return null;
    return options.find((o) => o.code === code) || null;
  }

  // Filter account code options to exclude already-mapped codes
  const availableAccountCodes = useMemo(() => {
    const mappedCodes = new Set(mappings.filter((m) => m.id).map((m) => m.account_code));
    return accountCodeOptions.filter((o) => !mappedCodes.has(o.code));
  }, [accountCodeOptions, mappings]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/pagcorp")}
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="p-2 rounded-lg bg-primary/10">
              <MapPin className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">
                Mapeamento <span className="text-gradient">PagCorp → SAP</span>
              </h1>
              <p className="text-xs text-muted-foreground">
                Vincule contas PagCorp a Centro de Custo e Projeto do SAP
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={addRow} className="gap-2">
              <Plus className="w-4 h-4" /> Adicionar
            </Button>
            <Button onClick={handleSave} disabled={isSaving} className="gap-2">
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Salvar
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 px-6 py-6">
        <div className="max-w-7xl mx-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : mappings.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">
              <MapPin className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="text-lg font-medium">Nenhum mapeamento configurado</p>
              <p className="text-sm mt-1">Clique em Adicionar para criar um mapeamento</p>
              <Button onClick={addRow} variant="outline" className="mt-4 gap-2">
                <Plus className="w-4 h-4" /> Adicionar primeiro mapeamento
              </Button>
            </div>
          ) : (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground">Conta PagCorp</TableHead>
                    <TableHead className="text-muted-foreground">Centro de Custo</TableHead>
                    <TableHead className="text-muted-foreground">Projeto</TableHead>
                    <TableHead className="text-muted-foreground w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mappings.map((m, i) => (
                    <TableRow key={m.id || `new-${i}`} className="border-border">
                      <TableCell>
                        {m.id ? (
                          <div className="text-sm">
                            <span className="font-medium text-foreground">{m.account_name || m.account_code}</span>
                            <span className="ml-2 text-xs text-muted-foreground">{m.account_code}</span>
                          </div>
                        ) : (
                          <CachedSearchCombobox
                            options={availableAccountCodes}
                            isLoading={false}
                            value={findOption(accountCodeOptions, m.account_code)}
                            onChange={(opt) => {
                              if (opt) {
                                setMappings((prev) =>
                                  prev.map((row, idx) =>
                                    idx === i
                                      ? { ...row, account_code: opt.code, account_name: opt.name }
                                      : row
                                  )
                                );
                              } else {
                                setMappings((prev) =>
                                  prev.map((row, idx) =>
                                    idx === i
                                      ? { ...row, account_code: "", account_name: "" }
                                      : row
                                  )
                                );
                              }
                            }}
                            placeholder="Buscar conta PagCorp..."
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        <CachedSearchCombobox
                          options={costCenterCache.options}
                          isLoading={costCenterCache.isLoading}
                          value={findOption(costCenterCache.options, m.cost_center)}
                          onChange={(opt) => updateRow(i, "cost_center", opt?.code || "")}
                          placeholder="Selecione..."
                        />
                      </TableCell>
                      <TableCell>
                        <CachedSearchCombobox
                          options={projectCache.options}
                          isLoading={projectCache.isLoading}
                          value={findOption(projectCache.options, m.project)}
                          onChange={(opt) => updateRow(i, "project", opt?.code || "")}
                          placeholder="Selecione..."
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeRow(i)}
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
      </main>
    </div>
  );
}
