import { useCallback, useEffect, useMemo, useState } from "react";
import { AlarmClock, Loader2, Plus, RefreshCw, Play, Save, Trash2 } from "lucide-react";
import { BackofficePageHeader } from "@/components/BackofficePageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SlaSettings {
  id: string;
  company_db: string | null;
  enabled: boolean;
  sla_business_hours: number;
  repeat_business_hours: number;
  prefer_substitute: boolean;
  escalate_to_next_level: boolean;
  fallback_email: string | null;
  max_escalations: number;
  notify_in_app: boolean;
  notify_email: boolean;
}

interface Escalation {
  id: string;
  expense_id: string;
  company_db: string | null;
  doc_num: string | null;
  doc_type: string | null;
  supplier_name: string | null;
  total_amount: number | null;
  currency: string | null;
  from_approver: string | null;
  to_approver: string | null;
  target_kind: string;
  level_from: number | null;
  level_to: number | null;
  pending_since: string | null;
  sla_deadline: string | null;
  escalation_index: number;
  created_at: string;
}

const KIND_LABEL: Record<string, string> = {
  substitute: "Substituto vigente",
  next_level: "Nível superior",
  fallback: "E-mail de contingência",
};

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleString("pt-BR") : "—");
const fmtMoney = (v: number | null, c: string | null) =>
  typeof v === "number"
    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: c || "BRL" }).format(v)
    : "—";

export default function SlaEscalation() {
  const [settings, setSettings] = useState<SlaSettings[]>([]);
  const [history, setHistory] = useState<Escalation[]>([]);
  const [companies, setCompanies] = useState<{ company_db: string; display_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [newCompany, setNewCompany] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: s }, { data: h }, { data: c }] = await Promise.all([
      supabase.from("sla_escalation_settings").select("*").order("company_db", { nullsFirst: true }),
      supabase.from("sla_escalations").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("companies").select("company_db, display_name").eq("is_active", true).order("display_name"),
    ]);
    setSettings((s || []) as SlaSettings[]);
    setHistory((h || []) as Escalation[]);
    setCompanies((c || []) as { company_db: string; display_name: string }[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const availableCompanies = useMemo(
    () => companies.filter((c) => !settings.some((s) => s.company_db === c.company_db)),
    [companies, settings],
  );

  const patch = (id: string, changes: Partial<SlaSettings>) =>
    setSettings((prev) => prev.map((s) => (s.id === id ? { ...s, ...changes } : s)));

  const save = async (row: SlaSettings) => {
    setSavingId(row.id);
    const { error } = await supabase
      .from("sla_escalation_settings")
      .update({
        enabled: row.enabled,
        sla_business_hours: Number(row.sla_business_hours) || 48,
        repeat_business_hours: Number(row.repeat_business_hours) || 24,
        prefer_substitute: row.prefer_substitute,
        escalate_to_next_level: row.escalate_to_next_level,
        fallback_email: row.fallback_email?.trim() || null,
        max_escalations: Number(row.max_escalations) || 1,
        notify_in_app: row.notify_in_app,
        notify_email: row.notify_email,
      })
      .eq("id", row.id);
    setSavingId(null);
    if (error) toast.error(`Falha ao salvar: ${error.message}`);
    else toast.success("Configuração salva.");
  };

  const addCompany = async () => {
    if (!newCompany) return;
    const { error } = await supabase
      .from("sla_escalation_settings")
      .insert({ company_db: newCompany, enabled: false });
    if (error) return toast.error(`Falha ao criar: ${error.message}`);
    setNewCompany("");
    await load();
  };

  const removeRow = async (row: SlaSettings) => {
    if (!row.company_db) return;
    const { error } = await supabase.from("sla_escalation_settings").delete().eq("id", row.id);
    if (error) return toast.error(`Falha ao excluir: ${error.message}`);
    await load();
  };

  const run = async (dryRun: boolean) => {
    setRunning(true);
    const { data, error } = await supabase.functions.invoke("sla-escalation-dispatch", {
      body: { dry_run: dryRun },
    });
    setRunning(false);
    if (error) return toast.error(`Falha na execução: ${error.message}`);
    const res = data as { scanned?: number; escalated?: number };
    toast.success(
      `${dryRun ? "Simulação" : "Execução"} concluída — ${res?.scanned ?? 0} documentos avaliados, ${res?.escalated ?? 0} escalonados.`,
    );
    if (!dryRun) await load();
  };

  return (
    <div className="min-h-screen bg-background">
      <BackofficePageHeader
        title="Escalonamento por SLA"
        description="Documentos parados além do prazo sobem automaticamente para o substituto vigente ou para o nível superior, com registro em auditoria."
        icon={<AlarmClock className="w-5 h-5" />}
      />

      <div className="container mx-auto px-4 py-6 space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button variant="outline" size="sm" onClick={() => void run(true)} disabled={running}>
            {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            Simular agora
          </Button>
          <Button size="sm" onClick={() => void run(false)} disabled={running}>
            {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <AlarmClock className="w-4 h-4 mr-2" />}
            Executar escalonamento
          </Button>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">Regras de SLA</CardTitle>
            <div className="flex items-center gap-2">
              <Select value={newCompany} onValueChange={setNewCompany}>
                <SelectTrigger className="w-56 h-9">
                  <SelectValue placeholder="Adicionar empresa..." />
                </SelectTrigger>
                <SelectContent>
                  {availableCompanies.map((c) => (
                    <SelectItem key={c.company_db} value={c.company_db}>
                      {c.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={() => void addCompany()} disabled={!newCompany}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading && settings.length === 0 && (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            )}
            {settings.map((row) => (
              <div key={row.id} className="rounded-lg border border-border p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline">
                      {row.company_db
                        ? companies.find((c) => c.company_db === row.company_db)?.display_name || row.company_db
                        : "Padrão (todas as empresas)"}
                    </Badge>
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`enabled-${row.id}`}
                        checked={row.enabled}
                        onCheckedChange={(v) => patch(row.id, { enabled: v })}
                      />
                      <Label htmlFor={`enabled-${row.id}`} className="text-sm">
                        Ativo
                      </Label>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={() => void save(row)} disabled={savingId === row.id}>
                      {savingId === row.id ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4 mr-2" />
                      )}
                      Salvar
                    </Button>
                    {row.company_db && (
                      <Button size="icon" variant="ghost" onClick={() => void removeRow(row)} aria-label="Excluir regra">
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-1">
                    <Label className="text-xs">Prazo (horas úteis)</Label>
                    <Input
                      type="number"
                      min={1}
                      value={row.sla_business_hours}
                      onChange={(e) => patch(row.id, { sla_business_hours: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Reescalonar a cada (h úteis)</Label>
                    <Input
                      type="number"
                      min={1}
                      value={row.repeat_business_hours}
                      onChange={(e) => patch(row.id, { repeat_business_hours: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Máx. escalonamentos</Label>
                    <Input
                      type="number"
                      min={1}
                      value={row.max_escalations}
                      onChange={(e) => patch(row.id, { max_escalations: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">E-mail de contingência</Label>
                    <Input
                      type="email"
                      placeholder="opcional"
                      value={row.fallback_email || ""}
                      onChange={(e) => patch(row.id, { fallback_email: e.target.value })}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-6">
                  {[
                    { key: "prefer_substitute" as const, label: "Priorizar substituto vigente" },
                    { key: "escalate_to_next_level" as const, label: "Subir para o nível superior" },
                    { key: "notify_in_app" as const, label: "Avisar no sino" },
                    { key: "notify_email" as const, label: "Avisar por e-mail" },
                  ].map((f) => (
                    <div key={f.key} className="flex items-center gap-2">
                      <Switch
                        id={`${f.key}-${row.id}`}
                        checked={row[f.key]}
                        onCheckedChange={(v) => patch(row.id, { [f.key]: v } as Partial<SlaSettings>)}
                      />
                      <Label htmlFor={`${f.key}-${row.id}`} className="text-sm">
                        {f.label}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Histórico de escalonamentos</CardTitle>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum escalonamento automático registrado até o momento.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-muted-foreground">
                      <th className="py-2 pr-4">Quando</th>
                      <th className="py-2 pr-4">Empresa</th>
                      <th className="py-2 pr-4">Documento</th>
                      <th className="py-2 pr-4">Valor</th>
                      <th className="py-2 pr-4">De</th>
                      <th className="py-2 pr-4">Para</th>
                      <th className="py-2 pr-4">Motivo</th>
                      <th className="py-2 pr-4">Prazo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id} className="border-t border-border/60">
                        <td className="py-2 pr-4 whitespace-nowrap">{fmtDate(h.created_at)}</td>
                        <td className="py-2 pr-4">{h.company_db || "—"}</td>
                        <td className="py-2 pr-4">
                          {h.doc_num ? `#${h.doc_num}` : "—"}
                          <span className="block text-xs text-muted-foreground">{h.supplier_name || ""}</span>
                        </td>
                        <td className="py-2 pr-4 whitespace-nowrap">{fmtMoney(h.total_amount, h.currency)}</td>
                        <td className="py-2 pr-4">{h.from_approver || "—"}</td>
                        <td className="py-2 pr-4">
                          {h.to_approver || "—"}
                          {h.level_to ? (
                            <span className="block text-xs text-muted-foreground">nível {h.level_to}</span>
                          ) : null}
                        </td>
                        <td className="py-2 pr-4">
                          <Badge variant="outline">{KIND_LABEL[h.target_kind] || h.target_kind}</Badge>
                        </td>
                        <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">
                          {fmtDate(h.sla_deadline)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
