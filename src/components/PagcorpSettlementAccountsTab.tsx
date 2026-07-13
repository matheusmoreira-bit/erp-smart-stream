import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { CachedSearchCombobox } from "@/components/CachedSearchCombobox";
import type { SapSearchOption } from "@/components/SapSearchCombobox";
import { usePagcorpSettlementAccounts, type PagcorpSettlementAccount } from "@/hooks/usePagcorpSettlementAccounts";

interface CacheLike {
  options: SapSearchOption[];
  isLoading: boolean;
}

interface Props {
  companyDb: string;
  accountCache?: CacheLike;
  costCenterCache?: CacheLike;
  projectCache?: CacheLike;
}

type Draft = Partial<PagcorpSettlementAccount> & { _key: string };

/**
 * Classificações de evento retornadas pela API do PagCorp para as quais
 * mapeamos uma conta contábil de baixa distinta.
 *   • "Compra Nacional"                                   → Conta Real (BRL)
 *   • "Compra Internacional"                              → Conta Real (BRL)
 *   • "Compra Internacional  - Saldo Dolar Utilizado"     → Conta Dólar (USD)
 * O valor "__any" corresponde ao fallback (qualquer evento).
 */
const EVENT_CLASSIFICATION_OPTIONS: Array<{ value: string; label: string; currency: string | null }> = [
  { value: "Compra Nacional", label: "Compra Nacional (Conta Real)", currency: "BRL" },
  { value: "Compra Internacional", label: "Compra Internacional (Conta Real)", currency: "BRL" },
  { value: "Compra Internacional  - Saldo Dolar Utilizado", label: "Compra Internacional – Saldo Dólar Utilizado (Conta Dólar)", currency: "USD" },
  { value: "__any", label: "Qualquer classificação (fallback)", currency: null },
];

const EMPTY_CACHE: CacheLike = { options: [], isLoading: false };

function findOption(options: SapSearchOption[], code: string | null | undefined): SapSearchOption | null {
  if (!code) return null;
  return options.find((o) => o.code === code) || { code, name: code, extra: "" };
}

export function PagcorpSettlementAccountsTab({
  companyDb,
  accountCache = EMPTY_CACHE,
  costCenterCache = EMPTY_CACHE,
  projectCache = EMPTY_CACHE,
}: Props) {
  const { items, loading, upsert, remove } = usePagcorpSettlementAccounts(companyDb || undefined);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  if (!companyDb) {
    return (
      <p className="text-sm text-muted-foreground">
        Faça login em uma empresa SAP para configurar a conta contábil de baixa PagCorp.
      </p>
    );
  }

  // A conta de baixa independe do cartão — mostra só linhas sem card_identifier.
  const rows = items.filter((r) => !r.card_identifier);

  async function save(row: PagcorpSettlementAccount | Draft) {
    if (!row.settlement_account_code) {
      toast.error("Informe a conta contábil.");
      return;
    }
    setSavingId((row as PagcorpSettlementAccount).id ?? "new");
    try {
      // Deriva a moeda a partir da classificação (mantém compat. com watcher).
      const classification = row.event_classification ?? null;
      const derivedCurrency =
        EVENT_CLASSIFICATION_OPTIONS.find((o) => o.value === classification)?.currency ?? row.currency ?? null;
      await upsert({
        id: (row as PagcorpSettlementAccount).id,
        company_db: companyDb,
        card_identifier: null,
        currency: derivedCurrency,
        event_classification: classification,
        settlement_account_code: row.settlement_account_code,
        cost_center: row.cost_center ?? null,
        project: row.project ?? null,
        enabled: row.enabled ?? true,
      });
      setDraft(null);
      toast.success("Conta de baixa salva.");
    } catch (e) {
      toast.error(`Falha: ${(e as Error).message}`);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            Contas contábeis do PagCorp usadas na baixa automática (pagamento de fornecedor) após a NF de entrada ser lançada.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            A conta é escolhida pela <strong>classificação do evento</strong> retornada pelo PagCorp:
            <br />
            • <code>Compra Internacional</code> → <strong>Conta Real</strong>
            <br />
            • <code>Compra Internacional&nbsp;&nbsp;- Saldo Dolar Utilizado</code> → <strong>Conta Dólar</strong>
            <br />
            Empresa atual: <strong>{companyDb}</strong>
          </p>
        </div>
        <Button
          size="sm"
          onClick={() =>
            setDraft({
              _key: `new-${Date.now()}`,
              company_db: companyDb,
              enabled: true,
              event_classification: "Compra Internacional",
              currency: "BRL",
            })
          }
          disabled={!!draft}
          className="gap-2 shrink-0"
        >
          <Plus className="w-4 h-4" /> Nova conta
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
        </div>
      ) : (
        <div className="rounded-md border overflow-visible">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-80">Classificação do Evento</TableHead>
                <TableHead>Conta contábil</TableHead>
                <TableHead>Centro de Custo</TableHead>
                <TableHead>Projeto</TableHead>
                <TableHead className="w-20">Ativo</TableHead>
                <TableHead className="w-32 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {draft && (
                <EditableRow
                  key={draft._key}
                  row={draft}
                  onChange={setDraft as (r: Draft) => void}
                  onSave={() => save(draft)}
                  onCancel={() => setDraft(null)}
                  saving={savingId === "new"}
                  accountCache={accountCache}
                  costCenterCache={costCenterCache}
                  projectCache={projectCache}
                />
              )}
              {rows.length === 0 && !draft ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-10">
                    Nenhuma conta contábil de baixa cadastrada.<br />
                    <span className="text-xs">Clique em <strong>Nova conta</strong> para começar.</span>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <EditableExistingRow
                    key={r.id}
                    row={r}
                    saving={savingId === r.id}
                    onSave={(next) => save(next)}
                    onDelete={async () => {
                      if (!confirm("Excluir esta conta de baixa?")) return;
                      try {
                        await remove(r.id);
                        toast.success("Removida.");
                      } catch (e) {
                        toast.error((e as Error).message);
                      }
                    }}
                    accountCache={accountCache}
                    costCenterCache={costCenterCache}
                    projectCache={projectCache}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function EventClassificationSelect({
  value,
  onChange,
}: {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
}) {
  const selValue = value ?? "__any";
  return (
    <Select value={selValue} onValueChange={(v) => onChange(v === "__any" ? null : v)}>
      <SelectTrigger className="h-9">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {EVENT_CLASSIFICATION_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AccountPicker({
  value,
  onChange,
  cache,
  placeholder,
  required,
}: {
  value: string | null | undefined;
  onChange: (code: string) => void;
  cache: CacheLike;
  placeholder: string;
  required?: boolean;
}) {
  if (!cache.options.length && !cache.isLoading) {
    return (
      <Input
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <CachedSearchCombobox
      options={cache.options}
      isLoading={cache.isLoading}
      value={findOption(cache.options, value ?? "")}
      onChange={(opt) => onChange(opt?.code || "")}
      placeholder={placeholder}
      required={required}
    />
  );
}

function EditableRow({
  row,
  onChange,
  onSave,
  onCancel,
  saving,
  accountCache,
  costCenterCache,
  projectCache,
}: {
  row: Draft;
  onChange: (r: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  accountCache: CacheLike;
  costCenterCache: CacheLike;
  projectCache: CacheLike;
}) {
  return (
    <TableRow>
      <TableCell>
        <EventClassificationSelect
          value={row.event_classification ?? null}
          onChange={(v) => onChange({ ...row, event_classification: v })}
        />
      </TableCell>
      <TableCell>
        <AccountPicker
          value={row.settlement_account_code}
          onChange={(v) => onChange({ ...row, settlement_account_code: v })}
          cache={accountCache}
          placeholder="Selecione a conta contábil…"
          required
        />
      </TableCell>
      <TableCell>
        <AccountPicker
          value={row.cost_center}
          onChange={(v) => onChange({ ...row, cost_center: v || null })}
          cache={costCenterCache}
          placeholder="Opcional"
        />
      </TableCell>
      <TableCell>
        <AccountPicker
          value={row.project}
          onChange={(v) => onChange({ ...row, project: v || null })}
          cache={projectCache}
          placeholder="Opcional"
        />
      </TableCell>
      <TableCell>
        <Switch checked={row.enabled ?? true} onCheckedChange={(v) => onChange({ ...row, enabled: v })} />
      </TableCell>
      <TableCell className="text-right space-x-1">
        <Button size="sm" variant="outline" onClick={onCancel} disabled={saving}>Cancelar</Button>
        <Button size="sm" onClick={onSave} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        </Button>
      </TableCell>
    </TableRow>
  );
}

function EditableExistingRow({
  row,
  saving,
  onSave,
  onDelete,
  accountCache,
  costCenterCache,
  projectCache,
}: {
  row: PagcorpSettlementAccount;
  saving: boolean;
  onSave: (r: PagcorpSettlementAccount) => void;
  onDelete: () => void;
  accountCache: CacheLike;
  costCenterCache: CacheLike;
  projectCache: CacheLike;
}) {
  const [local, setLocal] = useState<PagcorpSettlementAccount>(row);
  const dirty =
    local.settlement_account_code !== row.settlement_account_code ||
    (local.event_classification || null) !== (row.event_classification || null) ||
    (local.cost_center || null) !== (row.cost_center || null) ||
    (local.project || null) !== (row.project || null) ||
    local.enabled !== row.enabled;

  return (
    <TableRow>
      <TableCell>
        <EventClassificationSelect
          value={local.event_classification}
          onChange={(v) => setLocal({ ...local, event_classification: v })}
        />
        {!local.event_classification && !local.currency && (
          <div className="mt-1"><Badge variant="outline">Fallback (qualquer evento)</Badge></div>
        )}
        {!local.event_classification && local.currency && (
          <div className="mt-1"><Badge variant="outline">Legado: moeda {local.currency}</Badge></div>
        )}
      </TableCell>
      <TableCell>
        <AccountPicker
          value={local.settlement_account_code}
          onChange={(v) => setLocal({ ...local, settlement_account_code: v })}
          cache={accountCache}
          placeholder="Selecione a conta contábil…"
          required
        />
      </TableCell>
      <TableCell>
        <AccountPicker
          value={local.cost_center}
          onChange={(v) => setLocal({ ...local, cost_center: v || null })}
          cache={costCenterCache}
          placeholder="Opcional"
        />
      </TableCell>
      <TableCell>
        <AccountPicker
          value={local.project}
          onChange={(v) => setLocal({ ...local, project: v || null })}
          cache={projectCache}
          placeholder="Opcional"
        />
      </TableCell>
      <TableCell>
        <Switch checked={local.enabled} onCheckedChange={(v) => setLocal({ ...local, enabled: v })} />
      </TableCell>
      <TableCell className="text-right space-x-1">
        <Button size="sm" variant="outline" onClick={onDelete} disabled={saving}>
          <Trash2 className="w-4 h-4" />
        </Button>
        <Button size="sm" onClick={() => onSave(local)} disabled={saving || !dirty}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        </Button>
      </TableCell>
    </TableRow>
  );
}
