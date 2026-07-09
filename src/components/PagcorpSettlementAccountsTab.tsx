import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { toast } from "sonner";
import { usePagcorpSettlementAccounts, type PagcorpSettlementAccount } from "@/hooks/usePagcorpSettlementAccounts";

interface Props {
  companyDb: string;
}

type Draft = Partial<PagcorpSettlementAccount> & { _key: string };

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
            Conta contábil do cartão PagCorp usada na baixa automática (Journal Entry) após a NF de entrada ser lançada.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Deixe o campo <strong>Cartão</strong> em branco para definir o <Badge variant="secondary">Fallback</Badge> da empresa.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setDraft({ _key: `new-${Date.now()}`, company_db: companyDb, enabled: true })}
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
                  isNew
                />
              )}
              {rows.length === 0 && !draft ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
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

function EditableRow({
  row,
  onChange,
  onSave,
  onCancel,
  saving,
  isNew,
}: {
  row: Draft;
  onChange: (r: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  isNew?: boolean;
}) {
  return (
    <TableRow>
      <TableCell>
        <Input
          placeholder="Últimos 4 dígitos ou ID (vazio = fallback)"
          value={row.card_identifier ?? ""}
          onChange={(e) => onChange({ ...row, card_identifier: e.target.value || null })}
        />
      </TableCell>
      <TableCell>
        <Input
          placeholder="Ex.: 2.1.03.001"
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
    (local.cost_center || null) !== (row.cost_center || null) ||
    (local.project || null) !== (row.project || null) ||
    local.enabled !== row.enabled;

  return (
    <TableRow>
      <TableCell>
        {row.card_identifier ? (
          <Input value={local.card_identifier ?? ""} onChange={(e) => setLocal({ ...local, card_identifier: e.target.value || null })} />
        ) : (
          <Badge variant="secondary">Fallback</Badge>
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
