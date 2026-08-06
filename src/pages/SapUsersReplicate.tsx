import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Copy, CheckCircle2, XCircle, AlertTriangle, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { KeyRound, RefreshCw, Eye, EyeOff } from "lucide-react";
import { generateStrongPassword, checkPasswordPolicy } from "@/lib/password-policy";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { SapCompanyOption } from "@/hooks/useSapUsersAdmin";
import { PageTitle } from "@/components/PageTitle";
import { BackofficePageHeader } from "@/components/BackofficePageHeader";

interface SourceUser {
  code: string;
  name: string;
  email?: string;
  superuser?: boolean;
  locked?: boolean;
  sources: string[];
}

type PasswordMode = "shared-auto" | "shared-manual" | "individual";

interface ReplicateResult {
  total_source_users: number;
  created: string[];
  created_details?: { code: string; name: string; email?: string; password: string }[];
  skipped: { code: string; reason: string }[];
  failed: { code: string; error: string }[];
  source_errors: { db: string; error: string }[];
}

interface TargetResult {
  target_db: string;
  result?: ReplicateResult;
  error?: string;
}

export default function SapUsersReplicate() {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState<SapCompanyOption[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [sourceDbs, setSourceDbs] = useState<string[]>([]);
  const [targetDbs, setTargetDbs] = useState<string[]>([]);
  const [defaultPassword, setDefaultPassword] = useState(() => generateStrongPassword(16));
  const [passwordMode, setPasswordMode] = useState<PasswordMode>("shared-auto");
  const [showPassword, setShowPassword] = useState(false);
  const [sendCredentials, setSendCredentials] = useState(true);
  const [sourceUsers, setSourceUsers] = useState<SourceUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "all">("active");
  const [includeSuperusers, setIncludeSuperusers] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<TargetResult[] | null>(null);
  const [resultsOpen, setResultsOpen] = useState(false);

  useEffect(() => {
    (async () => {
      setLoadingCompanies(true);
      const { data, error } = await supabase.functions.invoke("sap-users-admin", {
        body: { action: "list_companies" },
      });
      if (error) toast.error("Erro ao carregar empresas");
      else setCompanies((data as { companies: SapCompanyOption[] })?.companies || []);
      setLoadingCompanies(false);
    })();
  }, []);

  const targetOptions = useMemo(
    () => companies.filter((c) => !sourceDbs.includes(c.company_db)),
    [companies, sourceDbs],
  );

  const toggleSource = (db: string) => {
    setSourceDbs((prev) => prev.includes(db) ? prev.filter((d) => d !== db) : [...prev, db]);
    setTargetDbs((prev) => prev.filter((d) => d !== db));
  };

  const toggleTarget = (db: string) => {
    setTargetDbs((prev) => prev.includes(db) ? prev.filter((d) => d !== db) : [...prev, db]);
  };

  // Load users whenever source DBs change
  useEffect(() => {
    if (sourceDbs.length === 0) {
      setSourceUsers([]);
      setSelectedCodes([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingUsers(true);
      const map = new Map<string, SourceUser>();
      for (const db of sourceDbs) {
        try {
          const { data, error } = await supabase.functions.invoke("sap-users-admin", {
            body: { action: "list_users", company_db: db },
          });
          if (error || (data as { error?: string })?.error) {
            toast.error(`Erro lendo ${db}: ${(data as { error?: string })?.error || error?.message}`);
            continue;
          }
          const users = ((data as { users?: Record<string, unknown>[] })?.users) || [];
          for (const u of users) {
            const code = String(u.UserCode || "").trim();
            if (!code) continue;
            const existing = map.get(code);
            if (existing) {
              if (!existing.sources.includes(db)) existing.sources.push(db);
            } else {
              map.set(code, {
                code,
                name: String(u.UserName || code),
                email: u.eMail ? String(u.eMail) : undefined,
                superuser: u.Superuser === "tYES" || u.Superuser === true,
                locked: u.Locked === "tYES" || u.Locked === true,
                sources: [db],
              });
            }
          }
        } catch (e) {
          toast.error(`Erro lendo ${db}`);
        }
      }
      if (cancelled) return;
      const list = Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
      setSourceUsers(list);
      // Keep only selections still present
      setSelectedCodes((prev) => prev.filter((c) => map.has(c)));
      setLoadingUsers(false);
    })();
    return () => { cancelled = true; };
  }, [sourceDbs]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    return sourceUsers.filter((u) => {
      if (statusFilter === "active" && u.locked) return false;
      if (!q) return true;
      return (
        u.code.toLowerCase().includes(q) ||
        u.name.toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q)
      );
    });
  }, [sourceUsers, userSearch, statusFilter]);

  const toggleUser = (code: string) => {
    setSelectedCodes((prev) => prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]);
  };
  const selectAllFiltered = () => setSelectedCodes(Array.from(new Set([...selectedCodes, ...filteredUsers.map((u) => u.code)])));
  const clearSelection = () => setSelectedCodes([]);

  const handleRun = async () => {
    if (sourceDbs.length === 0) return toast.error("Selecione ao menos uma base de origem");
    if (targetDbs.length === 0) return toast.error("Selecione ao menos uma base de destino");
    if (passwordMode !== "individual") {
      const policy = checkPasswordPolicy(defaultPassword);
      if (!policy.valid) return toast.error("A senha provisionada não atende à política (mín. 12 caracteres, maiúscula, minúscula, número e especial)");
    }
    if (targetDbs.some((d) => sourceDbs.includes(d))) return toast.error("As bases de destino não podem estar nas origens");
    if (selectedCodes.length === 0) return toast.error("Selecione ao menos um usuário");

    setRunning(true);
    setResults(null);
    const aggregated: TargetResult[] = [];
    // Provisionamento de senha: compartilhada (auto/manual) ou individual por usuário.
    const individualPasswords: Record<string, string> = {};
    if (passwordMode === "individual") {
      for (const code of selectedCodes) individualPasswords[code] = generateStrongPassword(16, code);
    }
    try {
      for (const target of targetDbs) {
        try {
          const { data, error } = await supabase.functions.invoke("sap-users-admin", {
            body: {
              action: "replicate_users",
              source_company_dbs: sourceDbs,
              target_company_db: target,
              default_password: passwordMode === "individual" ? generateStrongPassword(16) : defaultPassword,
              ...(passwordMode === "individual" ? { user_passwords: individualPasswords } : {}),
              user_codes: selectedCodes,
              include_superusers: includeSuperusers,
              overwrite_existing: overwrite,
            },
          });
          if (error || (data as { error?: string })?.error) {
            aggregated.push({ target_db: target, error: (data as { error?: string })?.error || error?.message || "Erro" });
          } else {
            aggregated.push({ target_db: target, result: data as ReplicateResult });
          }
        } catch (e) {
          aggregated.push({ target_db: target, error: e instanceof Error ? e.message : "Erro" });
        }
      }
      setResults(aggregated);
      setResultsOpen(true);

      // Envio das credenciais provisórias por e-mail (quando houver e-mail no usuário).
      if (sendCredentials) {
        const byEmail = new Map<string, { code: string; name: string; email: string; password: string; companies: string[] }>();
        for (const tr of aggregated) {
          for (const d of tr.result?.created_details || []) {
            if (!d.email) continue;
            const key = `${d.code}|${d.password}`;
            const displayName = companies.find((c) => c.company_db === tr.target_db)?.display_name || tr.target_db;
            const existing = byEmail.get(key);
            if (existing) existing.companies.push(displayName);
            else byEmail.set(key, { code: d.code, name: d.name, email: d.email, password: d.password, companies: [displayName] });
          }
        }
        let sent = 0;
        for (const entry of byEmail.values()) {
          try {
            const { data: mail } = await supabase.functions.invoke("user-credentials-email", {
              body: {
                email: entry.email,
                userCode: entry.code,
                userName: entry.name,
                password: entry.password,
                companyDb: targetDbs[0] || null,
                companies: entry.companies,
              },
            });
            if ((mail as { sent?: boolean })?.sent) sent++;
          } catch { /* ignora falha individual */ }
        }
        if (byEmail.size > 0) {
          if (sent > 0) toast.success(`Credenciais enviadas para ${sent} usuário(s)`);
          else toast.warning("Não foi possível enviar as credenciais por e-mail");
        }
      }
      const okTargets = aggregated.filter((r) => r.result).length;
      const totalCreated = aggregated.reduce((s, r) => s + (r.result?.created.length || 0), 0);
      toast.success(`Replicação concluída em ${okTargets}/${targetDbs.length} bases — ${totalCreated} criados no total`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <BackofficePageHeader
        title="Replicar usuários entre bases"
        description="Copie usuários SAP de uma ou mais bases de origem para as bases de destino."
        icon={<Copy className="w-5 h-5 text-primary" />}
        backTo="/usuarios/sap"
      />

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <div className="glass-card p-5 space-y-5">
          <div>
            <Label className="text-sm font-medium">Bases de origem (uma ou mais — consolidadas)</Label>
            <p className="text-xs text-muted-foreground mb-2">Os usuários únicos por código serão lidos destas bases.</p>
            {loadingCompanies ? (
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            ) : (
              <div className="grid sm:grid-cols-2 gap-2 max-h-64 overflow-auto p-2 border rounded-md bg-card">
                {companies.map((c) => (
                  <label key={c.company_db} className="flex items-start gap-2 p-2 rounded hover:bg-muted/40 cursor-pointer">
                    <Checkbox
                      checked={sourceDbs.includes(c.company_db)}
                      onCheckedChange={() => toggleSource(c.company_db)}
                    />
                    <div className="text-sm">
                      <div className="font-medium">{c.display_name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{c.company_db}</div>
                    </div>
                  </label>
                ))}
              </div>
            )}
            {sourceDbs.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {sourceDbs.map((d) => (
                  <Badge key={d} variant="secondary" className="text-[10px]">{d}</Badge>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label className="text-sm font-medium">Bases de destino (uma ou mais)</Label>
            <p className="text-xs text-muted-foreground mb-2">A replicação será executada para cada base selecionada.</p>
            {targetOptions.length === 0 ? (
              <p className="text-xs text-muted-foreground p-3 border rounded-md bg-card">
                Nenhuma base disponível (selecione origens diferentes primeiro).
              </p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-2 max-h-64 overflow-auto p-2 border rounded-md bg-card">
                {targetOptions.map((c) => (
                  <label key={c.company_db} className="flex items-start gap-2 p-2 rounded hover:bg-muted/40 cursor-pointer">
                    <Checkbox
                      checked={targetDbs.includes(c.company_db)}
                      onCheckedChange={() => toggleTarget(c.company_db)}
                    />
                    <div className="text-sm">
                      <div className="font-medium">{c.display_name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{c.company_db}</div>
                    </div>
                  </label>
                ))}
              </div>
            )}
            {targetDbs.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {targetDbs.map((d) => (
                  <Badge key={d} className="text-[10px]">{d}</Badge>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <Label className="text-sm font-medium">Provisionamento de senha</Label>
            <div className="flex flex-wrap gap-2">
              {([
                { id: "shared-auto", label: "Gerar senha automática (única)" },
                { id: "shared-manual", label: "Definir senha manualmente" },
                { id: "individual", label: "Senha individual por usuário" },
              ] as { id: PasswordMode; label: string }[]).map((m) => (
                <Button
                  key={m.id}
                  type="button"
                  size="sm"
                  variant={passwordMode === m.id ? "default" : "outline"}
                  onClick={() => {
                    setPasswordMode(m.id);
                    if (m.id === "shared-auto") { setDefaultPassword(generateStrongPassword(16)); setShowPassword(true); }
                  }}
                >
                  {m.label}
                </Button>
              ))}
            </div>

            {passwordMode === "individual" ? (
              <p className="text-xs text-muted-foreground">
                Cada usuário receberá uma senha forte exclusiva, gerada no momento da replicação.
                Ative o envio por e-mail abaixo para que cada um receba a própria credencial.
              </p>
            ) : (
              <div className="max-w-md">
                <div className="flex gap-2">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={defaultPassword}
                    onChange={(e) => { setDefaultPassword(e.target.value); setPasswordMode("shared-manual"); }}
                    placeholder="Mínimo 12 caracteres"
                    className="bg-card"
                  />
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => { setDefaultPassword(generateStrongPassword(16)); setPasswordMode("shared-auto"); setShowPassword(true); }} aria-label="Gerar nova senha">
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Será aplicada a todos os usuários criados. Eles podem alterar depois.
                </p>
              </div>
            )}

            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={sendCredentials} onCheckedChange={(v) => setSendCredentials(!!v)} />
              Enviar credenciais provisórias por e-mail aos usuários replicados
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-sm font-medium">
                Usuários a replicar
                {sourceUsers.length > 0 && (
                  <span className="text-xs text-muted-foreground ml-2">
                    ({selectedCodes.length} selecionados de {sourceUsers.length})
                  </span>
                )}
              </Label>
              {sourceUsers.length > 0 && (
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={selectAllFiltered}>
                    Selecionar todos
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={clearSelection}>
                    Limpar
                  </Button>
                </div>
              )}
            </div>
            {sourceDbs.length === 0 ? (
              <p className="text-xs text-muted-foreground p-3 border rounded-md bg-card">
                Selecione ao menos uma base de origem para listar os usuários.
              </p>
            ) : loadingUsers ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground p-3 border rounded-md bg-card">
                <Loader2 className="w-4 h-4 animate-spin" /> Carregando usuários das bases selecionadas...
              </div>
            ) : (
              <>
                <div className="flex gap-2 mb-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      placeholder="Buscar por código, nome ou e-mail..."
                      className="pl-9 bg-card"
                    />
                  </div>
                  <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "active" | "all")}>
                    <SelectTrigger className="w-[180px] bg-card">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Apenas ativos</SelectItem>
                      <SelectItem value="all">Todos (incl. bloqueados)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="max-h-72 overflow-auto border rounded-md bg-card divide-y">
                  {filteredUsers.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-3">Nenhum usuário encontrado.</p>
                  ) : (
                    filteredUsers.map((u) => (
                      <label
                        key={u.code}
                        className={`flex items-start gap-2 p-2 hover:bg-muted/40 cursor-pointer ${u.locked ? "opacity-70" : ""}`}
                      >
                        <Checkbox
                          checked={selectedCodes.includes(u.code)}
                          onCheckedChange={() => toggleUser(u.code)}
                          className="mt-1"
                        />
                        <div className="text-sm flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs">{u.code}</span>
                            <span className="font-medium truncate">{u.name}</span>
                            {u.superuser && <Badge variant="outline" className="text-[10px]">Superuser</Badge>}
                            {u.locked && <Badge variant="destructive" className="text-[10px]">Bloqueado</Badge>}
                          </div>
                          {u.email && <div className="text-xs text-muted-foreground truncate">{u.email}</div>}
                          <div className="text-[10px] text-muted-foreground font-mono">
                            {u.sources.join(", ")}
                          </div>
                        </div>
                      </label>
                    ))
                  )}
                </div>
              </>
            )}
          </div>


          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={includeSuperusers} onCheckedChange={(v) => setIncludeSuperusers(!!v)} />
              Incluir Superusers
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={overwrite} onCheckedChange={(v) => setOverwrite(!!v)} />
              Sobrescrever (por padrão, usuários já existentes no destino são ignorados)
            </label>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleRun} disabled={running}>
              {running ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Copy className="w-4 h-4 mr-1" />}
              Replicar usuários
            </Button>
          </div>
        </div>

        <Dialog open={resultsOpen} onOpenChange={setResultsOpen}>
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Resultado da replicação</DialogTitle>
              <DialogDescription>
                Confira abaixo o resultado por base de destino.
              </DialogDescription>
            </DialogHeader>

            {results && (() => {
              const hasCredError = results.some((r) => r.error && isCredentialError(r.error));
              return (
                <div className="space-y-4">
                  {hasCredError && (
                    <div className="border border-destructive/40 bg-destructive/10 rounded-md p-3 flex items-start gap-3">
                      <KeyRound className="w-5 h-5 text-destructive mt-0.5" />
                      <div className="flex-1 text-sm">
                        <div className="font-medium text-destructive">Erro de acesso detectado</div>
                        <div className="text-xs text-muted-foreground">
                          Uma ou mais bases destino estão sem credenciais administrativas válidas configuradas.
                        </div>
                      </div>
                      <Button size="sm" variant="destructive" onClick={() => navigate("/integracoes/credenciais")}>
                        Ajustar credenciais
                      </Button>
                    </div>
                  )}

                  {results.map((tr) => {
                    const credErr = tr.error && isCredentialError(tr.error);
                    return (
                      <div key={tr.target_db} className="border rounded-md p-4 space-y-3 bg-card">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <h2 className="text-sm font-semibold">
                            Destino: <span className="font-mono">{tr.target_db}</span>
                          </h2>
                          {tr.error ? (
                            <Badge variant="destructive">{credErr ? "Sem credenciais" : "Falhou"}</Badge>
                          ) : (
                            <Badge variant="outline" className="border-emerald-500 text-emerald-600">OK</Badge>
                          )}
                        </div>
                        {tr.error ? (
                          <div className="space-y-2">
                            <p className="text-sm text-destructive">{tr.error}</p>
                            {credErr && (
                              <Button size="sm" variant="outline" onClick={() => navigate("/integracoes/credenciais")}>
                                <KeyRound className="w-3.5 h-3.5 mr-1" />
                                Configurar credenciais desta base
                              </Button>
                            )}
                          </div>
                        ) : tr.result ? (
                          <>
                            <div className="grid sm:grid-cols-4 gap-2">
                              <div className="p-2 rounded-md border bg-background">
                                <div className="text-[10px] text-muted-foreground">Origem (únicos)</div>
                                <div className="text-xl font-bold">{tr.result.total_source_users}</div>
                              </div>
                              <div className="p-2 rounded-md border bg-background">
                                <div className="text-[10px] text-muted-foreground">Criados</div>
                                <div className="text-xl font-bold text-emerald-500">{tr.result.created.length}</div>
                              </div>
                              <div className="p-2 rounded-md border bg-background">
                                <div className="text-[10px] text-muted-foreground">Ignorados</div>
                                <div className="text-xl font-bold text-amber-500">{tr.result.skipped.length}</div>
                              </div>
                              <div className="p-2 rounded-md border bg-background">
                                <div className="text-[10px] text-muted-foreground">Falhas</div>
                                <div className="text-xl font-bold text-destructive">{tr.result.failed.length}</div>
                              </div>
                            </div>

                            {tr.result.created.length > 0 && (
                              <Section icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />} title="Criados">
                                <div className="flex flex-wrap gap-1">
                                  {tr.result.created.map((c) => <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>)}
                                </div>
                              </Section>
                            )}
                            {tr.result.skipped.length > 0 && (
                              <Section icon={<AlertTriangle className="w-4 h-4 text-amber-500" />} title="Ignorados">
                                <ul className="text-xs space-y-1">
                                  {tr.result.skipped.map((s, i) => <li key={i}><span className="font-mono">{s.code}</span> — {s.reason}</li>)}
                                </ul>
                              </Section>
                            )}
                            {tr.result.failed.length > 0 && (
                              <Section icon={<XCircle className="w-4 h-4 text-destructive" />} title="Falhas">
                                <ul className="text-xs space-y-1">
                                  {tr.result.failed.map((f, i) => <li key={i}><span className="font-mono">{f.code}</span> — {f.error}</li>)}
                                </ul>
                              </Section>
                            )}
                            {tr.result.source_errors.length > 0 && (
                              <Section icon={<XCircle className="w-4 h-4 text-destructive" />} title="Erros lendo bases de origem">
                                <ul className="text-xs space-y-1">
                                  {tr.result.source_errors.map((s, i) => (
                                    <li key={i} className="flex items-center justify-between gap-2">
                                      <span><span className="font-mono">{s.db}</span> — {s.error}</span>
                                      {isCredentialError(s.error) && (
                                        <Button size="sm" variant="ghost" onClick={() => navigate("/integracoes/credenciais")}>
                                          <KeyRound className="w-3.5 h-3.5 mr-1" /> Ajustar
                                        </Button>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              </Section>
                            )}
                          </>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            <DialogFooter>
              <Button variant="outline" onClick={() => setResultsOpen(false)}>Fechar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}

function isCredentialError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("sem credenciais") ||
    m.includes("credenciais administrativas") ||
    m.includes("falha login sap") ||
    m.includes("falha ao autenticar") ||
    m.includes("unauthorized") ||
    m.includes("401") ||
    m.includes("invalid") && m.includes("user")
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="border rounded-md p-3 bg-card">
      <div className="flex items-center gap-2 mb-2 text-sm font-medium">{icon}{title}</div>
      {children}
    </div>
  );
}
