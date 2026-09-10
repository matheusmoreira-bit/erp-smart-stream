import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Bell, Eye, Loader2, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMyCapabilities } from "@/hooks/useMyCapabilities";
import { useSap } from "@/contexts/SapContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

interface SupabaseTableQuery {
  select(columns?: string): SupabaseTableQuery;
  order(column: string, options?: Record<string, unknown>): SupabaseTableQuery;
  limit(count: number): SupabaseTableQuery;
  insert(values: Record<string, unknown> | Record<string, unknown>[]): SupabaseTableQuery;
  update(values: Record<string, unknown>): SupabaseTableQuery;
  delete(): SupabaseTableQuery;
  eq(column: string, value: unknown): SupabaseTableQuery;
  single(): SupabaseTableQuery;
  then<TResult1 = SupabaseQueryResult, TResult2 = never>(
    onfulfilled?: ((value: SupabaseQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

interface SupabaseQueryResult {
  data: unknown;
  error: { message: string } | null;
}

const db = supabase as unknown as {
  from(table: string): SupabaseTableQuery;
};

const CHANNELS = [
  { key: "in_app", label: "In-App" },
  { key: "email", label: "E-mail" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "sms", label: "SMS" },
  { key: "webhook", label: "Webhook" },
  { key: "slack", label: "Slack" },
];

const RECIPIENT_TYPES = [
  { key: "approver", label: "Aprovador do payload" },
  { key: "requester", label: "Solicitante do payload" },
  { key: "supplier", label: "Fornecedor do payload" },
  { key: "fixed_user", label: "Usuário fixo" },
  { key: "fixed_email", label: "E-mail fixo" },
  { key: "custom_phone", label: "Telefone fixo" },
  { key: "role", label: "Papel" },
  { key: "department", label: "Departamento" },
  { key: "expression", label: "Campo do payload" },
];

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  channel: string;
  subject_template: string | null;
  body_template: string;
  html_template: string | null;
  variables_schema: Record<string, unknown>;
  active: boolean;
  version: number;
  updated_at: string;
}

interface TriggerRow {
  id: string;
  name: string;
  event_key: string;
  source_module: string | null;
  description: string | null;
  company_db: string | null;
  active: boolean;
  debounce_seconds: number;
  conditions_json: Record<string, unknown>;
  updated_at: string;
}

interface RuleRow {
  id: string;
  trigger_id: string;
  template_id: string;
  name: string;
  channel: string;
  priority: number;
  active: boolean;
  recipient_strategy: string;
  conditions_json: Record<string, unknown>;
  updated_at: string;
}

interface RecipientRow {
  id: string;
  rule_id: string;
  recipient_type: string;
  value: string | null;
  active: boolean;
}

interface DispatchRecipient {
  id: string;
  recipient_name: string | null;
  recipient_email: string | null;
  recipient_phone: string | null;
  channel_address: string | null;
  recipient_type: string | null;
  status: string;
  sent_at: string | null;
  error_message: string | null;
}

interface DispatchRow {
  id: string;
  event_key: string;
  source_module: string | null;
  source_entity_type: string | null;
  source_entity_id: string | null;
  company_db: string | null;
  channel: string;
  status: string;
  scheduled_at: string;
  sent_at: string | null;
  error_message: string | null;
  rendered_subject: string | null;
  rendered_body: string | null;
  rendered_html: string | null;
  payload_snapshot: Record<string, unknown>;
  template_version: number | null;
  created_at: string;
  notification_dispatch_recipients?: DispatchRecipient[];
}

function formatJson(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function parseJson(value: string, fallback: Record<string, unknown>) {
  const trimmed = value.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    toast.error("JSON inválido");
    return fallback;
  }
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === "sent"
    ? "bg-green-500/15 text-green-600 border-green-500/30"
    : status === "pending" || status === "queued"
      ? "bg-amber-500/15 text-amber-600 border-amber-500/30"
      : "bg-red-500/15 text-red-600 border-red-500/30";
  return <Badge variant="outline" className={tone}>{status}</Badge>;
}

export function NotificationEngineTab() {
  const { isPrivileged, loading: capLoading } = useMyCapabilities();
  const { session } = useSap();
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [triggers, setTriggers] = useState<TriggerRow[]>([]);
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [recipients, setRecipients] = useState<RecipientRow[]>([]);
  const [dispatches, setDispatches] = useState<DispatchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedTriggerId, setSelectedTriggerId] = useState<string | null>(null);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [selectedDispatch, setSelectedDispatch] = useState<DispatchRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tpl, trg, rul, rec, dsp] = await Promise.all([
        db.from("notification_templates").select("*").order("updated_at", { ascending: false }),
        db.from("notification_triggers").select("*").order("event_key"),
        db.from("notification_rules").select("*").order("priority"),
        db.from("notification_rule_recipients").select("*").order("created_at"),
        db
          .from("notification_dispatches")
          .select("*, notification_dispatch_recipients(*)")
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      for (const result of [tpl, trg, rul, rec, dsp]) {
        if (result.error) throw result.error;
      }
      const templateRows = (tpl.data || []) as TemplateRow[];
      const triggerRows = (trg.data || []) as TriggerRow[];
      const ruleRows = (rul.data || []) as RuleRow[];
      setTemplates(templateRows);
      setTriggers(triggerRows);
      setRules(ruleRows);
      setRecipients((rec.data || []) as RecipientRow[]);
      setDispatches((dsp.data || []) as DispatchRow[]);
      setSelectedTemplateId((prev) => prev ?? templateRows[0]?.id ?? null);
      setSelectedTriggerId((prev) => prev ?? triggerRows[0]?.id ?? null);
      setSelectedRuleId((prev) => prev ?? ruleRows[0]?.id ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar motor de notificações");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectedTemplate = templates.find((item) => item.id === selectedTemplateId) || null;
  const selectedTrigger = triggers.find((item) => item.id === selectedTriggerId) || null;
  const selectedRule = rules.find((item) => item.id === selectedRuleId) || null;
  const selectedRuleRecipients = useMemo(
    () => recipients.filter((item) => item.rule_id === selectedRuleId),
    [recipients, selectedRuleId],
  );

  const patchTemplate = (id: string, changes: Partial<TemplateRow>) =>
    setTemplates((prev) => prev.map((item) => (item.id === id ? { ...item, ...changes } : item)));

  const patchTrigger = (id: string, changes: Partial<TriggerRow>) =>
    setTriggers((prev) => prev.map((item) => (item.id === id ? { ...item, ...changes } : item)));

  const patchRule = (id: string, changes: Partial<RuleRow>) =>
    setRules((prev) => prev.map((item) => (item.id === id ? { ...item, ...changes } : item)));

  const saveTemplate = async (template: TemplateRow) => {
    setSaving(template.id);
    try {
      const { error } = await db
        .from("notification_templates")
        .update({
          name: template.name,
          description: template.description,
          channel: template.channel,
          subject_template: template.subject_template,
          body_template: template.body_template,
          html_template: template.html_template,
          variables_schema: template.variables_schema,
          active: template.active,
          version: template.version,
          updated_by: session?.userName || null,
        })
        .eq("id", template.id);
      if (error) throw error;
      toast.success("Modelo salvo");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar modelo");
    } finally {
      setSaving(null);
    }
  };

  const saveTrigger = async (trigger: TriggerRow) => {
    setSaving(trigger.id);
    try {
      const { error } = await db
        .from("notification_triggers")
        .update({
          name: trigger.name,
          event_key: trigger.event_key,
          source_module: trigger.source_module,
          description: trigger.description,
          company_db: trigger.company_db,
          active: trigger.active,
          debounce_seconds: trigger.debounce_seconds,
          conditions_json: trigger.conditions_json,
          updated_by: session?.userName || null,
        })
        .eq("id", trigger.id);
      if (error) throw error;
      toast.success("Gatilho salvo");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar gatilho");
    } finally {
      setSaving(null);
    }
  };

  const saveRule = async (rule: RuleRow) => {
    setSaving(rule.id);
    try {
      const { error } = await db
        .from("notification_rules")
        .update({
          trigger_id: rule.trigger_id,
          template_id: rule.template_id,
          name: rule.name,
          channel: rule.channel,
          priority: rule.priority,
          active: rule.active,
          recipient_strategy: rule.recipient_strategy,
          conditions_json: rule.conditions_json,
          updated_by: session?.userName || null,
        })
        .eq("id", rule.id);
      if (error) throw error;
      toast.success("Regra salva");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar regra");
    } finally {
      setSaving(null);
    }
  };

  const createTemplate = async () => {
    try {
      const { data, error } = await db
        .from("notification_templates")
        .insert({
          name: "Novo modelo",
          channel: "in_app",
          subject_template: "Novo aviso: {{document_number}}",
          body_template: "{{message}}",
          created_by: session?.userName || null,
          updated_by: session?.userName || null,
        })
        .select()
        .single();
      if (error) throw error;
      setTemplates((prev) => [data, ...prev]);
      setSelectedTemplateId(data.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao criar modelo");
    }
  };

  const createTrigger = async () => {
    try {
      const { data, error } = await db
        .from("notification_triggers")
        .insert({
          name: "Novo gatilho",
          event_key: `custom.event.${Date.now()}`,
          source_module: "custom",
          created_by: session?.userName || null,
          updated_by: session?.userName || null,
        })
        .select()
        .single();
      if (error) throw error;
      setTriggers((prev) => [data, ...prev]);
      setSelectedTriggerId(data.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao criar gatilho");
    }
  };

  const createRule = async () => {
    const triggerId = selectedTriggerId || triggers[0]?.id;
    const templateId = selectedTemplateId || templates[0]?.id;
    if (!triggerId || !templateId) {
      toast.error("Crie pelo menos um gatilho e um modelo antes da regra");
      return;
    }
    try {
      const { data, error } = await db
        .from("notification_rules")
        .insert({
          trigger_id: triggerId,
          template_id: templateId,
          name: "Nova regra",
          channel: templates.find((item) => item.id === templateId)?.channel || "in_app",
          created_by: session?.userName || null,
          updated_by: session?.userName || null,
        })
        .select()
        .single();
      if (error) throw error;
      setRules((prev) => [data, ...prev]);
      setSelectedRuleId(data.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao criar regra");
    }
  };

  const addRecipient = async () => {
    if (!selectedRuleId) return;
    try {
      const { data, error } = await db
        .from("notification_rule_recipients")
        .insert({ rule_id: selectedRuleId, recipient_type: "approver" })
        .select()
        .single();
      if (error) throw error;
      setRecipients((prev) => [...prev, data]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao adicionar destinatário");
    }
  };

  const updateRecipient = async (recipient: RecipientRow, changes: Partial<RecipientRow>) => {
    const next = { ...recipient, ...changes };
    setRecipients((prev) => prev.map((item) => (item.id === recipient.id ? next : item)));
    const { error } = await db
      .from("notification_rule_recipients")
      .update({
        recipient_type: next.recipient_type,
        value: next.value,
        active: next.active,
      })
      .eq("id", recipient.id);
    if (error) {
      toast.error(error.message);
      await load();
    }
  };

  const deleteRecipient = async (recipient: RecipientRow) => {
    const { error } = await db.from("notification_rule_recipients").delete().eq("id", recipient.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRecipients((prev) => prev.filter((item) => item.id !== recipient.id));
  };

  if (capLoading) {
    return <div className="text-center py-12 text-muted-foreground">Carregando...</div>;
  }

  if (!isPrivileged) {
    return (
      <div className="glass-card p-8 text-center space-y-2">
        <Bell className="w-6 h-6 mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Somente administradores podem configurar o motor de notificações.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Motor central de eventos, modelos, regras, destinatários e auditoria de envio.
        </p>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Atualizar
        </Button>
      </div>

      <Tabs defaultValue="templates">
        <TabsList>
          <TabsTrigger value="templates">Modelos</TabsTrigger>
          <TabsTrigger value="triggers">Gatilhos</TabsTrigger>
          <TabsTrigger value="rules">Regras</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="pt-4">
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="p-3 border-b border-border flex items-center justify-between">
                <span className="text-sm font-medium">Modelos</span>
                <Button size="sm" variant="outline" onClick={createTemplate} className="gap-1">
                  <Plus className="w-3.5 h-3.5" /> Novo
                </Button>
              </div>
              <ScrollArea className="h-[520px]">
                {templates.map((template) => (
                  <button
                    key={template.id}
                    className={`w-full text-left px-3 py-3 border-b border-border hover:bg-muted/40 ${template.id === selectedTemplateId ? "bg-primary/5" : ""}`}
                    onClick={() => setSelectedTemplateId(template.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">{template.name}</span>
                      <Badge variant="outline">{template.channel}</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">v{template.version}</span>
                  </button>
                ))}
              </ScrollArea>
            </div>

            {selectedTemplate && (
              <div className="glass-card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-lg">Modelo</h3>
                  <label className="flex items-center gap-2 text-sm">
                    Ativo
                    <Switch checked={selectedTemplate.active} onCheckedChange={(active) => patchTemplate(selectedTemplate.id, { active })} />
                  </label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_160px_100px] gap-3">
                  <div>
                    <Label>Nome</Label>
                    <Input value={selectedTemplate.name} onChange={(e) => patchTemplate(selectedTemplate.id, { name: e.target.value })} />
                  </div>
                  <div>
                    <Label>Canal padrão</Label>
                    <Select value={selectedTemplate.channel} onValueChange={(channel) => patchTemplate(selectedTemplate.id, { channel })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{CHANNELS.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Versão</Label>
                    <Input
                      type="number"
                      min={1}
                      value={selectedTemplate.version}
                      onChange={(e) => patchTemplate(selectedTemplate.id, { version: Number(e.target.value) || 1 })}
                    />
                  </div>
                </div>
                <div>
                  <Label>Descrição</Label>
                  <Input value={selectedTemplate.description || ""} onChange={(e) => patchTemplate(selectedTemplate.id, { description: e.target.value })} />
                </div>
                <div>
                  <Label>Assunto</Label>
                  <Input value={selectedTemplate.subject_template || ""} onChange={(e) => patchTemplate(selectedTemplate.id, { subject_template: e.target.value })} />
                </div>
                <div>
                  <Label>Corpo</Label>
                  <Textarea rows={7} value={selectedTemplate.body_template || ""} onChange={(e) => patchTemplate(selectedTemplate.id, { body_template: e.target.value })} />
                </div>
                <div>
                  <Label>HTML</Label>
                  <Textarea rows={6} className="font-mono text-xs" value={selectedTemplate.html_template || ""} onChange={(e) => patchTemplate(selectedTemplate.id, { html_template: e.target.value })} />
                </div>
                <div>
                  <Label>Variáveis</Label>
                  <Textarea
                    rows={5}
                    className="font-mono text-xs"
                    value={formatJson(selectedTemplate.variables_schema)}
                    onChange={(e) => patchTemplate(selectedTemplate.id, { variables_schema: parseJson(e.target.value, selectedTemplate.variables_schema) })}
                  />
                </div>
                <div className="flex justify-end">
                  <Button onClick={() => saveTemplate(selectedTemplate)} disabled={saving === selectedTemplate.id} className="gap-2">
                    {saving === selectedTemplate.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Salvar modelo
                  </Button>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="triggers" className="pt-4">
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="p-3 border-b border-border flex items-center justify-between">
                <span className="text-sm font-medium">Gatilhos</span>
                <Button size="sm" variant="outline" onClick={createTrigger} className="gap-1">
                  <Plus className="w-3.5 h-3.5" /> Novo
                </Button>
              </div>
              <ScrollArea className="h-[520px]">
                {triggers.map((trigger) => (
                  <button
                    key={trigger.id}
                    className={`w-full text-left px-3 py-3 border-b border-border hover:bg-muted/40 ${trigger.id === selectedTriggerId ? "bg-primary/5" : ""}`}
                    onClick={() => setSelectedTriggerId(trigger.id)}
                  >
                    <span className="text-sm font-medium block truncate">{trigger.name}</span>
                    <span className="text-xs text-muted-foreground">{trigger.event_key}</span>
                  </button>
                ))}
              </ScrollArea>
            </div>

            {selectedTrigger && (
              <div className="glass-card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-lg">Gatilho</h3>
                  <label className="flex items-center gap-2 text-sm">
                    Ativo
                    <Switch checked={selectedTrigger.active} onCheckedChange={(active) => patchTrigger(selectedTrigger.id, { active })} />
                  </label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label>Nome</Label>
                    <Input value={selectedTrigger.name} onChange={(e) => patchTrigger(selectedTrigger.id, { name: e.target.value })} />
                  </div>
                  <div>
                    <Label>Event key</Label>
                    <Input value={selectedTrigger.event_key} onChange={(e) => patchTrigger(selectedTrigger.id, { event_key: e.target.value })} />
                  </div>
                  <div>
                    <Label>Módulo origem</Label>
                    <Input value={selectedTrigger.source_module || ""} onChange={(e) => patchTrigger(selectedTrigger.id, { source_module: e.target.value })} />
                  </div>
                  <div>
                    <Label>Empresa</Label>
                    <Input placeholder="Vazio = global" value={selectedTrigger.company_db || ""} onChange={(e) => patchTrigger(selectedTrigger.id, { company_db: e.target.value || null })} />
                  </div>
                  <div>
                    <Label>Debounce em segundos</Label>
                    <Input
                      type="number"
                      min={0}
                      value={selectedTrigger.debounce_seconds}
                      onChange={(e) => patchTrigger(selectedTrigger.id, { debounce_seconds: Number(e.target.value) || 0 })}
                    />
                  </div>
                </div>
                <div>
                  <Label>Descrição</Label>
                  <Input value={selectedTrigger.description || ""} onChange={(e) => patchTrigger(selectedTrigger.id, { description: e.target.value })} />
                </div>
                <div>
                  <Label>Condições JSON</Label>
                  <Textarea
                    rows={8}
                    className="font-mono text-xs"
                    value={formatJson(selectedTrigger.conditions_json)}
                    onChange={(e) => patchTrigger(selectedTrigger.id, { conditions_json: parseJson(e.target.value, selectedTrigger.conditions_json) })}
                  />
                </div>
                <div className="flex justify-end">
                  <Button onClick={() => saveTrigger(selectedTrigger)} disabled={saving === selectedTrigger.id} className="gap-2">
                    {saving === selectedTrigger.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Salvar gatilho
                  </Button>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="rules" className="pt-4">
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="p-3 border-b border-border flex items-center justify-between">
                <span className="text-sm font-medium">Regras</span>
                <Button size="sm" variant="outline" onClick={createRule} className="gap-1">
                  <Plus className="w-3.5 h-3.5" /> Nova
                </Button>
              </div>
              <ScrollArea className="h-[520px]">
                {rules.map((rule) => (
                  <button
                    key={rule.id}
                    className={`w-full text-left px-3 py-3 border-b border-border hover:bg-muted/40 ${rule.id === selectedRuleId ? "bg-primary/5" : ""}`}
                    onClick={() => setSelectedRuleId(rule.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">{rule.name}</span>
                      <Badge variant="outline">{rule.channel}</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {triggers.find((trigger) => trigger.id === rule.trigger_id)?.event_key || "Sem gatilho"}
                    </span>
                  </button>
                ))}
              </ScrollArea>
            </div>

            {selectedRule && (
              <div className="glass-card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-lg">Regra</h3>
                  <label className="flex items-center gap-2 text-sm">
                    Ativa
                    <Switch checked={selectedRule.active} onCheckedChange={(active) => patchRule(selectedRule.id, { active })} />
                  </label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label>Nome</Label>
                    <Input value={selectedRule.name} onChange={(e) => patchRule(selectedRule.id, { name: e.target.value })} />
                  </div>
                  <div>
                    <Label>Canal</Label>
                    <Select value={selectedRule.channel} onValueChange={(channel) => patchRule(selectedRule.id, { channel })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{CHANNELS.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Gatilho</Label>
                    <Select value={selectedRule.trigger_id} onValueChange={(trigger_id) => patchRule(selectedRule.id, { trigger_id })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{triggers.map((trigger) => <SelectItem key={trigger.id} value={trigger.id}>{trigger.event_key}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Modelo</Label>
                    <Select value={selectedRule.template_id} onValueChange={(template_id) => patchRule(selectedRule.id, { template_id })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{templates.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Prioridade</Label>
                    <Input
                      type="number"
                      value={selectedRule.priority}
                      onChange={(e) => patchRule(selectedRule.id, { priority: Number(e.target.value) || 100 })}
                    />
                  </div>
                  <div>
                    <Label>Estratégia</Label>
                    <Input value={selectedRule.recipient_strategy} onChange={(e) => patchRule(selectedRule.id, { recipient_strategy: e.target.value })} />
                  </div>
                </div>
                <div>
                  <Label>Condições JSON</Label>
                  <Textarea
                    rows={6}
                    className="font-mono text-xs"
                    value={formatJson(selectedRule.conditions_json)}
                    onChange={(e) => patchRule(selectedRule.id, { conditions_json: parseJson(e.target.value, selectedRule.conditions_json) })}
                  />
                </div>

                <div className="rounded-lg border border-border">
                  <div className="p-3 border-b border-border flex items-center justify-between">
                    <span className="text-sm font-medium">Destinatários</span>
                    <Button size="sm" variant="outline" onClick={addRecipient} className="gap-1">
                      <Plus className="w-3.5 h-3.5" /> Adicionar
                    </Button>
                  </div>
                  <div className="divide-y divide-border">
                    {selectedRuleRecipients.length === 0 && (
                      <div className="p-4 text-sm text-muted-foreground">Nenhum destinatário configurado.</div>
                    )}
                    {selectedRuleRecipients.map((recipient) => (
                      <div key={recipient.id} className="p-3 grid grid-cols-1 md:grid-cols-[220px_1fr_auto_auto] gap-3 items-center">
                        <Select
                          value={recipient.recipient_type}
                          onValueChange={(recipient_type) => updateRecipient(recipient, { recipient_type })}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{RECIPIENT_TYPES.map((type) => <SelectItem key={type.key} value={type.key}>{type.label}</SelectItem>)}</SelectContent>
                        </Select>
                        <Input
                          value={recipient.value || ""}
                          onChange={(e) => setRecipients((prev) => prev.map((item) => item.id === recipient.id ? { ...item, value: e.target.value } : item))}
                          onBlur={(e) => updateRecipient(recipient, { value: e.target.value || null })}
                          placeholder="Valor, e-mail, telefone, papel ou nome do campo"
                        />
                        <Switch checked={recipient.active} onCheckedChange={(active) => updateRecipient(recipient, { active })} />
                        <Button variant="ghost" size="icon" onClick={() => deleteRecipient(recipient)} aria-label="Remover destinatário">
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button onClick={() => saveRule(selectedRule)} disabled={saving === selectedRule.id} className="gap-2">
                    {saving === selectedRule.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Salvar regra
                  </Button>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="logs" className="pt-4">
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Data</th>
                  <th className="text-left px-3 py-2 font-medium">Evento</th>
                  <th className="text-left px-3 py-2 font-medium">Canal</th>
                  <th className="text-left px-3 py-2 font-medium">Destinatários</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-left px-3 py-2 font-medium">Conteúdo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {dispatches.map((dispatch) => {
                  const dispatchRecipients = dispatch.notification_dispatch_recipients || [];
                  return (
                    <tr key={dispatch.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                        {format(new Date(dispatch.created_at), "dd/MM/yyyy HH:mm")}
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-medium">{dispatch.event_key}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {[dispatch.source_module, dispatch.source_entity_type, dispatch.source_entity_id].filter(Boolean).join(" / ")}
                        </span>
                      </td>
                      <td className="px-3 py-2">{CHANNELS.find((c) => c.key === dispatch.channel)?.label || dispatch.channel}</td>
                      <td className="px-3 py-2 max-w-[260px]">
                        <span className="line-clamp-2">
                          {dispatchRecipients
                            .map((recipient) => recipient.channel_address || recipient.recipient_email || recipient.recipient_phone || recipient.recipient_name)
                            .filter(Boolean)
                            .join(", ") || "Sem destinatário"}
                        </span>
                      </td>
                      <td className="px-3 py-2"><StatusBadge status={dispatch.status} /></td>
                      <td className="px-3 py-2">
                        <Button variant="outline" size="sm" onClick={() => setSelectedDispatch(dispatch)} className="gap-1">
                          <Eye className="w-3.5 h-3.5" /> Ver conteúdo
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {dispatches.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">
                      Nenhum dispatch registrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={!!selectedDispatch} onOpenChange={(open) => !open && setSelectedDispatch(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Conteúdo enviado</DialogTitle>
          </DialogHeader>
          {selectedDispatch && (
            <ScrollArea className="max-h-[72vh] pr-3">
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  <div>
                    <Label className="text-xs">Evento</Label>
                    <p className="font-medium">{selectedDispatch.event_key}</p>
                  </div>
                  <div>
                    <Label className="text-xs">Canal</Label>
                    <p>{selectedDispatch.channel}</p>
                  </div>
                  <div>
                    <Label className="text-xs">Status</Label>
                    <StatusBadge status={selectedDispatch.status} />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Destinatários</Label>
                  <div className="mt-2 rounded-lg border border-border divide-y divide-border">
                    {(selectedDispatch.notification_dispatch_recipients || []).map((recipient) => (
                      <div key={recipient.id} className="p-2 text-sm flex items-center justify-between gap-2">
                        <span>{recipient.channel_address || recipient.recipient_email || recipient.recipient_phone || recipient.recipient_name || "—"}</span>
                        <StatusBadge status={recipient.status} />
                      </div>
                    ))}
                    {(selectedDispatch.notification_dispatch_recipients || []).length === 0 && (
                      <div className="p-2 text-sm text-muted-foreground">Sem destinatários.</div>
                    )}
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Assunto</Label>
                  <div className="mt-1 rounded-lg border border-border bg-muted/20 p-3 text-sm">
                    {selectedDispatch.rendered_subject || "—"}
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Corpo</Label>
                  <pre className="mt-1 rounded-lg border border-border bg-muted/20 p-3 text-sm whitespace-pre-wrap font-sans">
                    {selectedDispatch.rendered_body || "—"}
                  </pre>
                </div>
                {selectedDispatch.rendered_html && (
                  <div>
                    <Label className="text-xs">HTML</Label>
                    <pre className="mt-1 rounded-lg border border-border bg-muted/20 p-3 text-xs overflow-x-auto">
                      {selectedDispatch.rendered_html}
                    </pre>
                  </div>
                )}
                <div>
                  <Label className="text-xs">Payload usado</Label>
                  <pre className="mt-1 rounded-lg border border-border bg-muted/20 p-3 text-xs overflow-x-auto">
                    {formatJson(selectedDispatch.payload_snapshot)}
                  </pre>
                </div>
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
