import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Copy, CheckCircle2, XCircle, AlertTriangle, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { SapCompanyOption } from "@/hooks/useSapUsersAdmin";

interface SourceUser {
  code: string;
  name: string;
  email?: string;
  superuser?: boolean;
  locked?: boolean;
  sources: string[];
}

interface ReplicateResult {
  total_source_users: number;
  created: string[];
  skipped: { code: string; reason: string }[];
  failed: { code: string; error: string }[];
  source_errors: { db: string; error: string }[];
}

export default function SapUsersReplicate() {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState<SapCompanyOption[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [sourceDbs, setSourceDbs] = useState<string[]>([]);
  const [targetDbs, setTargetDbs] = useState<string[]>([]);
  const [defaultPassword, setDefaultPassword] = useState("");
  const [sourceUsers, setSourceUsers] = useState<SourceUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "all">("active");
  const [includeSuperusers, setIncludeSuperusers] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ReplicateResult | null>(null);

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
    if (targetDb === db) setTargetDb("");
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
    if (!targetDb) return toast.error("Selecione a base de destino");
    if (!defaultPassword || defaultPassword.length < 8) return toast.error("Senha padrão precisa ter no mínimo 8 caracteres");
    if (sourceDbs.includes(targetDb)) return toast.error("A base de destino não pode ser uma das origens");
    if (selectedCodes.length === 0) return toast.error("Selecione ao menos um usuário");

    setRunning(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("sap-users-admin", {
        body: {
          action: "replicate_users",
          source_company_dbs: sourceDbs,
          target_company_db: targetDb,
          default_password: defaultPassword,
          user_codes: selectedCodes,
          include_superusers: includeSuperusers,
          overwrite_existing: overwrite,
        },
      });
      if (error || (data as { error?: string })?.error) {
        throw new Error((data as { error?: string })?.error || error?.message || "Erro");
      }
      const res = data as ReplicateResult;
      setResult(res);
      toast.success(`Replicação concluída: ${res.created.length} criados, ${res.skipped.length} ignorados, ${res.failed.length} falhas`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao replicar");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 bg-card/80 backdrop-blur border-b border-border">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/backoffice/sap-users")}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Usuários SAP
          </Button>
          <div className="flex items-center gap-2">
            <Copy className="w-5 h-5 text-muted-foreground" />
            <h1 className="text-xl font-bold text-foreground">Replicar usuários entre bases</h1>
          </div>
        </div>
      </header>

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
            <Label className="text-sm font-medium">Base de destino</Label>
            <Select value={targetDb} onValueChange={setTargetDb}>
              <SelectTrigger className="bg-card mt-1">
                <SelectValue placeholder="Selecione a base destino" />
              </SelectTrigger>
              <SelectContent>
                {targetOptions.map((c) => (
                  <SelectItem key={c.company_db} value={c.company_db}>
                    {c.display_name} <span className="text-xs text-muted-foreground ml-2">({c.company_db})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-sm font-medium">Senha padrão para novos usuários</Label>
            <Input
              type="password"
              value={defaultPassword}
              onChange={(e) => setDefaultPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              className="mt-1 bg-card max-w-md"
            />
            <p className="text-xs text-muted-foreground mt-1">Será aplicada a todos os usuários criados. Eles podem alterar depois.</p>
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

        {result && (
          <div className="glass-card p-5 space-y-4">
            <h2 className="text-lg font-semibold">Resultado</h2>
            <div className="grid sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-md border bg-card">
                <div className="text-xs text-muted-foreground">Origem (únicos)</div>
                <div className="text-2xl font-bold">{result.total_source_users}</div>
              </div>
              <div className="p-3 rounded-md border bg-card">
                <div className="text-xs text-muted-foreground">Criados</div>
                <div className="text-2xl font-bold text-emerald-500">{result.created.length}</div>
              </div>
              <div className="p-3 rounded-md border bg-card">
                <div className="text-xs text-muted-foreground">Ignorados</div>
                <div className="text-2xl font-bold text-amber-500">{result.skipped.length}</div>
              </div>
              <div className="p-3 rounded-md border bg-card">
                <div className="text-xs text-muted-foreground">Falhas</div>
                <div className="text-2xl font-bold text-destructive">{result.failed.length}</div>
              </div>
            </div>

            {result.created.length > 0 && (
              <Section icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />} title="Criados">
                <div className="flex flex-wrap gap-1">
                  {result.created.map((c) => <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>)}
                </div>
              </Section>
            )}
            {result.skipped.length > 0 && (
              <Section icon={<AlertTriangle className="w-4 h-4 text-amber-500" />} title="Ignorados">
                <ul className="text-xs space-y-1">
                  {result.skipped.map((s, i) => <li key={i}><span className="font-mono">{s.code}</span> — {s.reason}</li>)}
                </ul>
              </Section>
            )}
            {result.failed.length > 0 && (
              <Section icon={<XCircle className="w-4 h-4 text-destructive" />} title="Falhas">
                <ul className="text-xs space-y-1">
                  {result.failed.map((f, i) => <li key={i}><span className="font-mono">{f.code}</span> — {f.error}</li>)}
                </ul>
              </Section>
            )}
            {result.source_errors.length > 0 && (
              <Section icon={<XCircle className="w-4 h-4 text-destructive" />} title="Erros lendo bases de origem">
                <ul className="text-xs space-y-1">
                  {result.source_errors.map((s, i) => <li key={i}><span className="font-mono">{s.db}</span> — {s.error}</li>)}
                </ul>
              </Section>
            )}
          </div>
        )}
      </main>
    </div>
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
