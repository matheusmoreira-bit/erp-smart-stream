import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Bell, Mail, MessageSquare, Smartphone, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const NOTIFICATION_EVENTS = [
  { key: "approval_pending", label: "Aprovação pendente" },
  { key: "overdue_reminder", label: "Lembrete de vencimento" },
  { key: "sla_escalation", label: "Escalonamento por SLA" },
  { key: "user_credentials", label: "Credenciais de novo usuário" },
] as const;

const CHANNELS = [
  { field: "in_app_enabled", label: "Avisos no app", icon: Bell },
  { field: "email_enabled", label: "E-mail", icon: Mail },
  { field: "push_enabled", label: "Push (celular)", icon: Smartphone },
  { field: "slack_enabled", label: "Slack", icon: MessageSquare },
  { field: "whatsapp_enabled", label: "WhatsApp", icon: MessageSquare },
] as const;

type ChannelField = (typeof CHANNELS)[number]["field"];

interface Row {
  id: string;
  company_db: string | null;
  event_key: string;
  in_app_enabled: boolean;
  email_enabled: boolean;
  push_enabled: boolean;
  slack_enabled: boolean;
  whatsapp_enabled: boolean;
  updated_at: string;
}

interface Props {
  companies: { company_db: string; display_name: string | null }[];
  canEdit: boolean;
}

export function NotificationChannelSettings({ companies, canEdit }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<string>("__global__");
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("notification_channel_settings")
      .select("*");
    if (error) toast.error("Falha ao carregar canais de notificação");
    setRows((data as Row[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const companyDb = scope === "__global__" ? null : scope;

  const globalFor = useCallback(
    (eventKey: string) => rows.find((r) => !r.company_db && r.event_key === eventKey),
    [rows],
  );

  const rowFor = useCallback(
    (eventKey: string) =>
      rows.find((r) => (r.company_db ?? null) === companyDb && r.event_key === eventKey),
    [rows, companyDb],
  );

  const companyLabel = useMemo(
    () => (db: string | null) =>
      db ? companies.find((c) => c.company_db === db)?.display_name || db : "Padrão global",
    [companies],
  );

  const setChannel = async (eventKey: string, field: ChannelField, value: boolean) => {
    if (!canEdit) return;
    const key = `${eventKey}:${field}`;
    setSavingKey(key);
    try {
      const existing = rowFor(eventKey);
      if (existing) {
        const { error } = await supabase
          .from("notification_channel_settings")
          .update({ [field]: value } as never)
          .eq("id", existing.id);
        if (error) throw error;
        setRows((prev) => prev.map((r) => (r.id === existing.id ? { ...r, [field]: value } : r)));
      } else {
        const base = globalFor(eventKey);
        const payload = {
          company_db: companyDb,
          event_key: eventKey,
          in_app_enabled: base?.in_app_enabled ?? true,
          email_enabled: base?.email_enabled ?? true,
          push_enabled: base?.push_enabled ?? true,
          slack_enabled: base?.slack_enabled ?? true,
          whatsapp_enabled: base?.whatsapp_enabled ?? true,
          [field]: value,
        };
        const { data, error } = await supabase
          .from("notification_channel_settings")
          .insert(payload as never)
          .select()
          .single();
        if (error) throw error;
        setRows((prev) => [...prev, data as Row]);

      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setSavingKey(null);
    }
  };

  const removeOverride = async (eventKey: string) => {
    const existing = rowFor(eventKey);
    if (!existing || !existing.company_db) return;
    const { error } = await supabase
      .from("notification_channel_settings")
      .delete()
      .eq("id", existing.id);
    if (error) return toast.error(error.message);
    setRows((prev) => prev.filter((r) => r.id !== existing.id));
    toast.success("Configuração da empresa removida — volta a usar o padrão global");
  };

  return (
    <section className="glass-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Canais por empresa e evento</h2>
          <p className="text-xs text-muted-foreground">
            Escolha quais canais ficam ativos em cada tipo de aviso. A empresa sobrescreve o padrão global.
          </p>
        </div>
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__global__">Padrão global</SelectItem>
            {companies.map((c) => (
              <SelectItem key={c.company_db} value={c.company_db}>
                {c.display_name || c.company_db}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
          Carregando…
        </div>
      ) : (
        <div className="space-y-4">
          {NOTIFICATION_EVENTS.map((ev) => {
            const row = rowFor(ev.key);
            const base = globalFor(ev.key);
            const effective = row || base;
            const inherited = !row && !!companyDb;
            return (
              <div key={ev.key} className="rounded-lg border border-border p-4">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{ev.label}</span>
                    {inherited && (
                      <Badge variant="secondary" className="text-[10px]">
                        herdado do padrão global
                      </Badge>
                    )}
                  </div>
                  {row?.company_db && canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-muted-foreground"
                      onClick={() => removeOverride(ev.key)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Usar padrão
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {CHANNELS.map(({ field, label, icon: Icon }) => {
                    const value = (effective?.[field] ?? true) as boolean;
                    const key = `${ev.key}:${field}`;
                    return (
                      <label
                        key={field}
                        className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                      >
                        <span className="flex items-center gap-2 text-sm text-foreground">
                          <Icon className="w-4 h-4 text-muted-foreground" />
                          {label}
                        </span>
                        <Switch
                          checked={value}
                          disabled={!canEdit || savingKey === key}
                          onCheckedChange={(v) => setChannel(ev.key, field, v)}
                          aria-label={`${label} — ${ev.label}`}
                        />
                      </label>
                    );
                  })}
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">
                  Empresa: {companyLabel(companyDb)}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
