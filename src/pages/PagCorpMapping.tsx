import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Plus,
  Save,
  Trash2,
  Loader2,
  MapPin,
  Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CachedSearchCombobox } from "@/components/CachedSearchCombobox";
import { useSapCachedList } from "@/hooks/useSapCachedList";
import { usePagCorp } from "@/hooks/usePagCorp";
import type { SapSearchOption } from "@/components/SapSearchCombobox";

/* ── Account → Cost Center / Project mapping ── */
interface AccountMapping {
  id?: string;
  account_code: string;
  account_name: string;
  cost_center: string;
  project: string;
  isNew?: boolean;
}

/* ── Account → Item mapping ── */
interface ItemMapping {
  id?: string;
  account_code: string | null;
  account_name: string | null;
  item_code: string;
  is_fallback: boolean;
  isNew?: boolean;
}

export default function PagCorpMapping() {
  const navigate = useNavigate();

  /* ── SAP caches ── */
  const costCenterCache = useSapCachedList({
    cacheKey: "cost_centers",
    endpoint: "CostCenters",
    mapRow: (r: any) => ({ code: r.CenterCode, name: r.CenterName, extra: "" }),
  });
  const projectCache = useSapCachedList({
    cacheKey: "projects",
    endpoint: "Projects",
    mapRow: (r: any) => ({ code: r.Code, name: r.Name, extra: "" }),
  });
  const itemCache = useSapCachedList({
    cacheKey: "items",
    endpoint: "Items",
    params: { $select: "ItemCode,ItemName" },
    mapRow: (r: any) => ({ code: r.ItemCode, name: r.ItemName, extra: "" }),
  });

  /* ── PagCorp account suggestions ── */
  const { transactions: recentTransactions, fetchTransactions } = usePagCorp();
  useEffect(() => {
    const today = new Date();
    const ago = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30);
    fetchTransactions(ago.toISOString().slice(0, 10), today.toISOString().slice(0, 10));
  }, []);

  const accountCodeOptions: SapSearchOption[] = useMemo(() => {
    const map = new Map<string, string>();
    recentTransactions.forEach((t) => {
      const code = t.accountCode || "";
      const name = t.accountName || "";
      if (code && !map.has(code)) map.set(code, name);
    });
    return Array.from(map.entries()).map(([code, name]) => ({ code, name, extra: "" }));
  }, [recentTransactions]);

  /* ════════════════════════════════════════════
     TAB 1 – Account → Cost Center / Project
     ════════════════════════════════════════════ */
  const [mappings, setMappings] = useState<AccountMapping[]>([]);
  const [isLoadingMappings, setIsLoadingMappings] = useState(true);
  const [isSavingMappings, setIsSavingMappings] = useState(false);

  useEffect(() => { loadMappings(); }, []);

  async function loadMappings() {
    setIsLoadingMappings(true);
    const { data, error } = await supabase
      .from("pagcorp_account_mapping")
      .select("*")
      .order("account_name");
    if (error) { toast.error("Erro ao carregar mapeamentos"); console.error(error); }
    else {
      setMappings((data || []).map((r: any) => ({
        id: r.id, account_code: r.account_code, account_name: r.account_name || "",
        cost_center: r.cost_center || "", project: r.project || "",
      })));
    }
    setIsLoadingMappings(false);
  }

  function addMappingRow() {
    setMappings((p) => [...p, { account_code: "", account_name: "", cost_center: "", project: "", isNew: true }]);
  }

  function updateMappingRow(i: number, field: keyof AccountMapping, value: string) {
    setMappings((p) => p.map((m, idx) => (idx === i ? { ...m, [field]: value } : m)));
  }

  function removeMappingRow(i: number) {
    const m = mappings[i];
    if (m.id) deleteMappingRow(m.id, i);
    else setMappings((p) => p.filter((_, idx) => idx !== i));
  }

  async function deleteMappingRow(id: string, i: number) {
    const { error } = await supabase.from("pagcorp_account_mapping").delete().eq("id", id);
    if (error) toast.error("Erro ao excluir");
    else { setMappings((p) => p.filter((_, idx) => idx !== i)); toast.success("Excluído"); }
  }

  async function saveMappings() {
    setIsSavingMappings(true);
    try {
      for (const m of mappings) {
        if (!m.account_code) continue;
        if (m.id) {
          const { error } = await supabase.from("pagcorp_account_mapping")
            .update({ account_name: m.account_name, cost_center: m.cost_center || null, project: m.project || null })
            .eq("id", m.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("pagcorp_account_mapping")
            .upsert({ account_code: m.account_code, account_name: m.account_name, cost_center: m.cost_center || null, project: m.project || null }, { onConflict: "account_code" });
          if (error) throw error;
        }
      }
      toast.success("Mapeamentos salvos"); loadMappings();
    } catch (e: any) { toast.error(e.message || "Erro ao salvar"); }
    finally { setIsSavingMappings(false); }
  }

  const availableAccountCodes = useMemo(() => {
    const mapped = new Set(mappings.filter((m) => m.id).map((m) => m.account_code));
    return accountCodeOptions.filter((o) => !mapped.has(o.code));
  }, [accountCodeOptions, mappings]);

  /* ════════════════════════════════════════════
     TAB 2 – Item Mapping (independent)
     ════════════════════════════════════════════ */
  const [itemMappings, setItemMappings] = useState<ItemMapping[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(true);
  const [isSavingItems, setIsSavingItems] = useState(false);

  useEffect(() => { loadItemMappings(); }, []);

  async function loadItemMappings() {
    setIsLoadingItems(true);
    const { data, error } = await supabase
      .from("pagcorp_item_mapping")
      .select("*")
      .order("is_fallback", { ascending: false });
    if (error) { toast.error("Erro ao carregar mapeamento de itens"); console.error(error); }
    else {
      setItemMappings((data || []).map((r: any) => ({
        id: r.id, account_code: r.account_code, account_name: r.account_name,
        item_code: r.item_code || "", is_fallback: r.is_fallback || false,
      })));
    }
    setIsLoadingItems(false);
  }

  function addItemRow() {
    setItemMappings((p) => [...p, { account_code: "", account_name: "", item_code: "", is_fallback: false, isNew: true }]);
  }

  function removeItemRow(i: number) {
    const m = itemMappings[i];
    if (m.id) deleteItemRow(m.id, i);
    else setItemMappings((p) => p.filter((_, idx) => idx !== i));
  }

  async function deleteItemRow(id: string, i: number) {
    const { error } = await supabase.from("pagcorp_item_mapping").delete().eq("id", id);
    if (error) toast.error("Erro ao excluir");
    else { setItemMappings((p) => p.filter((_, idx) => idx !== i)); toast.success("Excluído"); }
  }

  async function saveItemMappings() {
    setIsSavingItems(true);
    try {
      for (const m of itemMappings) {
        if (!m.item_code) continue;
        const payload: any = {
          account_code: m.is_fallback ? null : (m.account_code || null),
          account_name: m.is_fallback ? "Fallback (padrão)" : (m.account_name || null),
          item_code: m.item_code,
          is_fallback: m.is_fallback,
        };
        if (m.id) {
          const { error } = await supabase.from("pagcorp_item_mapping").update(payload).eq("id", m.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("pagcorp_item_mapping").insert(payload);
          if (error) throw error;
        }
      }
      toast.success("Mapeamento de itens salvo"); loadItemMappings();
    } catch (e: any) { toast.error(e.message || "Erro ao salvar"); }
    finally { setIsSavingItems(false); }
  }

  const hasFallback = itemMappings.some((m) => m.is_fallback);

  const availableItemAccountCodes = useMemo(() => {
    const mapped = new Set(itemMappings.filter((m) => m.id && m.account_code).map((m) => m.account_code));
    return accountCodeOptions.filter((o) => !mapped.has(o.code));
  }, [accountCodeOptions, itemMappings]);

  /* ── helpers ── */
  function findOption(options: SapSearchOption[], code: string): SapSearchOption | null {
    if (!code) return null;
    return options.find((o) => o.code === code) || null;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/pagcorp")} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="p-2 rounded-lg bg-primary/10">
            <MapPin className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">
              Mapeamento <span className="text-gradient">PagCorp → SAP</span>
            </h1>
            <p className="text-xs text-muted-foreground">Configure centro de custo, projeto e itens genéricos</p>
          </div>
        </div>
      </header>

      <main className="flex-1 px-6 py-6">
        <div className="max-w-7xl mx-auto">
          <Tabs defaultValue="costcenter" className="space-y-4">
            <TabsList>
              <TabsTrigger value="costcenter" className="gap-2"><MapPin className="w-4 h-4" /> Centro de Custo / Projeto</TabsTrigger>
              <TabsTrigger value="items" className="gap-2"><Package className="w-4 h-4" /> Itens Genéricos</TabsTrigger>
            </TabsList>

            {/* ── TAB: Cost Center / Project ── */}
            <TabsContent value="costcenter" className="space-y-4">
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={addMappingRow} className="gap-2"><Plus className="w-4 h-4" /> Adicionar</Button>
                <Button onClick={saveMappings} disabled={isSavingMappings} className="gap-2">
                  {isSavingMappings ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
                </Button>
              </div>
              {isLoadingMappings ? (
                <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
              ) : mappings.length === 0 ? (
                <div className="text-center py-20 text-muted-foreground">
                  <MapPin className="w-12 h-12 mx-auto mb-4 opacity-30" />
                  <p className="text-lg font-medium">Nenhum mapeamento configurado</p>
                  <Button onClick={addMappingRow} variant="outline" className="mt-4 gap-2"><Plus className="w-4 h-4" /> Adicionar</Button>
                </div>
              ) : (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card overflow-visible">
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
                                  setMappings((p) => p.map((row, idx) => idx === i
                                    ? { ...row, account_code: opt?.code || "", account_name: opt?.name || "" } : row));
                                }}
                                placeholder="Buscar conta PagCorp..."
                              />
                            )}
                          </TableCell>
                          <TableCell>
                            <CachedSearchCombobox options={costCenterCache.options} isLoading={costCenterCache.isLoading}
                              value={findOption(costCenterCache.options, m.cost_center)}
                              onChange={(opt) => updateMappingRow(i, "cost_center", opt?.code || "")}
                              placeholder="Selecione..." />
                          </TableCell>
                          <TableCell>
                            <CachedSearchCombobox options={projectCache.options} isLoading={projectCache.isLoading}
                              value={findOption(projectCache.options, m.project)}
                              onChange={(opt) => updateMappingRow(i, "project", opt?.code || "")}
                              placeholder="Selecione..." />
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" onClick={() => removeMappingRow(i)} className="text-destructive hover:text-destructive">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </motion.div>
              )}
            </TabsContent>

            {/* ── TAB: Item Mapping ── */}
            <TabsContent value="items" className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Mapeie tipos de despesa a itens genéricos do SAP. O <Badge variant="secondary">Fallback</Badge> será usado para despesas sem mapeamento específico.
                </p>
                <div className="flex gap-2">
                  {!hasFallback && (
                    <Button variant="outline" onClick={() => setItemMappings((p) => [
                      { account_code: null, account_name: "Fallback (padrão)", item_code: "", is_fallback: true, isNew: true }, ...p
                    ])} className="gap-2">
                      <Plus className="w-4 h-4" /> Fallback
                    </Button>
                  )}
                  <Button variant="outline" onClick={addItemRow} className="gap-2"><Plus className="w-4 h-4" /> Adicionar</Button>
                  <Button onClick={saveItemMappings} disabled={isSavingItems} className="gap-2">
                    {isSavingItems ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
                  </Button>
                </div>
              </div>
              {isLoadingItems ? (
                <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
              ) : itemMappings.length === 0 ? (
                <div className="text-center py-20 text-muted-foreground">
                  <Package className="w-12 h-12 mx-auto mb-4 opacity-30" />
                  <p className="text-lg font-medium">Nenhum mapeamento de item configurado</p>
                  <p className="text-sm mt-1">Adicione um fallback e/ou mapeamentos por tipo de despesa</p>
                  <Button onClick={() => setItemMappings([{ account_code: null, account_name: "Fallback (padrão)", item_code: "", is_fallback: true, isNew: true }])} variant="outline" className="mt-4 gap-2">
                    <Plus className="w-4 h-4" /> Criar fallback
                  </Button>
                </div>
              ) : (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card overflow-visible">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border hover:bg-transparent">
                        <TableHead className="text-muted-foreground">Tipo de Despesa</TableHead>
                        <TableHead className="text-muted-foreground">Item Genérico SAP</TableHead>
                        <TableHead className="text-muted-foreground w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {itemMappings.map((m, i) => (
                        <TableRow key={m.id || `new-item-${i}`} className="border-border">
                          <TableCell>
                            {m.is_fallback ? (
                              <Badge variant="secondary" className="text-sm">Fallback (padrão)</Badge>
                            ) : m.id ? (
                              <div className="text-sm">
                                <span className="font-medium text-foreground">{m.account_name || m.account_code}</span>
                                <span className="ml-2 text-xs text-muted-foreground">{m.account_code}</span>
                              </div>
                            ) : (
                              <CachedSearchCombobox
                                options={availableItemAccountCodes}
                                isLoading={false}
                                value={findOption(accountCodeOptions, m.account_code || "")}
                                onChange={(opt) => {
                                  setItemMappings((p) => p.map((row, idx) => idx === i
                                    ? { ...row, account_code: opt?.code || "", account_name: opt?.name || "" } : row));
                                }}
                                placeholder="Buscar tipo de despesa..."
                              />
                            )}
                          </TableCell>
                          <TableCell>
                            <CachedSearchCombobox options={itemCache.options} isLoading={itemCache.isLoading}
                              value={findOption(itemCache.options, m.item_code)}
                              onChange={(opt) => setItemMappings((p) => p.map((row, idx) => idx === i ? { ...row, item_code: opt?.code || "" } : row))}
                              placeholder="Selecione item SAP..." />
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" onClick={() => removeItemRow(i)} className="text-destructive hover:text-destructive">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </motion.div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
