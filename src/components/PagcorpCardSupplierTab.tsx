import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Save, Trash2, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type SapSearchOption } from "@/components/SapSearchCombobox";
import { CachedSearchCombobox } from "@/components/CachedSearchCombobox";
import { useMergedSupplierOptions } from "@/hooks/useMergedSupplierOptions";
import { toast } from "sonner";

interface CacheLike {
  options: SapSearchOption[];
  isLoading: boolean;
}

interface Rule {
  id?: string;
  card_identifier: string;
  card_label: string | null;
  supplier_code: string;
  supplier_name: string | null;
  cost_center: string | null;
  project: string | null;
  item_code: string | null;
  account_code: string | null;
  is_active: boolean;
  _key: string;
  _dirty?: boolean;
}

interface Props {
  companyDb: string;
  cardSuggestions: { identifier: string; label: string }[];
  costCenterCache: CacheLike;
  projectCache: CacheLike;
  itemCache: CacheLike;
  accountCache: CacheLike;
}

const opt = (options: SapSearchOption[], code: string | null, label?: string | null): SapSearchOption | null =>
  code ? options.find((o) => o.code === code) || { code, name: label || code, extra: "" } : null;

async function call(payload: Record<string, unknown>) {
  const { sapFunctionFetch } = await import("@/lib/auth-fetch");
  const res = await sapFunctionFetch("pagcorp-card-mapping", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok || result.success === false) throw new Error(result.error || `Erro ${res.status}`);
  return result;
}

export function PagcorpCardSupplierTab({ companyDb, cardSuggestions, costCenterCache, projectCache, itemCache, accountCache }: Props) {
  const { options: supplierOptions, isLoading: loadingSuppliers } = useMergedSupplierOptions({ companyDb });
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyDb) return;
    setLoading(true);
    setError(null);
    try {
      const r = await call({ action: "list-card-supplier", company_db: companyDb });
      setRules(((r.rules as Omit<Rule, "_key">[]) || []).map((x) => ({ ...x, _key: x.id || crypto.randomUUID() })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [companyDb]);

  useEffect(() => {
    void load();
  }, [load]);

  const cardOptions = useMemo<SapSearchOption[]>(
    () => cardSuggestions.map((c) => ({ code: c.identifier, name: c.label, extra: c.identifier })),
    [cardSuggestions],
  );

  const update = (key: string, patch: Partial<Rule>) =>
    setRules((rs) => rs.map((r) => (r._key === key ? { ...r, ...patch, _dirty: true } : r)));

  const add = () =>
    setRules((rs) => [
      {
        _key: crypto.randomUUID(), _dirty: true, card_identifier: "", card_label: null, supplier_code: "", supplier_name: null,
        cost_center: null, project: null, item_code: null, account_code: null, is_active: true,
      },
      ...rs,
    ]);

  const save = async (r: Rule) => {
    if (!r.card_identifier || !r.supplier_code) {
      toast.error("Selecione o cartão e o fornecedor");
      return;
    }
    setSavingKey(r._key);
    try {
      const { _key, _dirty, ...rule } = r;
      void _key; void _dirty;
      const res = await call({ action: "save-card-supplier", company_db: companyDb, rule });
      setRules((rs) => rs.map((x) => (x._key === r._key ? { ...(res.rule as Rule), _key: r._key } : x)));
      toast.success("Regra salva");
    } catch (e) {
      toast.error("Falha ao salvar", { description: e instanceof Error ? e.message : "Erro" });
    } finally {
      setSavingKey(null);
    }
  };

  const remove = async (r: Rule) => {
    if (!r.id) {
      setRules((rs) => rs.filter((x) => x._key !== r._key));
      return;
    }
    if (!confirm("Remover esta regra?")) return;
    try {
      await call({ action: "delete-card-supplier", company_db: companyDb, id: r.id });
      setRules((rs) => rs.filter((x) => x._key !== r._key));
      toast.success("Regra removida");
    } catch (e) {
      toast.error("Falha ao remover", { description: e instanceof Error ? e.message : "Erro" });
    }
  };

  if (!companyDb) {
    return <p className="text-center py-16 text-muted-foreground">Selecione uma empresa.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Quando uma transação do <strong>cartão</strong> tiver o <strong>fornecedor</strong> indicado, aplica
          Centro de Custo, Projeto, Item (Pedido de Compra) e Conta Contábil (LCM). Campos vazios seguem o
          mapeamento do cartão e, depois, o fallback da empresa.
        </p>
        <Button onClick={add} className="gap-2 shrink-0">
          <Plus className="w-4 h-4" /> Nova regra
        </Button>
      </div>

      <div className="glass-card overflow-x-auto">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : error ? (
          <div className="text-center py-12 space-y-3">
            <p className="text-destructive text-sm">{error}</p>
            <Button variant="outline" size="sm" onClick={load}>Tentar novamente</Button>
          </div>
        ) : rules.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Link2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Nenhuma regra cartão + fornecedor</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[180px]">Cartão</TableHead>
                <TableHead className="min-w-[200px]">Fornecedor</TableHead>
                <TableHead className="min-w-[160px]">Centro de Custo</TableHead>
                <TableHead className="min-w-[160px]">Projeto</TableHead>
                <TableHead className="min-w-[160px]">Item</TableHead>
                <TableHead className="min-w-[160px]">Conta Contábil</TableHead>
                <TableHead>Ativa</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((r) => (
                <TableRow key={r._key}>
                  <TableCell>
                    <CachedSearchCombobox
                      options={cardOptions}
                      isLoading={false}
                      value={opt(cardOptions, r.card_identifier || null, r.card_label)}
                      onChange={(o) => update(r._key, { card_identifier: o?.code || "", card_label: o?.name || null })}
                      placeholder="Cartão…"
                    />
                  </TableCell>
                  <TableCell>
                    <CachedSearchCombobox
                      options={supplierOptions}
                      isLoading={loadingSuppliers}
                      value={opt(supplierOptions, r.supplier_code || null, r.supplier_name)}
                      onChange={(o) => update(r._key, { supplier_code: o?.code || "", supplier_name: o?.name || null })}
                      placeholder="Fornecedor…"
                    />
                  </TableCell>
                  <TableCell>
                    <CachedSearchCombobox options={costCenterCache.options} isLoading={costCenterCache.isLoading}
                      value={opt(costCenterCache.options, r.cost_center)} onChange={(o) => update(r._key, { cost_center: o?.code || null })} placeholder="CC…" />
                  </TableCell>
                  <TableCell>
                    <CachedSearchCombobox options={projectCache.options} isLoading={projectCache.isLoading}
                      value={opt(projectCache.options, r.project)} onChange={(o) => update(r._key, { project: o?.code || null })} placeholder="Projeto…" />
                  </TableCell>
                  <TableCell>
                    <CachedSearchCombobox options={itemCache.options} isLoading={itemCache.isLoading}
                      value={opt(itemCache.options, r.item_code)} onChange={(o) => update(r._key, { item_code: o?.code || null })} placeholder="Item…" />
                  </TableCell>
                  <TableCell>
                    <CachedSearchCombobox options={accountCache.options} isLoading={accountCache.isLoading}
                      value={opt(accountCache.options, r.account_code)} onChange={(o) => update(r._key, { account_code: o?.code || null })} placeholder="Conta…" />
                  </TableCell>
                  <TableCell>
                    <Switch checked={r.is_active} onCheckedChange={(v) => update(r._key, { is_active: v })} aria-label="Regra ativa" />
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button variant="ghost" size="icon" aria-label="Salvar regra" disabled={!r._dirty || savingKey === r._key} onClick={() => save(r)}>
                      {savingKey === r._key ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="Remover regra" onClick={() => remove(r)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
