import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, Save, Send, Clock, RefreshCw, FlaskConical, ExternalLink, Copy, CheckCircle2, XCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface OverdueSettings {
  id?: string;
  company_db: string | null;
  enabled: boolean;
  frequency_minutes: number;
  template: string;
  window_start_hour: number;
  window_end_hour: number;
  weekdays_only: boolean;
  max_reminders_per_doc: number;
  notify_approver: boolean;
  notify_requester: boolean;
}

interface OverdueLogRow {
  id: string;
  expense_id: string;
  company_db: string;
  recipient_role: string;
  recipient_name: string | null;
  recipient_phone: string | null;
  status: string;
  sent_at: string;
  response: string | null;
}

const DEFAULT_TEMPLATE = `⚠️ *Documento vencido aguardando aprovação*

Fornecedor: {{supplier}}
Valor: {{currency}} {{amount}}
Vencimento: {{due_date}} (há {{days_overdue}} dia(s))
Solicitante: {{requester}}

Aprove em: {{link}}`;

const TEMPLATE_VARS = [
  { key: "supplier", desc: "Nome do fornecedor" },
  { key: "amount", desc: "Valor formatado" },
  { key: "currency", desc: "Moeda (BRL, USD…)" },
  { key: "due_date", desc: "Data de vencimento (DD/MM/AAAA)" },
  { key: "days_overdue", desc: "Nº de dias em atraso" },
  { key: "requester", desc: "Solicitante" },
  { key: "approver", desc: "Aprovador atual" },
  { key: "doc_type", desc: "Tipo de documento" },
  { key: "link", desc: "Link direto para a aprovação" },
];

interface TestSample {
  source: "real" | "sample";
  expense_id: string;
  supplier: string;
  currency: string;
  amount: number;
  due_date: string;
  requester: string;
  approver: string;
  doc_type: string;
}

const PUBLIC_APP_URL = "https://erp-flow.cactuscorporation.com";

function formatDateBR(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function renderTemplate(tpl: string, sample: TestSample): { text: string; link: string } {
  const days = Math.max(
    1,
    Math.floor((Date.now() - new Date(`${sample.due_date}T00:00:00`).getTime()) / 86400000),
  );
  const amount = new Intl.NumberFormat("pt-BR", { style: "currency", currency: sample.currency || "BRL" })
    .format(sample.amount);
  const link = `${PUBLIC_APP_URL}/aprovacoes?doc=${encodeURIComponent("internal:" + sample.expense_id)}`;
  const vars: Record<string, string> = {
    supplier: sample.supplier,
    currency: sample.currency,
    amount,
    due_date: formatDateBR(sample.due_date),
    days_overdue: String(days),
    requester: sample.requester,
    approver: sample.approver,
    doc_type: sample.doc_type,
    link,
  };
  const text = tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
  return { text, link };
}

export function OverdueRemindersTab() {
  const [settings, setSettings] = useState<OverdueSettings | null>(null);
  const [logs, setLogs] = useState<OverdueLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testResult, setTestResult] = useState<{ sample: TestSample; text: string; link: string } | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: sRows }, { data: lRows }] = await Promise.all([
      supabase.from("overdue_reminder_settings").select("*").is("company_db", null).limit(1),
      supabase.from("overdue_reminder_log").select("*").order("sent_at", { ascending: false }).limit(30),
    ]);
    const row = (sRows as OverdueSettings[] | null)?.[0];
    setSettings(row || {
      company_db: null,
      enabled: true,
      frequency_minutes: 30,
      template: DEFAULT_TEMPLATE,
      window_start_hour: 8,
      window_end_hour: 20,
      weekdays_only: true,
      max_reminders_per_doc: 0,
      notify_approver: true,
      notify_requester: true,
    });
    setLogs((lRows as OverdueLogRow[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!settings) return;
    if (settings.frequency_minutes < 5) {
      toast.error("Frequência mínima é 5 minutos");
      return;
    }
    if (settings.window_end_hour <= settings.window_start_hour) {
      toast.error("A janela de envio precisa terminar depois do início");
      return;
    }
    setSaving(true);
    const payload = { ...settings };
    delete (payload as { id?: string }).id;
    const { error } = settings.id
      ? await supabase.from("overdue_reminder_settings").update(payload).eq("id", settings.id)
      : await supabase.from("overdue_reminder_settings").insert(payload);
    setSaving(false);
    if (error) {
      toast.error("Não foi possível salvar", { description: error.message });
      return;
    }
    toast.success("Configurações salvas");
    load();
  };

  const runNow = async () => {
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("overdue-reminders-dispatch", {
        body: { trigger: "manual" },
      });
      if (error) throw error;
      const d = data as { overdueCount?: number; sent?: number; skipped?: number };
      toast.success("Despacho executado", {
        description: `Vencidos: ${d?.overdueCount ?? 0} · enviados: ${d?.sent ?? 0} · ignorados: ${d?.skipped ?? 0}`,
      });
      load();
    } catch (e) {
      toast.error("Erro ao executar despacho", { description: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  if (loading || !settings) {
    return <div className="glass-card p-6 text-center text-muted-foreground">Carregando…</div>;
  }

  const preview = settings.template
    .replace(/\{\{supplier\}\}/g, "Fornecedor Exemplo LTDA")
    .replace(/\{\{amount\}\}/g, "R$ 1.234,56")
    .replace(/\{\{currency\}\}/g, "BRL")
    .replace(/\{\{due_date\}\}/g, "05/07/2026")
    .replace(/\{\{days_overdue\}\}/g, "2")
    .replace(/\{\{requester\}\}/g, "Santiago Macedo")
    .replace(/\{\{approver\}\}/g, "Leonardo Rossini")
    .replace(/\{\{doc_type\}\}/g, "Nota Fiscal")
    .replace(/\{\{link\}\}/g, "https://erp-flow.cactuscorporation.com/aprovacoes?doc=internal:…");

  const statusColor: Record<string, string> = {
    sent: "text-emerald-500",
    error: "text-destructive",
    skipped_no_phone: "text-amber-600",
    skipped_window: "text-muted-foreground",
    skipped_frequency: "text-muted-foreground",
    skipped_max: "text-muted-foreground",
  };

  return (
    <div className="space-y-6">
      <div className="glass-card p-6 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Lembretes de documentos vencidos
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Envia lembrete via WhatsApp para o aprovador e/ou solicitante enquanto um documento
              estiver <strong>vencido</strong> (due_date &lt; hoje) e <strong>pendente de aprovação</strong>.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="enabled" className="text-sm">Ativo</Label>
            <Switch
              id="enabled"
              checked={settings.enabled}
              onCheckedChange={(v) => setSettings({ ...settings, enabled: v })}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="freq" className="text-xs text-muted-foreground">Frequência de reenvio (minutos)</Label>
            <Input
              id="freq"
              type="number"
              min={5}
              value={settings.frequency_minutes}
              onChange={(e) => setSettings({ ...settings, frequency_minutes: Math.max(5, Number(e.target.value) || 5) })}
            />
            <p className="text-xs text-muted-foreground mt-1">Mínimo 5 min. Padrão: 30 min.</p>
          </div>
          <div>
            <Label htmlFor="max" className="text-xs text-muted-foreground">Limite de lembretes por documento</Label>
            <Input
              id="max"
              type="number"
              min={0}
              value={settings.max_reminders_per_doc}
              onChange={(e) => setSettings({ ...settings, max_reminders_per_doc: Math.max(0, Number(e.target.value) || 0) })}
            />
            <p className="text-xs text-muted-foreground mt-1">0 = ilimitado até aprovar.</p>
          </div>
          <div>
            <Label htmlFor="start" className="text-xs text-muted-foreground">Início da janela (hora)</Label>
            <Input
              id="start"
              type="number"
              min={0}
              max={23}
              value={settings.window_start_hour}
              onChange={(e) => setSettings({ ...settings, window_start_hour: Math.min(23, Math.max(0, Number(e.target.value) || 0)) })}
            />
          </div>
          <div>
            <Label htmlFor="end" className="text-xs text-muted-foreground">Fim da janela (hora)</Label>
            <Input
              id="end"
              type="number"
              min={1}
              max={24}
              value={settings.window_end_hour}
              onChange={(e) => setSettings({ ...settings, window_end_hour: Math.min(24, Math.max(1, Number(e.target.value) || 24)) })}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-6 pt-2">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={settings.weekdays_only}
              onCheckedChange={(v) => setSettings({ ...settings, weekdays_only: v })}
            />
            Enviar apenas em dias úteis
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={settings.notify_approver}
              onCheckedChange={(v) => setSettings({ ...settings, notify_approver: v })}
            />
            Notificar aprovador atual
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={settings.notify_requester}
              onCheckedChange={(v) => setSettings({ ...settings, notify_requester: v })}
            />
            Notificar solicitante
          </label>
        </div>

        <div>
          <Label htmlFor="template" className="text-xs text-muted-foreground">Modelo da mensagem</Label>
          <Textarea
            id="template"
            rows={9}
            value={settings.template}
            onChange={(e) => setSettings({ ...settings, template: e.target.value })}
            className="font-mono text-sm"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {TEMPLATE_VARS.map((v) => (
              <button
                key={v.key}
                type="button"
                title={v.desc}
                onClick={() =>
                  setSettings((prev) => (prev ? { ...prev, template: `${prev.template}{{${v.key}}}` } : prev))
                }
                className="px-2 py-0.5 rounded-md text-[11px] font-mono border border-border bg-muted/40 hover:bg-muted transition-colors"
              >
                {"{{"}{v.key}{"}}"}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Prévia da mensagem</Label>
          <pre className="mt-1 p-3 bg-muted/40 rounded-md text-xs whitespace-pre-wrap font-sans">{preview}</pre>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={saving} className="gap-2">
            <Save className="w-4 h-4" /> {saving ? "Salvando…" : "Salvar configurações"}
          </Button>
          <Button variant="outline" onClick={runNow} disabled={testing} className="gap-2">
            <Send className="w-4 h-4" /> {testing ? "Executando…" : "Rodar despacho agora"}
          </Button>
          <Button variant="ghost" onClick={load} className="gap-2">
            <RefreshCw className="w-4 h-4" /> Atualizar
          </Button>
        </div>
      </div>

      <div className="glass-card p-6">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
          <Clock className="w-4 h-4 text-primary" /> Últimos envios ({logs.length})
        </h3>
        {logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum lembrete enviado ainda.</p>
        ) : (
          <div className="space-y-1.5">
            {logs.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-3 py-1.5 border-b border-border/50 text-xs">
                <div className="flex-1 min-w-0">
                  <span className={`font-semibold ${statusColor[l.status] || "text-foreground"}`}>{l.status}</span>
                  <span className="ml-2 text-muted-foreground">{l.recipient_role}</span>
                  {l.recipient_name && <span className="ml-2 text-foreground">{l.recipient_name}</span>}
                  {l.recipient_phone && <span className="ml-2 text-muted-foreground">({l.recipient_phone})</span>}
                </div>
                <span className="text-muted-foreground whitespace-nowrap">
                  {formatDistanceToNow(new Date(l.sent_at), { addSuffix: true, locale: ptBR })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
