import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSap } from "@/contexts/SapContext";
import {
  ArrowLeft,
  Zap,
  Play,
  Settings2,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Power,
  PowerOff,
  AlertCircle,
  History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  useSynapseIntegrations,
  type SynapseIntegration,
} from "@/hooks/useSynapseIntegrations";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import { useCompanies } from "@/hooks/useCompanies";

export default function SynapsePage() {
  const navigate = useNavigate();
  const { session } = useSap();
  const { getLabel } = useCompanies(true);
  const companyDB = session?.companyDB || "";
  const companyLabel = getLabel(companyDB);

  const {
    integrations,
    logs,
    isLoading,
    isRunning,
    fetchIntegrations,
    fetchLogs,
    updateIntegration,
    ensureIntegration,
    runNow,
  } = useSynapseIntegrations(companyDB || undefined);

  const [configOpen, setConfigOpen] = useState(false);
  const [selectedIntegration, setSelectedIntegration] = useState<SynapseIntegration | null>(null);
  const [formParams, setFormParams] = useState<Record<string, string>>({});
  const [formInterval, setFormInterval] = useState(360);
  const [formActive, setFormActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [poNotifs, setPoNotifs] = useState<Array<{
    id: string; sent_at: string; po_doc_num: number | null; po_doc_entry: number;
    milestone: string; recipient_email: string | null; status: string;
    error_message: string | null; email_html: string | null; email_subject: string | null;
  }>>([]);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState<string>("");

  useEffect(() => {
    if (companyDB) {
      ensureIntegration(companyDB).then(() => fetchIntegrations());
    }
  }, [companyDB, ensureIntegration, fetchIntegrations]);

  const openConfig = async (integration: SynapseIntegration) => {
    setSelectedIntegration(integration);
    setFormParams(
      Object.fromEntries(
        Object.entries(integration.parameters || {}).map(([k, v]) => [k, String(v ?? "")])
      )
    );
    setFormInterval(integration.interval_minutes);
    setFormActive(integration.is_active);
    fetchLogs(integration.integration_key);
    setPoNotifs([]);
    if (integration.integration_key === "purchase_order_notifications" && integration.company_db) {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase
        .from("po_notification_sent")
        .select("id, sent_at, po_doc_num, po_doc_entry, milestone, recipient_email, status, error_message, email_html, email_subject")
        .eq("company_db", integration.company_db)
        .order("sent_at", { ascending: false })
        .limit(30);
      setPoNotifs((data as any) || []);
    }
    setConfigOpen(true);
  };

  const handleSave = async () => {
    if (!selectedIntegration) return;
    setSaving(true);
    try {
      const params: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(formParams)) {
        if (v === "true") params[k] = true;
        else if (v === "false") params[k] = false;
        else params[k] = v;
      }
      await updateIntegration(selectedIntegration.id, {
        is_active: formActive,
        interval_minutes: formInterval,
        parameters: params,
      } as any);
      toast.success("Configuração salva");
      setConfigOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const handleRun = async (integration: SynapseIntegration) => {
    try {
      const result = await runNow(integration.integration_key, integration.company_db || undefined);
      toast.success(result.message || "Execução concluída");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro na execução");
    }
  };

  const statusIcon = (status: string | null) => {
    if (status === "success") return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    if (status === "error") return <XCircle className="w-4 h-4 text-destructive" />;
    return <Clock className="w-4 h-4 text-muted-foreground" />;
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-primary/10">
                <Zap className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground">Synapse</h1>
                <p className="text-sm text-muted-foreground">
                  Central de automações e integrações
                  {companyLabel && <span className="ml-1">— {companyLabel}</span>}
                </p>
              </div>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {!session && (
          <div className="p-6 rounded-xl border border-border bg-card text-center space-y-2">
            <AlertCircle className="w-8 h-8 text-yellow-500 mx-auto" />
            <p className="text-foreground font-medium">Sessão SAP não iniciada</p>
            <p className="text-sm text-muted-foreground">
              Faça login no SAP Business One para gerenciar as integrações.
            </p>
            <Button variant="outline" size="sm" onClick={() => navigate("/")} className="mt-2">
              Ir para Login
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {integrations.map((integration) => (
              <div
                key={integration.id}
                className="rounded-xl border border-border bg-card p-6 space-y-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`p-2 rounded-lg ${
                        integration.is_active
                          ? "bg-green-500/10 text-green-500"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {integration.is_active ? (
                        <Power className="w-5 h-5" />
                      ) : (
                        <PowerOff className="w-5 h-5" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-lg font-semibold text-foreground">
                        {integration.display_name}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {integration.description}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {integration.integration_key === "pagcorp_erp_sync" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => navigate("/pagcorp/history")}
                      >
                        <History className="w-4 h-4" />
                        Histórico
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => handleRun(integration)}
                      disabled={isRunning || !integration.is_active}
                    >
                      {isRunning ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                      Executar
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openConfig(integration)}
                      title="Configurações"
                    >
                      <Settings2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {/* Status row */}
                <div className="flex items-center gap-6 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Status:</span>
                    <span
                      className={`font-medium ${
                        integration.is_active ? "text-green-500" : "text-muted-foreground"
                      }`}
                    >
                      {integration.is_active ? "Ativo" : "Inativo"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Intervalo:</span>
                    <span className="text-foreground">{integration.interval_minutes} min</span>
                  </div>
                  {integration.last_run_at && (
                    <div className="flex items-center gap-2">
                      {statusIcon(integration.last_run_status)}
                      <span className="text-muted-foreground">Última execução:</span>
                      <span className="text-foreground">
                        {format(new Date(integration.last_run_at), "dd/MM HH:mm", {
                          locale: ptBR,
                        })}
                      </span>
                      {integration.last_run_message && (
                        <span className="text-muted-foreground text-xs">
                          — {integration.last_run_message}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Config Dialog */}
      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="w-5 h-5" />
              {selectedIntegration?.display_name}
            </DialogTitle>
            <DialogDescription>
              Configure os parâmetros desta integração
              {selectedIntegration?.company_db && (
                <span className="ml-1">
                  — {getLabel(selectedIntegration.company_db)}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between">
              <Label>Integração ativa</Label>
              <Switch checked={formActive} onCheckedChange={setFormActive} />
            </div>

            <div className="space-y-1">
              <Label>Intervalo de execução (minutos)</Label>
              <Input
                type="number"
                min={30}
                value={formInterval}
                onChange={(e) => setFormInterval(Number(e.target.value))}
                className="bg-card"
              />
            </div>

            {Object.keys(formParams).length > 0 && (
              <div className="border-t border-border pt-4 space-y-3">
                <p className="text-sm font-medium text-foreground">Parâmetros</p>
                {Object.entries(formParams).map(([key, value]) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-xs text-muted-foreground capitalize">
                      {key.replace(/_/g, " ")}
                    </Label>
                    {value === "true" || value === "false" ? (
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={value === "true"}
                          onCheckedChange={(checked) =>
                            setFormParams((p) => ({ ...p, [key]: String(checked) }))
                          }
                        />
                        <span className="text-sm text-muted-foreground">
                          {value === "true" ? "Sim" : "Não"}
                        </span>
                      </div>
                    ) : (
                      <Input
                        value={value}
                        onChange={(e) =>
                          setFormParams((p) => ({ ...p, [key]: e.target.value }))
                        }
                        className="bg-card"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Recent logs */}
            {logs.length > 0 && (
              <div className="border-t border-border pt-4 space-y-2">
                <p className="text-sm font-medium text-foreground">Últimas execuções</p>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {logs.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-center gap-2 text-xs py-1 px-2 rounded bg-muted/30"
                    >
                      {statusIcon(log.status)}
                      <span className="text-muted-foreground">
                        {format(new Date(log.created_at), "dd/MM HH:mm")}
                      </span>
                      <span className="text-foreground">
                        {log.affected_count} afetados
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
