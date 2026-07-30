import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMyCapabilities } from "@/hooks/useMyCapabilities";
import { useSap } from "@/contexts/SapContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, RefreshCw, Save, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

interface NotificationSetting {
  id: string;
  company_db: string | null;
  event_key: string;
  label: string;
  description: string | null;
  enabled: boolean;
  channels: string[];
  frequency: string;
  frequency_minutes: number | null;
  window_start_hour: number | null;
  window_end_hour: number | null;
  weekdays_only: boolean;
  subject_template: string | null;
  body_template: string | null;
  html_template: string | null;
  trigger_config: Record<string, unknown> | null;
  updated_by: string | null;
  updated_at: string;
}

const CHANNELS = [
  { key: "in_app", label: "In-App" },
  { key: "email", label: "E-mail" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "slack", label: "Slack" },
];

const FREQUENCIES = [
  { key: "immediate", label: "Imediato" },
  { key: "recurring", label: "Recorrente" },
  { key: "daily_digest", label: "Resumo diário" },
  { key: "weekly_digest", label: "Resumo semanal" },
  { key: "disabled", label: "Não enviar" },
];

export function NotificationSettingsTab() {
  const { isPrivileged, loading: capLoading } = useMyCapabilities();
  const { session } = useSap();
  const [items, setItems] = useState<NotificationSetting[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("notification_settings")
        .select("*")
        .order("label");
      if (error) throw error;
      const rows = (data as NotificationSetting[]) || [];
      setItems(rows);
      setSelectedId((prev) => prev ?? rows[0]?.id ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar configurações");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patch = (id: string, changes: Partial<NotificationSetting>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...changes } : i)));
  };

  const save = async (item: NotificationSetting) => {
    setSavingId(item.id);
    try {
      const { error } = await supabase
        .from("notification_settings")
        .update({
          enabled: item.enabled,
          channels: item.channels,
          frequency: item.frequency,
          frequency_minutes: item.frequency_minutes,
          window_start_hour: item.window_start_hour,
          window_end_hour: item.window_end_hour,
          weekdays_only: item.weekdays_only,
          subject_template: item.subject_template,
          body_template: item.body_template,
          html_template: item.html_template,
          updated_by: session?.userName || null,
        })
        .eq("id", item.id);
      if (error) throw error;
      toast.success("Configuração salva");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setSavingId(null);
    }
  };

  if (capLoading) {
    return <div className="text-center py-12 text-muted-foreground">Carregando...</div>;
  }

  if (!isPrivileged) {
    return (
      <div className="glass-card p-8 text-center space-y-2">
        <ShieldAlert className="w-6 h-6 mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Somente administradores podem editar as configurações de notificação.
        </p>
      </div>
    );
  }

  const selected = items.find((i) => i.id === selectedId) || null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Gatilhos, frequência e textos de cada notificação do sistema.
        </p>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Atualizar
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
        <ScrollArea className="h-[calc(100vh-360px)] rounded-lg border border-border">
          <div className="divide-y divide-border">
            {items.map((i) => (
              <button
                key={i.id}
                onClick={() => setSelectedId(i.id)}
                className={`w-full text-left px-3 py-3 hover:bg-muted/50 transition-colors ${
                  i.id === selectedId ? "bg-primary/5" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{i.label}</span>
                  {!i.enabled && <Badge variant="secondary" className="text-[10px]">off</Badge>}
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {i.channels.map((c) => (
                    <Badge key={c} variant="outline" className="text-[10px]">
                      {CHANNELS.find((x) => x.key === c)?.label || c}
                    </Badge>
                  ))}
                </div>
              </button>
            ))}
            {items.length === 0 && !loading && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Nenhuma notificação cadastrada.
              </div>
            )}
          </div>
        </ScrollArea>

        {selected ? (
          <div className="glass-card p-5 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-foreground">{selected.label}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {selected.description || selected.event_key}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs">Ativa</Label>
                <Switch
                  checked={selected.enabled}
                  onCheckedChange={(v) => patch(selected.id, { enabled: v })}
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">Canais de envio</Label>
              <div className="flex flex-wrap gap-4 mt-2">
                {CHANNELS.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={selected.channels.includes(c.key)}
                      onCheckedChange={(v) =>
                        patch(selected.id, {
                          channels: v
                            ? [...selected.channels, c.key]
                            : selected.channels.filter((x) => x !== c.key),
                        })
                      }
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <Label className="text-xs">Frequência</Label>
                <Select
                  value={selected.frequency}
                  onValueChange={(v) => patch(selected.id, { frequency: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FREQUENCIES.map((f) => (
                      <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Intervalo (min)</Label>
                <Input
                  type="number"
                  min={0}
                  value={selected.frequency_minutes ?? ""}
                  onChange={(e) =>
                    patch(selected.id, {
                      frequency_minutes: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </div>
              <div>
                <Label className="text-xs">Janela início (h)</Label>
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={selected.window_start_hour ?? ""}
                  onChange={(e) =>
                    patch(selected.id, {
                      window_start_hour: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </div>
              <div>
                <Label className="text-xs">Janela fim (h)</Label>
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={selected.window_end_hour ?? ""}
                  onChange={(e) =>
                    patch(selected.id, {
                      window_end_hour: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={selected.weekdays_only}
                onCheckedChange={(v) => patch(selected.id, { weekdays_only: v })}
              />
              Enviar somente em dias úteis
            </label>

            <Tabs defaultValue="texto">
              <TabsList>
                <TabsTrigger value="texto">Texto</TabsTrigger>
                <TabsTrigger value="html">HTML</TabsTrigger>
              </TabsList>
              <TabsContent value="texto" className="space-y-3 pt-3">
                <div>
                  <Label className="text-xs">Assunto</Label>
                  <Input
                    value={selected.subject_template ?? ""}
                    onChange={(e) => patch(selected.id, { subject_template: e.target.value })}
                    placeholder="Ex.: Aprovação pendente: {{documento}}"
                  />
                </div>
                <div>
                  <Label className="text-xs">Mensagem</Label>
                  <Textarea
                    rows={6}
                    value={selected.body_template ?? ""}
                    onChange={(e) => patch(selected.id, { body_template: e.target.value })}
                  />
                </div>
              </TabsContent>
              <TabsContent value="html" className="space-y-3 pt-3">
                <Label className="text-xs">HTML do e-mail</Label>
                <Textarea
                  rows={12}
                  className="font-mono text-xs"
                  value={selected.html_template ?? ""}
                  onChange={(e) => patch(selected.id, { html_template: e.target.value })}
                  placeholder="<p>Olá {{aprovador}}...</p>"
                />
              </TabsContent>
            </Tabs>

            <p className="text-[11px] text-muted-foreground">
              Variáveis disponíveis: {"{{documento}}, {{valor}}, {{aprovador}}, {{solicitante}}, {{motivo}}, {{empresa}}, {{link}}"}
            </p>

            <div className="flex justify-end">
              <Button onClick={() => save(selected)} disabled={savingId === selected.id} className="gap-2">
                {savingId === selected.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Salvar
              </Button>
            </div>
          </div>
        ) : (
          <div className="glass-card p-8 text-center text-sm text-muted-foreground">
            Selecione uma notificação para editar.
          </div>
        )}
      </div>
    </div>
  );
}
