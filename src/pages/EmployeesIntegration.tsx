import { useMemo, useState } from "react";
import { Loader2, Play, RefreshCw, Plus, Trash2, PlayCircle, FlaskConical, ArrowRight, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useCompanies } from "@/hooks/useCompanies";
import { useModuleAccess } from "@/hooks/usePermissions";
import {
  useEmployeeIntegrationConfigs,
  useEmployeeSyncExecutions,
  useEmployeeSyncItems,
  useSaveEmployeeConfig,
  useDeleteEmployeeConfig,
  runEmployeeSync,
  testJumpCloud,
  testSap,
  isTstCompanyDb,
  type EmployeeIntegrationConfig,
} from "@/hooks/useEmployeeIntegration";

const SCHEDULE_OPTIONS: Array<{ value: EmployeeIntegrationConfig["schedule_type"]; label: string }> = [
  { value: "manual", label: "Manual" },
  { value: "hourly", label: "A cada hora" },
  { value: "every_6h", label: "A cada 6 horas" },
  { value: "every_12h", label: "A cada 12 horas" },
  { value: "daily", label: "Diariamente" },
];

function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <Badge variant="secondary">—</Badge>;
  const map: Record<string, { label: string; className: string }> = {
    success: { label: "Sucesso", className: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" },
    partial: { label: "Parcial", className: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
    error: { label: "Erro", className: "bg-red-500/15 text-red-500 border-red-500/30" },
    running: { label: "Em andamento", className: "bg-blue-500/15 text-blue-500 border-blue-500/30" },
    cancelled: { label: "Cancelada", className: "bg-muted text-muted-foreground border-border" },
  };
  const m = map[status] ?? { label: status, className: "" };
  return <Badge variant="outline" className={m.className}>{m.label}</Badge>;
}

export default function EmployeesIntegration() {
  const { hasAccess, loading: accessLoading } = useModuleAccess("employee_integration");
  const { companies } = useCompanies();
  const configsQ = useEmployeeIntegrationConfigs();
  const saveMut = useSaveEmployeeConfig();
  const deleteMut = useDeleteEmployeeConfig();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<EmployeeIntegrationConfig | null>(null);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [runConfirm, setRunConfirm] = useState<{ id: string; mode: "execute" | "simulate" } | null>(null);
  const [running, setRunning] = useState(false);
  const [selectedExecId, setSelectedExecId] = useState<string | null>(null);

  const tstCompanies = useMemo(
    () => companies.filter((c) => isTstCompanyDb(c.company_db)),
    [companies],
  );

  if (accessLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="p-8 max-w-lg mx-auto text-center space-y-3">
        <AlertTriangle className="w-8 h-8 mx-auto text-amber-500" />
        <h2 className="text-lg font-semibold">Sem acesso</h2>
        <p className="text-sm text-muted-foreground">
          Esta tela é restrita ao grupo de gestão de integração de colaboradores.
        </p>
      </div>
    );
  }

  const currentConfig = configsQ.data?.find((c) => c.id === selectedConfigId) ?? null;

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Integração de Colaboradores</h1>
          <p className="text-sm text-muted-foreground">
            Sincroniza usuários do JumpCloud com o cadastro de colaboradores do SAP Business One.
            Nesta fase, apenas bases de teste (iniciadas por <code>TST</code>) podem ser processadas.
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setShowForm(true); }} className="gap-2">
          <Plus className="w-4 h-4" /> Nova integração
        </Button>
      </header>

      {configsQ.isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : !configsQ.data?.length ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Nenhuma integração de colaboradores configurada.
            {tstCompanies.length === 0 && (
              <p className="mt-2">
                Cadastre ao menos uma base cujo <code>CompanyDB</code> comece com <code>TST</code>.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {configsQ.data.map((c) => {
            const dbLabel = companies.find((x) => x.company_db === c.company_db)?.display_name ?? c.company_db;
            return (
              <Card key={c.id} className="border-border bg-card">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{c.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        Base: <span className="font-mono">{dbLabel}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={c.is_active ? "default" : "secondary"} className="text-[10px]">
                        {c.is_active ? "Ativa" : "Inativa"}
                      </Badge>
                      <StatusBadge status={c.last_execution_status} />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>Periodicidade: <b>{SCHEDULE_OPTIONS.find((s) => s.value === c.schedule_type)?.label}</b></span>
                    {c.last_execution_at && (
                      <span>· Última execução: {new Date(c.last_execution_at).toLocaleString("pt-BR")}</span>
                    )}
                  </div>
                  {c.last_execution_message && (
                    <p className="text-xs text-muted-foreground italic">{c.last_execution_message}</p>
                  )}
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                    <Button size="sm" variant="outline" onClick={() => { setEditing(c); setShowForm(true); }}>
                      Editar
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1"
                      onClick={() => setRunConfirm({ id: c.id, mode: "simulate" })}>
                      <FlaskConical className="w-3.5 h-3.5" /> Simular
                    </Button>
                    <Button size="sm" className="gap-1"
                      onClick={() => setRunConfirm({ id: c.id, mode: "execute" })}>
                      <PlayCircle className="w-3.5 h-3.5" /> Sincronizar agora
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setSelectedConfigId(c.id)}>
                      Ver histórico <ArrowRight className="w-3.5 h-3.5 ml-1" />
                    </Button>
                    <Button
                      size="sm" variant="ghost" className="text-red-500 hover:text-red-500"
                      onClick={async () => {
                        if (!confirm("Remover esta configuração de integração?")) return;
                        await deleteMut.mutateAsync(c.id);
                        toast.success("Integração removida");
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {selectedConfigId && (
        <ExecutionsSection
          configId={selectedConfigId}
          onOpenExecution={setSelectedExecId}
          onClose={() => setSelectedConfigId(null)}
        />
      )}

      {showForm && (
        <ConfigDialog
          initial={editing}
          companies={tstCompanies.map((c) => ({ company_db: c.company_db, display_name: c.display_name }))}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); configsQ.refetch(); }}
          saveMut={saveMut}
        />
      )}

      {runConfirm && currentConfigOrLookup(configsQ.data, runConfirm.id) && (
        <Dialog open onOpenChange={() => setRunConfirm(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {runConfirm.mode === "simulate" ? "Simular sincronização" : "Sincronizar agora"}
              </DialogTitle>
              <DialogDescription>
                Base SAP: <span className="font-mono">
                  {companies.find((x) => x.company_db === currentConfigOrLookup(configsQ.data, runConfirm.id)!.company_db)?.display_name
                    ?? currentConfigOrLookup(configsQ.data, runConfirm.id)!.company_db}
                </span>. Esta operação {runConfirm.mode === "simulate"
                  ? "apenas simulará"
                  : "criará ou atualizará"} colaboradores {runConfirm.mode === "simulate" ? "" : "no SAP."}.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRunConfirm(null)}>Cancelar</Button>
              <Button
                disabled={running}
                onClick={async () => {
                  try {
                    setRunning(true);
                    const res = await runEmployeeSync({ integration_config_id: runConfirm.id, mode: runConfirm.mode });
                    if (!res.ok) throw new Error(res.error || "Falha desconhecida");
                    toast.success(
                      `Concluído: ${res.total_created ?? 0} criados, ${res.total_updated ?? 0} atualizados, ${res.total_errors ?? 0} erros`,
                    );
                    setSelectedConfigId(runConfirm.id);
                    setRunConfirm(null);
                    configsQ.refetch();
                  } catch (e) {
                    toast.error((e as Error).message);
                  } finally {
                    setRunning(false);
                  }
                }}
              >
                {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 mr-1" />}
                {runConfirm.mode === "simulate" ? "Simular" : "Executar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {selectedExecId && (
        <ExecutionDetailDialog
          executionId={selectedExecId}
          onClose={() => setSelectedExecId(null)}
        />
      )}
    </div>
  );
}

function currentConfigOrLookup(list: EmployeeIntegrationConfig[] | undefined, id: string) {
  return list?.find((c) => c.id === id) ?? null;
}

function ConfigDialog({
  initial, companies, onClose, onSaved, saveMut,
}: {
  initial: EmployeeIntegrationConfig | null;
  companies: Array<{ company_db: string; display_name: string }>;
  onClose: () => void;
  onSaved: () => void;
  saveMut: ReturnType<typeof useSaveEmployeeConfig>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [companyDb, setCompanyDb] = useState(initial?.company_db ?? companies[0]?.company_db ?? "");
  const [orgId, setOrgId] = useState(initial?.jumpcloud_organization_id ?? "");
  const [schedule, setSchedule] = useState<EmployeeIntegrationConfig["schedule_type"]>(initial?.schedule_type ?? "manual");
  const [isActive, setIsActive] = useState(initial?.is_active ?? false);
  const [syncInactive, setSyncInactive] = useState(initial?.sync_inactive_users ?? true);
  const [syncManagers, setSyncManagers] = useState(initial?.sync_managers ?? true);
  const [defaultDept, setDefaultDept] = useState(initial?.default_department_code ?? "");
  const [defaultBranch, setDefaultBranch] = useState(initial?.default_branch_code ?? "");
  const [testing, setTesting] = useState<null | "jc" | "sap">(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function runTest(kind: "jc" | "sap") {
    if (!isTstCompanyDb(companyDb)) {
      toast.error("Selecione uma base cujo CompanyDB comece com TST.");
      return;
    }
    setTesting(kind);
    setTestResult(null);
    try {
      const res = kind === "jc" ? await testJumpCloud(companyDb) : await testSap(companyDb);
      if (kind === "jc") {
        setTestResult({
          ok: !!res.ok,
          msg: res.ok
            ? `JumpCloud: ${res.total} usuários (${res.active} ativos / ${res.suspended} suspensos)`
            : `JumpCloud falhou: ${res.error}`,
        });
      } else {
        if (res.ok) {
          setTestResult({ ok: true, msg: `SAP conectado. UDFs presentes: ${res.present?.join(", ")}` });
        } else if (res.missing?.length) {
          setTestResult({ ok: false, msg: `UDFs ausentes em OHEM: ${res.missing.join(", ")}` });
        } else {
          setTestResult({ ok: false, msg: `SAP falhou: ${res.error}` });
        }
      }
    } catch (e) {
      setTestResult({ ok: false, msg: (e as Error).message });
    } finally {
      setTesting(null);
    }
  }

  async function submit() {
    if (!name.trim()) return toast.error("Informe um nome.");
    if (!isTstCompanyDb(companyDb)) return toast.error("Base SAP deve começar com TST.");
    try {
      await saveMut.mutateAsync({
        id: initial?.id,
        name: name.trim(),
        company_db: companyDb,
        jumpcloud_organization_id: orgId.trim() || null,
        schedule_type: schedule,
        is_active: isActive,
        sync_inactive_users: syncInactive,
        sync_managers: syncManagers,
        default_department_code: defaultDept.trim() || null,
        default_branch_code: defaultBranch.trim() || null,
      });
      toast.success("Configuração salva");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar integração" : "Nova integração de colaboradores"}</DialogTitle>
          <DialogDescription>
            Credenciais do JumpCloud e do SAP são gravadas em <b>Credenciais</b> (systema
            <code> jumpcloud</code> e <code>sap</code>) para a mesma base.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1 md:col-span-2">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: JumpCloud → SAP (TST)" />
          </div>
          <div className="space-y-1">
            <Label>Base SAP (somente TST)</Label>
            <Select value={companyDb} onValueChange={setCompanyDb}>
              <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
              <SelectContent>
                {companies.length === 0 && (
                  <div className="p-3 text-xs text-muted-foreground">Nenhuma base TST cadastrada.</div>
                )}
                {companies.map((c) => (
                  <SelectItem key={c.company_db} value={c.company_db}>{c.display_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Organização JumpCloud (opcional)</Label>
            <Input value={orgId} onChange={(e) => setOrgId(e.target.value)} placeholder="org id" />
          </div>
          <div className="space-y-1">
            <Label>Periodicidade</Label>
            <Select value={schedule} onValueChange={(v) => setSchedule(v as EmployeeIntegrationConfig["schedule_type"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SCHEDULE_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Ativa</Label>
            <div className="h-10 flex items-center"><Switch checked={isActive} onCheckedChange={setIsActive} /></div>
          </div>
          <div className="space-y-1">
            <Label>Sincronizar suspensos</Label>
            <div className="h-10 flex items-center"><Switch checked={syncInactive} onCheckedChange={setSyncInactive} /></div>
          </div>
          <div className="space-y-1">
            <Label>Atualizar gestores</Label>
            <div className="h-10 flex items-center"><Switch checked={syncManagers} onCheckedChange={setSyncManagers} /></div>
          </div>
          <div className="space-y-1">
            <Label>Departamento SAP padrão (opcional)</Label>
            <Input value={defaultDept} onChange={(e) => setDefaultDept(e.target.value)} placeholder="ex.: 8" />
          </div>
          <div className="space-y-1">
            <Label>Filial padrão (opcional)</Label>
            <Input value={defaultBranch} onChange={(e) => setDefaultBranch(e.target.value)} placeholder="ex.: 1" />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-3 border-t border-border">
          <Button size="sm" variant="outline" disabled={testing !== null} onClick={() => runTest("jc")}>
            {testing === "jc" ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RefreshCw className="w-4 h-4 mr-1" />}
            Testar JumpCloud
          </Button>
          <Button size="sm" variant="outline" disabled={testing !== null} onClick={() => runTest("sap")}>
            {testing === "sap" ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RefreshCw className="w-4 h-4 mr-1" />}
            Testar SAP
          </Button>
          {testResult && (
            <div className={`flex items-center gap-1 text-xs ${testResult.ok ? "text-emerald-500" : "text-red-500"}`}>
              {testResult.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              {testResult.msg}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={saveMut.isPending} onClick={submit}>
            {saveMut.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExecutionsSection({
  configId, onClose, onOpenExecution,
}: {
  configId: string;
  onClose: () => void;
  onOpenExecution: (id: string) => void;
}) {
  const q = useEmployeeSyncExecutions(configId);
  return (
    <Card className="border-border">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Histórico de execuções</h3>
          <Button size="sm" variant="ghost" onClick={onClose}>Fechar</Button>
        </div>
        {q.isLoading ? (
          <div className="py-8 flex justify-center"><Loader2 className="w-4 h-4 animate-spin" /></div>
        ) : !q.data?.length ? (
          <p className="text-xs text-muted-foreground italic">Nenhuma execução registrada.</p>
        ) : (
          <div className="overflow-x-auto text-xs">
            <table className="w-full">
              <thead className="text-muted-foreground text-left">
                <tr>
                  <th className="py-1 pr-2">Data</th>
                  <th className="py-1 pr-2">Tipo</th>
                  <th className="py-1 pr-2">Status</th>
                  <th className="py-1 pr-2 text-right">Origem</th>
                  <th className="py-1 pr-2 text-right">Criados</th>
                  <th className="py-1 pr-2 text-right">Atualizados</th>
                  <th className="py-1 pr-2 text-right">Sem alt.</th>
                  <th className="py-1 pr-2 text-right">Inativados</th>
                  <th className="py-1 pr-2 text-right">Pendentes</th>
                  <th className="py-1 pr-2 text-right">Erros</th>
                  <th className="py-1 pr-2"></th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((e) => (
                  <tr key={e.id} className="border-t border-border">
                    <td className="py-1 pr-2">{new Date(e.started_at).toLocaleString("pt-BR")}</td>
                    <td className="py-1 pr-2">{e.execution_type}</td>
                    <td className="py-1 pr-2"><StatusBadge status={e.status} /></td>
                    <td className="py-1 pr-2 text-right">{e.total_source}</td>
                    <td className="py-1 pr-2 text-right">{e.total_created}</td>
                    <td className="py-1 pr-2 text-right">{e.total_updated}</td>
                    <td className="py-1 pr-2 text-right">{e.total_unchanged}</td>
                    <td className="py-1 pr-2 text-right">{e.total_inactivated}</td>
                    <td className="py-1 pr-2 text-right">{e.total_pending}</td>
                    <td className="py-1 pr-2 text-right">{e.total_errors}</td>
                    <td className="py-1 pr-2">
                      <Button size="sm" variant="ghost" onClick={() => onOpenExecution(e.id)}>Abrir</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ExecutionDetailDialog({ executionId, onClose }: { executionId: string; onClose: () => void }) {
  const q = useEmployeeSyncItems(executionId);
  const [filter, setFilter] = useState<string>("all");
  const items = (q.data ?? []).filter((i) => filter === "all" ? true : i.result === filter);
  const grouped = new Map<string, number>();
  for (const i of (q.data ?? [])) grouped.set(i.result, (grouped.get(i.result) ?? 0) + 1);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Detalhes da execução</DialogTitle>
          <DialogDescription>
            {Array.from(grouped.entries()).map(([k, v]) => `${k}: ${v}`).join(" · ")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2 py-2 border-b border-border">
          {["all", ...Array.from(grouped.keys())].map((k) => (
            <Badge
              key={k}
              variant={filter === k ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setFilter(k)}
            >
              {k === "all" ? "Todos" : k} {k !== "all" && `(${grouped.get(k)})`}
            </Badge>
          ))}
        </div>
        <div className="overflow-auto text-xs flex-1">
          {q.isLoading ? (
            <div className="py-8 flex justify-center"><Loader2 className="w-4 h-4 animate-spin" /></div>
          ) : (
            <table className="w-full">
              <thead className="text-muted-foreground text-left sticky top-0 bg-background">
                <tr>
                  <th className="py-1 pr-2">Nome</th>
                  <th className="py-1 pr-2">E-mail</th>
                  <th className="py-1 pr-2">JC ID</th>
                  <th className="py-1 pr-2">SAP ID</th>
                  <th className="py-1 pr-2">Depto</th>
                  <th className="py-1 pr-2">Resultado</th>
                  <th className="py-1 pr-2">Mensagem</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="border-t border-border">
                    <td className="py-1 pr-2">{i.employee_name}</td>
                    <td className="py-1 pr-2">{i.employee_email}</td>
                    <td className="py-1 pr-2 font-mono">{i.jumpcloud_user_id?.slice(-8)}</td>
                    <td className="py-1 pr-2">{i.sap_employee_id ?? "—"}</td>
                    <td className="py-1 pr-2">
                      {i.department_source}
                      {i.department_target ? ` → ${i.department_target}` : ""}
                    </td>
                    <td className="py-1 pr-2"><Badge variant="outline">{i.result}</Badge></td>
                    <td className="py-1 pr-2 max-w-md truncate" title={i.message ?? ""}>{i.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
