import { useCallback, useMemo, useState } from "react";
import { Loader2, Plus, RefreshCw, Save, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/EmptyState";
import {
  MAX_BRANDS_PER_CUSTOMER,
  useCustomerBrandMap,
  type CustomerBrandRule,
} from "@/hooks/useCustomerBrandMap";

type Draft = Pick<
  CustomerBrandRule,
  "customer_code" | "customer_name" | "project_code" | "brand" | "to_emails" | "cc_emails" | "is_active"
>;

const emptyDraft = (): Draft => ({
  customer_code: "",
  customer_name: "",
  project_code: "",
  brand: "",
  to_emails: [],
  cc_emails: [],
  is_active: true,
});

const parseEmails = (value: string): string[] =>
  value
    .split(/[;,\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));

/**
 * Manutenção do mapeamento Cliente × Marca (projeto) → destinatários da NFS-e.
 * Time de Contas a Receber (e admins) definem quem recebe a nota de cada marca.
 */
export default function SalesRecipientsTab() {
  const { companyDb, rules, byCustomer, loading, reload } = useCustomerBrandMap();
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [toText, setToText] = useState("");
  const [ccText, setCcText] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const customers = useMemo(() => {
    const term = search.trim().toLowerCase();
    const entries = Array.from(byCustomer.entries());
    if (!term) return entries;
    return entries.filter(
      ([code, list]) =>
        code.toLowerCase().includes(term) ||
        list.some(
          (r) =>
            (r.customer_name || "").toLowerCase().includes(term) ||
            (r.project_code || "").toLowerCase().includes(term) ||
            (r.brand || "").toLowerCase().includes(term),
        ),
    );
  }, [byCustomer, search]);

  const addRule = useCallback(async () => {
    const customer_code = draft.customer_code.trim().toUpperCase();
    const project_code = draft.project_code.trim();
    const to_emails = parseEmails(toText);
    if (!customer_code || !project_code) {
      toast.error("Informe o código do cliente e a marca/projeto.");
      return;
    }
    if (!to_emails.length) {
      toast.error("Informe ao menos um destinatário válido.");
      return;
    }
    const existing = rules.filter(
      (r) => r.customer_code.toUpperCase() === customer_code && r.is_active,
    );
    if (existing.length >= MAX_BRANDS_PER_CUSTOMER) {
      toast.error(`Cada cliente pode ter no máximo ${MAX_BRANDS_PER_CUSTOMER} marcas vinculadas.`);
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("nfse_email_recipients").insert({
      company_db: companyDb,
      customer_code,
      customer_name: draft.customer_name?.trim() || null,
      project_code,
      brand: draft.brand?.trim() || project_code,
      to_emails,
      cc_emails: parseEmails(ccText),
      is_active: true,
      source: "manual",
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setDraft(emptyDraft());
    setToText("");
    setCcText("");
    toast.success("Mapeamento criado.");
    void reload();
  }, [draft, toText, ccText, companyDb, rules, reload]);

  const patchRule = useCallback(
    async (id: string, patch: Partial<CustomerBrandRule>) => {
      const { error } = await supabase.from("nfse_email_recipients").update(patch).eq("id", id);
      if (error) toast.error(error.message);
      else void reload();
    },
    [reload],
  );

  const removeRule = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("nfse_email_recipients").delete().eq("id", id);
      if (error) toast.error(error.message);
      else {
        toast.success("Mapeamento removido.");
        void reload();
      }
    },
    [reload],
  );

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" /> Destinatários por Cliente × Marca
          </h1>
          <p className="text-sm text-muted-foreground">
            Define quem recebe a NFS-e de cada marca. Cada cliente pode ter até{" "}
            {MAX_BRANDS_PER_CUSTOMER} marcas vinculadas.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void reload()} className="gap-1">
          <RefreshCw className="w-4 h-4" /> Atualizar
        </Button>
      </header>

      <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold">Novo vínculo</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">Código do cliente *</Label>
            <Input
              value={draft.customer_code}
              onChange={(e) => setDraft({ ...draft, customer_code: e.target.value })}
              placeholder="C000123"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Nome do cliente</Label>
            <Input
              value={draft.customer_name || ""}
              onChange={(e) => setDraft({ ...draft, customer_name: e.target.value })}
              placeholder="Razão social"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Marca / Projeto *</Label>
            <Input
              value={draft.project_code}
              onChange={(e) => setDraft({ ...draft, project_code: e.target.value })}
              placeholder="Código do projeto no ERP"
            />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs text-muted-foreground">Destinatários (Para) *</Label>
            <Input
              value={toText}
              onChange={(e) => setToText(e.target.value)}
              placeholder="fiscal@cliente.com, financeiro@cliente.com"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Cópia (CC)</Label>
            <Input value={ccText} onChange={(e) => setCcText(e.target.value)} placeholder="opcional" />
          </div>
        </div>
        <Button onClick={() => void addRule()} disabled={saving} className="gap-1">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Adicionar vínculo
        </Button>
      </section>

      <div className="flex items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por cliente, código ou marca…"
          className="max-w-sm"
        />
        <Badge variant="secondary">{rules.length} vínculo(s)</Badge>
      </div>

      {loading ? (
        <div className="p-10 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : customers.length === 0 ? (
        <EmptyState
          icon={<Users className="h-5 w-5" aria-hidden="true" />}
          title="Nenhum mapeamento cadastrado"
          description="Cadastre o primeiro vínculo cliente × marca para direcionar o envio das notas."
        />
      ) : (
        <div className="space-y-4">
          {customers.map(([code, list]) => (
            <section key={code} className="rounded-2xl border border-border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {list[0]?.customer_name || code}
                  </p>
                  <p className="text-[11px] text-muted-foreground font-mono">{code}</p>
                </div>
                <Badge
                  variant={list.filter((r) => r.is_active).length > MAX_BRANDS_PER_CUSTOMER ? "destructive" : "outline"}
                  className="ml-auto text-[10px]"
                >
                  {list.filter((r) => r.is_active).length}/{MAX_BRANDS_PER_CUSTOMER} marcas
                </Badge>
              </div>
              <div className="divide-y divide-border">
                {list.map((r) => (
                  <RuleRow key={r.id} rule={r} onPatch={patchRule} onRemove={removeRule} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function RuleRow({
  rule,
  onPatch,
  onRemove,
}: {
  rule: CustomerBrandRule;
  onPatch: (id: string, patch: Partial<CustomerBrandRule>) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [to, setTo] = useState(rule.to_emails.join(", "));
  const [cc, setCc] = useState(rule.cc_emails.join(", "));
  const dirty = to !== rule.to_emails.join(", ") || cc !== rule.cc_emails.join(", ");

  return (
    <div className="px-4 py-3 grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
      <div className="md:col-span-3">
        <Label className="text-[11px] text-muted-foreground">Marca / Projeto</Label>
        <p className="text-sm font-medium truncate">{rule.brand || rule.project_code}</p>
        <p className="text-[11px] text-muted-foreground font-mono truncate">{rule.project_code}</p>
      </div>
      <div className="md:col-span-4">
        <Label className="text-[11px] text-muted-foreground">Para</Label>
        <Input value={to} onChange={(e) => setTo(e.target.value)} className="h-9" />
      </div>
      <div className="md:col-span-3">
        <Label className="text-[11px] text-muted-foreground">CC</Label>
        <Input value={cc} onChange={(e) => setCc(e.target.value)} className="h-9" />
      </div>
      <div className="md:col-span-2 flex items-center gap-2 justify-end">
        <Switch
          checked={rule.is_active}
          onCheckedChange={(v) => void onPatch(rule.id, { is_active: v })}
          aria-label="Ativo"
        />
        <Button
          size="icon"
          variant="ghost"
          disabled={!dirty}
          aria-label="Salvar destinatários"
          onClick={() =>
            void onPatch(rule.id, {
              to_emails: parseEmails(to),
              cc_emails: parseEmails(cc),
            })
          }
        >
          <Save className="w-4 h-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Remover vínculo"
          onClick={() => void onRemove(rule.id)}
        >
          <Trash2 className="w-4 h-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
}
