import { NotificationAuditTrail } from "@/components/NotificationAuditTrail";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useMyCapabilities } from "@/hooks/useMyCapabilities";
import { useSap } from "@/contexts/SapContext";
import { PageTitle } from "@/components/PageTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { displayUserName } from "@/lib/user-display";

interface GovernanceRule {
  id: string;
  company_db: string | null;
  exclude_test_companies: boolean;
  block_self_approval: boolean;
  notify_requester: boolean;
  extra_recipients: string[];
  blocked_recipients: string[];
  enabled: boolean;
  updated_by: string | null;
  updated_at: string;
}

interface CompanyRow {
  company_db: string;
  display_name: string | null;
  is_test: boolean | null;
}

interface SendRun {
  id: string;
  function_name: string;
  status: string;
  recipients_count: number | null;
  error_message: string | null;
  sent_at: string;
}

const statusTone: Record<string, string> = {
  success: "text-emerald-500",
  ok: "text-emerald-500",
  error: "text-destructive",
  failed: "text-destructive",
  skipped: "text-muted-foreground",
};

/** Editor de lista de destinatários (chips). */
function RecipientList({
  values,
  onChange,
  placeholder,
  disabled,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const value = draft.trim();
    if (!value) return;
    if (values.some((v) => v.toLowerCase() === value.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...values, value]);
    setDraft("");
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
        />
        <Button type="button" variant="outline" size="icon" onClick={add} disabled={disabled} aria-label="Adicionar destinatário">
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {values.length === 0 && <span className="text-xs text-muted-foreground">Nenhum destinatário.</span>}
        {values.map((v) => (
          <Badge key={v} variant="secondary" className="gap-1">
            {displayUserName(v, v)}
            <button
              type="button"
              onClick={() => onChange(values.filter((x) => x !== v))}
              disabled={disabled}
              aria-label={`Remover ${v}`}
              className="hover:text-destructive"
            >
              <X className="w-3 h-3" />
            </button>
          </Badge>
        ))}
      </div>
    </div>
  );
}

export default function NotificationGovernancePage() {
  const navigate = useNavigate();
  const { session } = useSap();
  const { isPrivileged, loading: capLoading } = useMyCapabilities();

  const [rules, setRules] = useState<GovernanceRule[]>([]);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [runs, setRuns] = useState<SendRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newCompany, setNewCompany] = useState<string>("");
  const [live, setLive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: govData, error: govErr }, { data: compData }, { data: runData }] = await Promise.all([
        supabase.from("notification_governance").select("*").order("company_db", { nullsFirst: true }),
        supabase.from("companies").select("company_db, display_name, is_test").order("display_name"),
        supabase
          .from("notification_send_runs")
          .select("id, function_name, status, recipients_count, error_message, sent_at")
          .order("sent_at", { ascending: false })
          .limit(25),
      ]);
      if (govErr) throw govErr;
      const rows = (govData as GovernanceRule[]) || [];
      setRules(rows);
      setCompanies((compData as CompanyRow[]) || []);
      setRuns((runData as SendRun[]) || []);
      setSelectedId((prev) => prev ?? rows[0]?.id ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar regras");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Status em tempo real: execuções de notificação + mudanças nas regras.
  useEffect(() => {
    const channel = supabase
      .channel("notification-governance")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notification_send_runs" },
        (payload) => setRuns((prev) => [payload.new as SendRun, ...prev].slice(0, 25)),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notification_governance" },
        (payload) => {
          const row = payload.new as GovernanceRule | undefined;
          if (payload.eventType === "DELETE") {
            const old = payload.old as { id?: string };
            setRules((prev) => prev.filter((r) => r.id !== old?.id));
            return;
          }
          if (!row) return;
          setRules((prev) => {
            const exists = prev.some((r) => r.id === row.id);
            return exists ? prev.map((r) => (r.id === row.id ? row : r)) : [...prev, row];
          });
        },
      )
      .subscribe((status) => setLive(status === "SUBSCRIBED"));

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const companyLabel = useCallback(
    (db: string | null) => {
      if (!db) return "Regra global (todas as empresas)";
      return companies.find((c) => c.company_db === db)?.display_name || db;
    },
    [companies],
  );

  const selected = useMemo(() => rules.find((r) => r.id === selectedId) || null, [rules, selectedId]);

  const patch = (id: string, changes: Partial<GovernanceRule>) =>
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...changes } : r)));

  const save = async (rule: GovernanceRule) => {
    setSaving(rule.id);
    try {
      const { error } = await supabase
        .from("notification_governance")
        .update({
          exclude_test_companies: rule.exclude_test_companies,
          block_self_approval: rule.block_self_approval,
          notify_requester: rule.notify_requester,
          extra_recipients: rule.extra_recipients,
          blocked_recipients: rule.blocked_recipients,
          enabled: rule.enabled,
          updated_by: session?.userName || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", rule.id);
      if (error) throw error;
      toast.success("Regras salvas");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setSaving(null);
    }
  };

  const addCompanyRule = async () => {
    if (!newCompany) return;
    try {
      const { data, error } = await supabase
        .from("notification_governance")
        .insert({ company_db: newCompany, updated_by: session?.userName || null })
        .select()
        .single();
      if (error) throw error;
      setNewCompany("");
      setSelectedId((data as GovernanceRule).id);
      toast.success("Regra por empresa criada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao criar regra");
    }
  };

  const removeRule = async (rule: GovernanceRule) => {
    if (!rule.company_db) return;
    try {
      const { error } = await supabase.from("notification_governance").delete().eq("id", rule.id);
      if (error) throw error;
      setSelectedId(rules.find((r) => !r.company_db)?.id ?? null);
      toast.success("Regra removida");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover");
    }
  };

  const availableCompanies = companies.filter((c) => !rules.some((r) => r.company_db === c.company_db));

  return (
    <div className="min-h-screen bg-background">
      <PageTitle title="Regras de notificação" />
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <button
            onClick={() => navigate("/notificacoes")}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
            aria-label="Voltar"
          >
            <ArrowLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-bold text-foreground">Regras de envio de notificações</h1>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={`w-2 h-2 rounded-full ${live ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/50"}`} />
              {live ? "Tempo real ativo" : "Conectando…"}
            </span>
            <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Atualizar
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        {capLoading ? (
          <div className="glass-card p-8 text-center text-muted-foreground">Carregando…</div>
        ) : !isPrivileged ? (
          <div className="glass-card p-8 text-center space-y-2">
            <ShieldAlert className="w-6 h-6 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Somente administradores podem configurar as regras de notificação.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
              <div className="space-y-3">
                <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
                  {rules.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setSelectedId(r.id)}
                      className={`w-full text-left px-3 py-3 hover:bg-muted/50 transition-colors ${
                        r.id === selectedId ? "bg-primary/5" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">{companyLabel(r.company_db)}</span>
                        {!r.enabled && (
                          <Badge variant="secondary" className="text-[10px]">
                            off
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {r.company_db ? "Override por empresa" : "Aplicada quando não há override"}
                      </p>
                    </button>
                  ))}
                  {rules.length === 0 && !loading && (
                    <div className="p-6 text-center text-sm text-muted-foreground">Nenhuma regra.</div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Adicionar regra por empresa</Label>
                  <div className="flex gap-2">
                    <Select value={newCompany} onValueChange={setNewCompany}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione a empresa" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableCompanies.map((c) => (
                          <SelectItem key={c.company_db} value={c.company_db}>
                            {c.display_name || c.company_db}
                            {c.is_test ? " (teste)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="outline" size="icon" onClick={addCompanyRule} disabled={!newCompany} aria-label="Criar regra">
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>

              {selected ? (
                <div className="glass-card p-5 space-y-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-semibold text-foreground">{companyLabel(selected.company_db)}</h2>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Atualizado{" "}
                        {formatDistanceToNow(new Date(selected.updated_at), { addSuffix: true, locale: ptBR })}
                        {selected.updated_by ? ` por ${displayUserName(selected.updated_by)}` : ""}
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

                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-foreground">Excluir bases de teste</p>
                        <p className="text-xs text-muted-foreground">
                          Nenhuma notificação externa sai de empresas marcadas como teste.
                        </p>
                      </div>
                      <Switch
                        checked={selected.exclude_test_companies}
                        onCheckedChange={(v) => patch(selected.id, { exclude_test_companies: v })}
                      />
                    </div>

                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-foreground">Bloquear autoaprovação</p>
                        <p className="text-xs text-muted-foreground">
                          Não cobra aprovação de quem é o próprio solicitante do documento.
                        </p>
                      </div>
                      <Switch
                        checked={selected.block_self_approval}
                        onCheckedChange={(v) => patch(selected.id, { block_self_approval: v })}
                      />
                    </div>

                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-foreground">Notificar o solicitante</p>
                        <p className="text-xs text-muted-foreground">
                          Envia cópia dos lembretes de vencimento também para quem abriu o documento.
                        </p>
                      </div>
                      <Switch
                        checked={selected.notify_requester}
                        onCheckedChange={(v) => patch(selected.id, { notify_requester: v })}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">Destinatários adicionais</Label>
                    <p className="text-xs text-muted-foreground">
                      Recebem cópia dos avisos (nome de usuário ou e-mail corporativo).
                    </p>
                    <RecipientList
                      values={selected.extra_recipients || []}
                      onChange={(next) => patch(selected.id, { extra_recipients: next })}
                      placeholder="ex.: matheus.moreira@anagaming.com.br"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">Destinatários bloqueados</Label>
                    <p className="text-xs text-muted-foreground">Nunca recebem notificações, mesmo se forem aprovadores.</p>
                    <RecipientList
                      values={selected.blocked_recipients || []}
                      onChange={(next) => patch(selected.id, { blocked_recipients: next })}
                      placeholder="ex.: usuario.antigo@empresa.com.br"
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <Button onClick={() => save(selected)} disabled={saving === selected.id} className="gap-2">
                      {saving === selected.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      Salvar regras
                    </Button>
                    {selected.company_db && (
                      <Button variant="ghost" className="gap-2 text-destructive" onClick={() => removeRule(selected)}>
                        <Trash2 className="w-4 h-4" /> Remover override
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="glass-card p-8 text-center text-muted-foreground">
                  Selecione uma regra para editar.
                </div>
              )}
            </div>

            <NotificationChannelSettings companies={companies} canEdit={isPrivileged} />

            <section className="glass-card p-5">

              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-base font-semibold text-foreground">Status em tempo real</h2>
                  <p className="text-xs text-muted-foreground">Últimas execuções dos disparos de notificação.</p>
                </div>
              </div>
              <ScrollArea className="h-72">
                <div className="divide-y divide-border">
                  {runs.map((run) => (
                    <div key={run.id} className="py-2.5 flex items-center gap-3">
                      <span className={`text-xs font-semibold w-20 ${statusTone[run.status] || "text-muted-foreground"}`}>
                        {run.status}
                      </span>
                      <span className="text-sm text-foreground flex-1 truncate">{run.function_name}</span>
                      <span className="text-xs text-muted-foreground w-28 text-right">
                        {run.recipients_count ?? 0} destinatário(s)
                      </span>
                      <span className="text-xs text-muted-foreground/70 w-32 text-right">
                        {formatDistanceToNow(new Date(run.sent_at), { addSuffix: true, locale: ptBR })}
                      </span>
                    </div>
                  ))}
                  {runs.length === 0 && (
                    <div className="py-10 text-center text-sm text-muted-foreground">
                      Nenhuma execução registrada ainda.
                    </div>
                  )}
                </div>
              </ScrollArea>
            </section>

            <section className="glass-card p-5">
              <h2 className="text-base font-semibold">Trilha de auditoria de notificações</h2>
              <p className="text-xs text-muted-foreground mt-1 mb-3">
                Por documento: quem recebeu o aviso, em qual canal e por qual regra/matriz foi resolvido
                como aprovador atual.
              </p>
              <NotificationAuditTrail limit={50} />
            </section>
          </>

        )}
      </main>
    </div>
  );
}
