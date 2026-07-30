import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BellRing, Loader2, Save, Send } from "lucide-react";
import { toast } from "sonner";

const PROVIDER_LABEL: Record<string, string> = {
  sap_sl: "SAP Service Layer",
  hana: "HanaAPI V2",
  pagcorp: "PagCorp",
  mastertax: "Master Tax",
};

interface AlertSetting {
  id: string;
  provider: string;
  enabled: boolean;
  window_minutes: number;
  min_samples: number;
  p95_threshold_ms: number;
  error_rate_threshold: number;
  cooldown_minutes: number;
  notify_email: boolean;
  notify_slack: boolean;
  recipient_emails: string[] | null;
  slack_channel: string | null;
}

interface AlertRow {
  id: string;
  provider: string;
  kind: string;
  severity: string;
  message: string;
  channels: string[] | null;
  delivery_ok: boolean | null;
  delivery_detail: string | null;
  created_at: string;
}

const KIND_LABEL: Record<string, string> = {
  error_rate: "Taxa de erro",
  p95_latency: "Latência p95",
};

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleString("pt-BR") : "—");

export function IntegrationHealthAlerts() {
  const [settings, setSettings] = useState<AlertSetting[]>([]);
  const [history, setHistory] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cfg, hist] = await Promise.all([
        supabase.from("integration_health_alert_settings" as never).select("*").order("provider"),
        supabase
          .from("integration_health_alerts" as never)
          .select("*")
          .order("created_at", { ascending: false })
          .limit(25),
      ]);
      if (cfg.error) throw cfg.error;
      if (hist.error) throw hist.error;
      setSettings((cfg.data ?? []) as unknown as AlertSetting[]);
      setHistory((hist.data ?? []) as unknown as AlertRow[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar alertas");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (id: string, changes: Partial<AlertSetting>) =>
    setSettings((prev) => prev.map((s) => (s.id === id ? { ...s, ...changes } : s)));

  const save = async (s: AlertSetting) => {
    setSavingId(s.id);
    try {
      const { error } = await supabase
        .from("integration_health_alert_settings" as never)
        .update({
          enabled: s.enabled,
          window_minutes: Number(s.window_minutes) || 30,
          min_samples: Number(s.min_samples) || 5,
          p95_threshold_ms: Number(s.p95_threshold_ms) || 15000,
          error_rate_threshold: Number(s.error_rate_threshold) || 10,
          cooldown_minutes: Number(s.cooldown_minutes) || 60,
          notify_email: s.notify_email,
          notify_slack: s.notify_slack,
          recipient_emails: s.recipient_emails ?? [],
          slack_channel: s.slack_channel?.trim() || null,
        } as never)
        .eq("id", s.id);
      if (error) throw error;
      toast.success(`Alertas de ${PROVIDER_LABEL[s.provider] ?? s.provider} salvos`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setSavingId(null);
    }
  };

  const runNow = async (dryRun: boolean) => {
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("integration-health-alerts", {
        body: { dryRun },
      });
      if (error) throw error;
      const results = (data as { results?: unknown[] })?.results ?? [];
      toast.success(
        dryRun
          ? `Simulação concluída: ${results.length} alerta(s) seriam disparados`
          : `Verificação concluída: ${results.length} alerta(s) processados`,
      );
      if (!dryRun) void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao executar verificação");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <BellRing className="w-4 h-4 text-muted-foreground" />
                Alertas proativos de degradação
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Verificação automática a cada 10 minutos: dispara e-mail/Slack quando a latência (p95) ou a taxa de erro
                de uma integração ultrapassa o limite configurado.
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void runNow(true)} disabled={testing}>
                {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                <span className="ml-2">Simular</span>
              </Button>
              <Button size="sm" variant="outline" onClick={() => void runNow(false)} disabled={testing}>
                Verificar agora
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="w-4 h-4 animate-spin" /> Carregando configurações…
            </div>
          )}
          {!loading && settings.length === 0 && (
            <p className="text-sm text-muted-foreground py-6">Nenhuma integração configurada para alertas.</p>
          )}
          {settings.map((s) => (
            <div key={s.id} className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Switch
                    checked={s.enabled}
                    onCheckedChange={(v) => patch(s.id, { enabled: v })}
                    aria-label={`Ativar alertas de ${PROVIDER_LABEL[s.provider] ?? s.provider}`}
                  />
                  <span className="font-medium text-sm">{PROVIDER_LABEL[s.provider] ?? s.provider}</span>
                  {!s.enabled && <Badge variant="outline" className="text-[10px]">desativado</Badge>}
                </div>
                <Button size="sm" onClick={() => void save(s)} disabled={savingId === s.id}>
                  {savingId === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span className="ml-2">Salvar</span>
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-5">
                <div className="space-y-1">
                  <Label className="text-xs" htmlFor={`p95-${s.id}`}>Limite p95 (ms)</Label>
                  <Input
                    id={`p95-${s.id}`}
                    type="number"
                    min={500}
                    value={s.p95_threshold_ms}
                    onChange={(e) => patch(s.id, { p95_threshold_ms: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs" htmlFor={`err-${s.id}`}>Limite erro (%)</Label>
                  <Input
                    id={`err-${s.id}`}
                    type="number"
                    min={0}
                    step="0.5"
                    value={s.error_rate_threshold}
                    onChange={(e) => patch(s.id, { error_rate_threshold: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs" htmlFor={`win-${s.id}`}>Janela (min)</Label>
                  <Input
                    id={`win-${s.id}`}
                    type="number"
                    min={5}
                    value={s.window_minutes}
                    onChange={(e) => patch(s.id, { window_minutes: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs" htmlFor={`min-${s.id}`}>Mín. execuções</Label>
                  <Input
                    id={`min-${s.id}`}
                    type="number"
                    min={1}
                    value={s.min_samples}
                    onChange={(e) => patch(s.id, { min_samples: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs" htmlFor={`cd-${s.id}`}>Intervalo entre avisos (min)</Label>
                  <Input
                    id={`cd-${s.id}`}
                    type="number"
                    min={5}
                    value={s.cooldown_minutes}
                    onChange={(e) => patch(s.id, { cooldown_minutes: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={s.notify_email}
                      onCheckedChange={(v) => patch(s.id, { notify_email: v })}
                      aria-label="Notificar por e-mail"
                    />
                    <Label className="text-xs">E-mail</Label>
                  </div>
                  <Input
                    placeholder="emails separados por vírgula"
                    value={(s.recipient_emails ?? []).join(", ")}
                    onChange={(e) =>
                      patch(s.id, {
                        recipient_emails: e.target.value
                          .split(",")
                          .map((v) => v.trim())
                          .filter(Boolean),
                      })
                    }
                    disabled={!s.notify_email}
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={s.notify_slack}
                      onCheckedChange={(v) => patch(s.id, { notify_slack: v })}
                      aria-label="Notificar por Slack"
                    />
                    <Label className="text-xs">Slack</Label>
                  </div>
                  <Input
                    placeholder="#canal ou ID do canal"
                    value={s.slack_channel ?? ""}
                    onChange={(e) => patch(s.id, { slack_channel: e.target.value })}
                    disabled={!s.notify_slack}
                  />
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Alertas disparados</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Integração</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Gravidade</TableHead>
                <TableHead>Canais</TableHead>
                <TableHead>Envio</TableHead>
                <TableHead>Mensagem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="text-xs">{fmtDate(a.created_at)}</TableCell>
                  <TableCell className="text-xs">{PROVIDER_LABEL[a.provider] ?? a.provider}</TableCell>
                  <TableCell className="text-xs">{KIND_LABEL[a.kind] ?? a.kind}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        a.severity === "critical"
                          ? "text-[10px] bg-destructive/15 text-destructive border-destructive/30"
                          : "text-[10px] bg-amber-500/15 text-amber-600 border-amber-500/30"
                      }
                    >
                      {a.severity === "critical" ? "crítico" : "atenção"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{(a.channels ?? []).join(", ") || "—"}</TableCell>
                  <TableCell className="text-xs">
                    {a.delivery_ok == null ? "—" : a.delivery_ok ? "enviado" : `falhou${a.delivery_detail ? ` · ${a.delivery_detail}` : ""}`}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[380px] truncate" title={a.message}>
                    {a.message}
                  </TableCell>
                </TableRow>
              ))}
              {history.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Nenhum alerta disparado até agora.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default IntegrationHealthAlerts;
