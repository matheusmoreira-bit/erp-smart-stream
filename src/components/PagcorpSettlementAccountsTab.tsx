import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { usePagcorpSettlementAccounts, type PagcorpSettlementAccount } from "@/hooks/usePagcorpSettlementAccounts";

interface Props {
  companyDb: string;
}

type Draft = Partial<PagcorpSettlementAccount> & { _key: string };

const CURRENCY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "BRL", label: "PagCorp Real (BRL)" },
  { value: "USD", label: "PagCorp Dólar (USD)" },
  { value: "__any", label: "Qualquer moeda" },
];

function currencyLabel(cur: string | null | undefined) {
  if (!cur) return "Qualquer moeda";
  if (cur === "BRL") return "PagCorp Real (BRL)";
  if (cur === "USD") return "PagCorp Dólar (USD)";
  return cur;
}

export function PagcorpSettlementAccountsTab({ companyDb }: Props) {
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

  const rows = [...items];

  async function save(row: PagcorpSettlementAccount | Draft) {
    if (!row.settlement_account_code) {
      toast.error("Informe a conta contábil.");
      return;
    }
    setSavingId((row as PagcorpSettlementAccount).id ?? "new");
    try {
      await upsert({
        id: (row as PagcorpSettlementAccount).id,
        company_db: companyDb,
        card_identifier: row.card_identifier ?? null,
        currency: row.currency ?? null,
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
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Contas contábeis do PagCorp usadas na baixa automática (pagamento de fornecedor) após a NF de entrada ser lançada.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Cadastre uma linha para <strong>PagCorp Real (BRL)</strong> e outra para <strong>PagCorp Dólar (USD)</strong> por empresa.
            Deixe <strong>Cartão</strong> vazio para valer como fallback da moeda.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setDraft({ _key: `new-${Date.now()}`, company_db: companyDb, enabled: true, currency: "BRL" })}
          disabled={!!draft}
        >
          <Plus className="w-4 h-4 mr-1" /> Novo
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-56">Moeda</TableHead>
                <TableHead>Cartão</TableHead>
                <TableHead>Conta contábil</TableHead>
                <TableHead>Centro de Custo</TableHead>
                <TableHead>Projeto</TableHead>
                <TableHead className="w-24">Ativo</TableHead>
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
                />
              )}
              {rows.length === 0 && !draft ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                    Nenhuma conta de baixa cadastrada.
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

function CurrencySelect({ value, onChange }: { value: string | null | undefined; onChange: (v: string | null) => void }) {
  const selValue = value ?? "__any";
  return (
    <Select value={selValue} onValueChange={(v) => onChange(v === "__any" ? null : v)}>
      <SelectTrigger className="h-9">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CURRENCY_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function EditableRow({
  row,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  row: Draft;
  onChange: (r: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <TableRow>
      <TableCell>
        <CurrencySelect value={row.currency ?? null} onChange={(v) => onChange({ ...row, currency: v })} />
      </TableCell>
      <TableCell>
        <Input
          placeholder="Últimos 4 dígitos (vazio = fallback)"
          value={row.card_identifier ?? ""}
          onChange={(e) => onChange({ ...row, card_identifier: e.target.value || null })}
        />
      </TableCell>
      <TableCell>
        <Input
          placeholder="Ex.: 1.1.03.001"
          value={row.settlement_account_code ?? ""}
          onChange={(e) => onChange({ ...row, settlement_account_code: e.target.value })}
        />
      </TableCell>
      <TableCell>
        <Input
          placeholder="Opcional"
          value={row.cost_center ?? ""}
          onChange={(e) => onChange({ ...row, cost_center: e.target.value || null })}
        />
      </TableCell>
      <TableCell>
        <Input
          placeholder="Opcional"
          value={row.project ?? ""}
          onChange={(e) => onChange({ ...row, project: e.target.value || null })}
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
}: {
  row: PagcorpSettlementAccount;
  saving: boolean;
  onSave: (r: PagcorpSettlementAccount) => void;
  onDelete: () => void;
}) {
  const [local, setLocal] = useState<PagcorpSettlementAccount>(row);
  const dirty =
    local.settlement_account_code !== row.settlement_account_code ||
    (local.card_identifier || null) !== (row.card_identifier || null) ||
    (local.currency || null) !== (row.currency || null) ||
    (local.cost_center || null) !== (row.cost_center || null) ||
    (local.project || null) !== (row.project || null) ||
    local.enabled !== row.enabled;

  return (
    <TableRow>
      <TableCell>
        <CurrencySelect value={local.currency} onChange={(v) => setLocal({ ...local, currency: v })} />
        {!local.currency && <div className="mt-1"><Badge variant="outline">Sem moeda definida</Badge></div>}
      </TableCell>
      <TableCell>
        {row.card_identifier ? (
          <Input value={local.card_identifier ?? ""} onChange={(e) => setLocal({ ...local, card_identifier: e.target.value || null })} />
        ) : (
          <Badge variant="secondary">Fallback da moeda</Badge>
        )}
      </TableCell>
      <TableCell>
        <Input value={local.settlement_account_code} onChange={(e) => setLocal({ ...local, settlement_account_code: e.target.value })} />
      </TableCell>
      <TableCell>
        <Input value={local.cost_center ?? ""} onChange={(e) => setLocal({ ...local, cost_center: e.target.value || null })} />
      </TableCell>
      <TableCell>
        <Input value={local.project ?? ""} onChange={(e) => setLocal({ ...local, project: e.target.value || null })} />
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

// Re-export helper for potential future use elsewhere.
export { currencyLabel };
