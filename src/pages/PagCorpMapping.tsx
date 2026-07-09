import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Plus,
  Save,
  Trash2,
  Loader2,
  MapPin,
  CreditCard,
  Banknote,
} from "lucide-react";
import { Button } from "@/components/ui/button";

import { ThemeToggle } from "@/components/ThemeToggle";
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
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CachedSearchCombobox } from "@/components/CachedSearchCombobox";
import { useSapCachedList } from "@/hooks/useSapCachedList";
import { usePagCorp } from "@/hooks/usePagCorp";
import { useSap } from "@/contexts/SapContext";
import type { SapSearchOption } from "@/components/SapSearchCombobox";
import { PageTitle } from "@/components/PageTitle";
import { PagcorpSettlementAccountsTab } from "@/components/PagcorpSettlementAccountsTab";

/* ── Account → Cost Center / Project mapping ── */
interface AccountMapping {
  id?: string;
  account_code: string;
  account_name: string;
  cost_center: string;
  project: string;
  isNew?: boolean;
}


/* ── Card → defaults mapping ── */
interface CardMappingRow {
  id?: string;
  company_db: string;
  card_identifier: string;
  card_label: string;
  cost_center: string;
  project: string;
  item_code: string;
  is_fallback: boolean;
  isNew?: boolean;
}

export default function PagCorpMapping() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { session } = useSap();
  const companyDB = session?.companyDB || "";

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
    cacheKey: "items_active_v2",
    endpoint: "Items",
    params: {
      $filter: "Valid eq 'tYES' and Frozen eq 'tNO'",
      $select: "ItemCode,ItemName",
    },
    mapRow: (r: any) => ({ code: r.ItemCode, name: r.ItemName, extra: "" }),
  });

  /* ── PagCorp account suggestions ── */
  const { transactions: recentTransactions, fetchTransactions } = usePagCorp();
  useEffect(() => {
    const today = new Date();
    const ago = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 180);
    fetchTransactions(
      ago.toISOString().slice(0, 10),
      today.toISOString().slice(0, 10),
      companyDB || undefined,
    );
  }, [companyDB]);

  const accountCodeOptions: SapSearchOption[] = useMemo(() => {
    const map = new Map<string, string>();
    recentTransactions.forEach((t) => {
      const code = t.accountCode || "";
      const name = t.accountName || "";
      if (code && !map.has(code)) map.set(code, name);
    });
    return Array.from(map.entries()).map(([code, name]) => ({ code, name, extra: "" }));
  }, [recentTransactions]);

  /* Cartões já catalogados em banco (alimentados a cada busca de transações) */
  const [dbCards, setDbCards] = useState<{ identifier: string; label: string }[]>([]);
  useEffect(() => {
    if (!companyDB) { setDbCards([]); return; }
    let cancelled = false;
    (async () => {
      const { sapFunctionFetch } = await import("@/lib/auth-fetch");
      const res = await sapFunctionFetch("pagcorp-card-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", company_db: companyDB }),
      });
      const result = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok || result.success === false) {
        console.warn("PagCorp card catalog load failed:", result.error || res.status);
        setDbCards([]);
        return;
      }
      setDbCards(((result.cards as any[]) || []).map((r) => {
        const label = r.card_label || [r.card_name, r.card_last_digits ? `•••• ${r.card_last_digits}` : null]
          .filter(Boolean).join(" ") || r.card_identifier;
        return { identifier: r.card_identifier, label };
      }));
    })();
    return () => { cancelled = true; };
  }, [companyDB]);

  /* Card identifiers detected in recent transactions, merged with DB catalog */
  const cardSuggestions = useMemo(() => {
    const map = new Map<string, { identifier: string; label: string }>();
    dbCards.forEach((c) => map.set(c.identifier, c));
    recentTransactions.forEach((t) => {
      const id = (t.cardLastDigits && String(t.cardLastDigits).trim()) ||
        (t.cardId && String(t.cardId).trim()) ||
        (t.cardName && String(t.cardName).trim()) || "";
      if (!id || map.has(id)) return;
      const label = [t.cardName || t.accountAlias || t.accountName, t.cardLastDigits ? `•••• ${t.cardLastDigits}` : t.cardId ? `ID ${t.cardId}` : null]
        .filter(Boolean).join(" ");
      map.set(id, { identifier: id, label: label || id });
    });
    return Array.from(map.values());
  }, [recentTransactions, dbCards]);


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
     TAB 3 – Card → defaults mapping
     ════════════════════════════════════════════ */
  const [cardMappings, setCardMappings] = useState<CardMappingRow[]>([]);
  const [isLoadingCards, setIsLoadingCards] = useState(true);
  const [isSavingCards, setIsSavingCards] = useState(false);

  useEffect(() => {
    if (!companyDB) {
      setCardMappings([]);
      setIsLoadingCards(false);
      return;
    }
    loadCardMappings();
  }, [companyDB]);

  async function loadCardMappings() {
    setIsLoadingCards(true);
    try {
      const { sapFunctionFetch } = await import("@/lib/auth-fetch");
      const res = await sapFunctionFetch("pagcorp-card-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list-mappings", company_db: companyDB }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || result.success === false) {
        toast.error(result.error || "Erro ao carregar mapeamento de cartões");
      } else {
        setCardMappings((result.mappings || []).map((r: any) => ({
          id: r.id, company_db: r.company_db,
          card_identifier: r.card_identifier || "",
          card_label: r.card_label || "",
          cost_center: r.cost_center || "",
          project: r.project || "",
          item_code: r.item_code || "",
          is_fallback: !!r.is_fallback,
        })));
      }
    } catch (e: any) {
      toast.error(e?.message || "Erro ao carregar mapeamento de cartões");
    } finally {
      setIsLoadingCards(false);
    }
  }

  // Pré-cria uma linha nova quando vindo de "Abrir mapeamento" (?card=)
  // — só dispara após o load terminar e se ainda não existir mapeamento.
  useEffect(() => {
    const cardParam = searchParams.get("card");
    if (!cardParam || !companyDB || isLoadingCards) return;
    const already = cardMappings.some(
      (m) => !m.is_fallback && m.card_identifier === cardParam,
    );
    const pendingNew = cardMappings.some(
      (m) => m.isNew && !m.is_fallback && m.card_identifier === cardParam,
    );
    if (!already && !pendingNew) {
      const match = cardSuggestions.find((c) => c.identifier === cardParam);
      setCardMappings((p) => [
        {
          company_db: companyDB,
          card_identifier: cardParam,
          card_label: match?.label || cardParam,
          cost_center: "",
          project: "",
          item_code: "",
          is_fallback: false,
          isNew: true,
        },
        ...p,
      ]);
      toast.info(`Novo mapeamento iniciado para o cartão ${match?.label || cardParam}`);
    }
    // Limpa o query param para não recriar em re-renders / navegação
    const next = new URLSearchParams(searchParams);
    next.delete("card");
    setSearchParams(next, { replace: true });
  }, [searchParams, companyDB, isLoadingCards, cardMappings, cardSuggestions, setSearchParams]);

  function addCardRow() {
    setCardMappings((p) => [...p, {
      company_db: companyDB, card_identifier: "", card_label: "",
      cost_center: "", project: "", item_code: "", is_fallback: false, isNew: true,
    }]);
  }

  function addCardFallback() {
    setCardMappings((p) => [{
      company_db: companyDB, card_identifier: "", card_label: "Fallback (padrão da empresa)",
      cost_center: "", project: "", item_code: "", is_fallback: true, isNew: true,
    }, ...p]);
  }

  function updateCardRow(i: number, patch: Partial<CardMappingRow>) {
    setCardMappings((p) => p.map((m, idx) => idx === i ? { ...m, ...patch } : m));
  }

  function removeCardRow(i: number) {
    const m = cardMappings[i];
    if (m.id) deleteCardRow(m.id, i);
    else setCardMappings((p) => p.filter((_, idx) => idx !== i));
  }

  async function deleteCardRow(id: string, i: number) {
    const { sapFunctionFetch } = await import("@/lib/auth-fetch");
    const res = await sapFunctionFetch("pagcorp-card-mapping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || result.success === false) {
      toast.error(result.error || "Erro ao excluir");
      return;
    }
    setCardMappings((p) => p.filter((_, idx) => idx !== i));
    toast.success("Excluído");
  }

  async function saveCardMappings() {
    if (!companyDB) { toast.error("Selecione uma empresa antes de salvar"); return; }
    setIsSavingCards(true);
    try {
      const rows = cardMappings
        .filter((m) => m.is_fallback || m.card_identifier)
        .map((m) => ({
          id: m.id,
          company_db: companyDB,
          card_identifier: m.is_fallback ? null : m.card_identifier,
          card_label: m.card_label || null,
          cost_center: m.cost_center || null,
          project: m.project || null,
          item_code: m.item_code || null,
          is_fallback: m.is_fallback,
        }));
      if (rows.length === 0) { toast.error("Preencha ao menos um cartão"); return; }
      const { sapFunctionFetch } = await import("@/lib/auth-fetch");
      const res = await sapFunctionFetch("pagcorp-card-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", rows }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || result.success === false) throw new Error(result.error || `Erro ${res.status}`);
      toast.success("Mapeamento de cartões salvo");
      loadCardMappings();
    } catch (e: any) { toast.error(e.message || "Erro ao salvar"); }
    finally { setIsSavingCards(false); }

  }

  const hasCardFallback = cardMappings.some((m) => m.is_fallback);


  /* ── helpers ── */
  function findOption(options: SapSearchOption[], code: string): SapSearchOption | null {
    if (!code) return null;
    return options.find((o) => o.code === code) || null;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <PageTitle title="Mapeamento de Cartões" />
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/cartoes/transacoes")} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="p-2 rounded-lg bg-primary/10">
            <MapPin className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">
              Mapeamento de Cartões <span className="text-gradient">→ SAP</span>
            </h1>
            <p className="text-xs text-muted-foreground">Configure centro de custo, projeto e itens genéricos</p>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 px-6 py-6">
        <div className="max-w-7xl mx-auto">
          <Tabs defaultValue="cards" className="space-y-4">
            <TabsList>
              <TabsTrigger value="cards" className="gap-2"><CreditCard className="w-4 h-4" /> Cartões</TabsTrigger>
            </TabsList>



            <TabsContent value="cards" className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm text-muted-foreground">
                  Defina o centro de custo, projeto e item <strong>padrão</strong> por cartão.
                  O <Badge variant="secondary">Fallback</Badge> é o padrão da empresa quando o cartão não está mapeado
                  (ex.: fixar o projeto <em>ANA GAMING</em> em todas as compras de cartão).
                  Empresa atual: <strong>{companyDB || "(nenhuma selecionada)"}</strong>
                </p>
                <div className="flex gap-2 shrink-0">
                  {!hasCardFallback && companyDB && (
                    <Button variant="outline" onClick={addCardFallback} className="gap-2">
                      <Plus className="w-4 h-4" /> Fallback
                    </Button>
                  )}
                  <Button variant="outline" onClick={addCardRow} disabled={!companyDB} className="gap-2">
                    <Plus className="w-4 h-4" /> Adicionar
                  </Button>
                  <Button onClick={saveCardMappings} disabled={isSavingCards || !companyDB} className="gap-2">
                    {isSavingCards ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
                  </Button>
                </div>
              </div>

              {!companyDB ? (
                <div className="text-center py-20 text-muted-foreground">
                  <CreditCard className="w-12 h-12 mx-auto mb-4 opacity-30" />
                  <p className="text-lg font-medium">Selecione uma empresa</p>
                  <p className="text-sm mt-1">O mapeamento de cartões é por empresa.</p>
                </div>
              ) : isLoadingCards ? (
                <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
              ) : cardMappings.length === 0 ? (
                <div className="text-center py-20 text-muted-foreground">
                  <CreditCard className="w-12 h-12 mx-auto mb-4 opacity-30" />
                  <p className="text-lg font-medium">Nenhum cartão mapeado</p>
                  <Button onClick={addCardRow} variant="outline" className="mt-4 gap-2">
                    <Plus className="w-4 h-4" /> Adicionar
                  </Button>
                </div>
              ) : (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card overflow-visible">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border hover:bg-transparent">
                        <TableHead className="text-muted-foreground">Cartão</TableHead>
                        <TableHead className="text-muted-foreground">Centro de Custo</TableHead>
                        <TableHead className="text-muted-foreground">Projeto</TableHead>
                        <TableHead className="text-muted-foreground">Item Padrão</TableHead>
                        <TableHead className="text-muted-foreground w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cardMappings.map((m, i) => {
                        const cardOptions: SapSearchOption[] = cardSuggestions.map((c) => ({
                          code: c.identifier, name: c.label, extra: "",
                        }));
                        return (
                          <TableRow key={m.id || `new-card-${i}`} className="border-border">
                            <TableCell>
                              {m.is_fallback ? (
                                <Badge variant="secondary" className="text-sm">Fallback (padrão da empresa)</Badge>
                              ) : m.id ? (
                                <div className="text-sm">
                                  <span className="font-medium text-foreground">{m.card_label || m.card_identifier}</span>
                                  {m.card_label && (
                                    <span className="ml-2 text-xs text-muted-foreground">{m.card_identifier}</span>
                                  )}
                                </div>
                              ) : (
                                <>
                                  <CachedSearchCombobox
                                    options={cardSuggestions.map((c) => ({ code: c.identifier, name: c.label, extra: "" }))}
                                    isLoading={false}
                                    value={
                                      m.card_identifier
                                        ? { code: m.card_identifier, name: m.card_label || m.card_identifier, extra: "" }
                                        : null
                                    }
                                    onChange={(opt) => {
                                      const match = cardSuggestions.find((c) => c.identifier === opt?.code);
                                      updateCardRow(i, {
                                        card_identifier: opt?.code || "",
                                        card_label: match?.label || opt?.name || "",
                                      });
                                    }}
                                    placeholder={
                                      cardSuggestions.length === 0
                                        ? "Nenhum cartão catalogado — busque transações primeiro"
                                        : "Selecione o cartão…"
                                    }
                                  />
                                  {cardSuggestions.length === 0 && (
                                    <p className="mt-1 text-[11px] text-muted-foreground">
                                      Abra "Transações PagCorp", faça uma busca, e os cartões aparecerão aqui automaticamente.
                                    </p>
                                  )}
                                </>
                              )}
                            </TableCell>

                            <TableCell>
                              {m.id ? (
                                <div className="text-sm font-medium text-foreground">
                                  {m.cost_center || <span className="text-muted-foreground italic">—</span>}
                                </div>
                              ) : (
                                <CachedSearchCombobox
                                  options={costCenterCache.options}
                                  isLoading={costCenterCache.isLoading}
                                  value={findOption(costCenterCache.options, m.cost_center)}
                                  onChange={(opt) => updateCardRow(i, { cost_center: opt?.code || "" })}
                                  placeholder="Selecione…"
                                />
                              )}
                            </TableCell>
                            <TableCell>
                              {m.id ? (
                                <div className="text-sm font-medium text-foreground">
                                  {m.project || <span className="text-muted-foreground italic">—</span>}
                                </div>
                              ) : (
                                <CachedSearchCombobox
                                  options={projectCache.options}
                                  isLoading={projectCache.isLoading}
                                  value={findOption(projectCache.options, m.project)}
                                  onChange={(opt) => updateCardRow(i, { project: opt?.code || "" })}
                                  placeholder="Selecione…"
                                />
                              )}
                            </TableCell>
                            <TableCell>
                              {m.id ? (
                                <div className="text-sm font-medium text-foreground">
                                  {m.item_code || <span className="text-muted-foreground italic">—</span>}
                                </div>
                              ) : (
                                <CachedSearchCombobox
                                  options={itemCache.options}
                                  isLoading={itemCache.isLoading}
                                  value={findOption(itemCache.options, m.item_code)}
                                  onChange={(opt) => updateCardRow(i, { item_code: opt?.code || "" })}
                                  placeholder="Selecione item SAP…"
                                />
                              )}
                            </TableCell>
                            <TableCell>
                              <Button variant="ghost" size="icon" onClick={() => removeCardRow(i)} className="text-destructive hover:text-destructive">
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
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
