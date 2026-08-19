import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowRightLeft, Loader2, Play, Eye, History } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CachedSearchCombobox } from "@/components/CachedSearchCombobox";
import type { SapSearchOption } from "@/components/SapSearchCombobox";
import type { SapAdminUser } from "@/hooks/useSapUsersAdmin";

interface CompanyOpt { company_db: string; display_name: string }

interface TransferResult {
  dryRun: boolean;
  fromUser?: { code: string; internalKey: number; email?: string };
  toUser?: { code: string; internalKey: number; email?: string };
  transferred: Array<Record<string, unknown>>;
  skipped: Array<Record<string, unknown>>;
  errors: Array<Record<string, unknown>>;
}

interface ApprovalUserOption extends SapSearchOption {
  user: SapAdminUser;
  pendingCount: number;
}

interface PendingApprovalRow {
  id: string;
  current_approver: string | null;
}

function normalizeIdentity(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function displayUserName(user: SapAdminUser): string {
  return user.UserName || user.UserCode || user.eMail || "Usuário sem nome";
}

function identityKeys(user: SapAdminUser): string[] {
  const name = normalizeIdentity(user.UserName);
  const code = normalizeIdentity(user.UserCode);
  const email = normalizeIdentity(user.eMail);
  const emailLocal = normalizeIdentity(email.split("@")[0]);
  const dottedName = normalizeIdentity((user.UserName || "").replace(/\s+/g, "."));
  return Array.from(new Set([name, code, email, emailLocal, dottedName].filter(Boolean)));
}

function pendingCountForUser(user: SapAdminUser, counts: Map<string, number>): number {
  return identityKeys(user).reduce((sum, key) => sum + (counts.get(key) || 0), 0);
}

export default function TransferApprovalsTool() {
  const [companies, setCompanies] = useState<CompanyOpt[]>([]);
  const [companyDb, setCompanyDb] = useState("open_gaming_sa");
  const [users, setUsers] = useState<SapAdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [pendingRows, setPendingRows] = useState<PendingApprovalRow[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [fromUser, setFromUser] = useState<ApprovalUserOption | null>(null);
  const [toUser, setToUser] = useState<ApprovalUserOption | null>(null);
  const [costCenter, setCostCenter] = useState("");
  const [reason, setReason] = useState("Transferência administrativa de aprovações pendentes");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TransferResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    supabase.from("companies").select("company_db, display_name")
      .eq("is_active", true).order("display_name")
      .then(({ data }) => setCompanies(data || []));
  }, []);

  useEffect(() => {
    if (!companyDb) {
      setUsers([]);
      setPendingRows([]);
      setFromUser(null);
      setToUser(null);
      return;
    }

    let cancelled = false;
    setUsersLoading(true);
    setPendingLoading(true);
    setFromUser(null);
    setToUser(null);

    supabase.functions.invoke("sap-users-admin", {
      body: { action: "list_users", company_db: companyDb },
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        toast.error("Erro ao carregar usuários", { description: error.message });
        setUsers([]);
        return;
      }
      const payload = data as { users?: SapAdminUser[]; error?: string } | null;
      if (payload?.error) {
        toast.error("Erro ao carregar usuários", { description: payload.error });
        setUsers([]);
        return;
      }
      setUsers(payload?.users || []);
    }).catch((e) => {
      if (!cancelled) {
        toast.error("Erro ao carregar usuários", { description: e instanceof Error ? e.message : String(e) });
        setUsers([]);
      }
    }).finally(() => {
      if (!cancelled) setUsersLoading(false);
    });

    supabase
      .from("expenses")
      .select("id, current_approver")
      .eq("company_db", companyDb)
      .eq("status", "pendente_aprovacao")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          toast.error("Erro ao carregar pendências", { description: error.message });
          setPendingRows([]);
          return;
        }
        setPendingRows((data || []) as PendingApprovalRow[]);
      })
      .finally(() => {
        if (!cancelled) setPendingLoading(false);
      });

    return () => { cancelled = true; };
  }, [companyDb]);

  const pendingCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of pendingRows) {
      const key = normalizeIdentity(row.current_approver);
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, [pendingRows]);

  const userOptions = useMemo<ApprovalUserOption[]>(() => (
    users
      .filter((u) => u.Locked !== "tYES" && (u.UserCode || u.UserName || u.eMail))
      .map((user) => {
        const pendingCount = pendingCountForUser(user, pendingCounts);
        const name = displayUserName(user);
        const email = user.eMail || "";
        return {
          code: user.UserCode || String(user.InternalKey),
          name,
          extra: email,
          user,
          pendingCount,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }) || a.code.localeCompare(b.code))
  ), [pendingCounts, users]);

  const pendingByUser = useMemo(() => (
    userOptions
      .filter((opt) => opt.pendingCount > 0)
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }))
  ), [userOptions]);

  const selectedCompanyLabel = companies.find((c) => c.company_db === companyDb)?.display_name || companyDb;

  const run = async (dryRun: boolean) => {
    if (!companyDb || !toUser) {
      toast.error("Preencha empresa e usuário de destino");
      return;
    }
    if (!fromUser && !costCenter.trim()) {
      toast.error("Informe usuário de origem e/ou centro de custo");
      return;
    }
    if (fromUser && fromUser.code.toLowerCase() === toUser.code.toLowerCase()) {
      toast.error("Origem e destino devem ser diferentes");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const fromIdentifier = fromUser
        ? (fromUser.user.UserName || fromUser.user.UserCode || fromUser.user.eMail || "").trim()
        : undefined;
      const { data, error } = await supabase.functions.invoke("transfer-approvals", {
        body: {
          company_db: companyDb,
          from_user_code: fromIdentifier,
          from_user_name: fromUser?.user.UserName || undefined,
          from_user_email: fromUser?.user.eMail || undefined,
          to_user_code: toUser.user.UserCode || toUser.code,
          to_user_name: toUser.user.UserName || toUser.name,
          to_user_email: toUser.user.eMail || undefined,
          cost_center: costCenter.trim() || undefined,
          reason,
          dry_run: dryRun,
        },
      });
      if (error) throw error;
      const res = data as TransferResult;
      setResult(res);
      const count = res.transferred?.length ?? 0;
      if (dryRun) {
        toast.success(`Preview: ${count} aprovação(ões) seriam transferidas`);
      } else {
        toast.success(`${count} aprovação(ões) transferidas`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao transferir aprovações");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-foreground">Transferir aprovações pendentes</h3>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/backoffice/transfer-history">
            <History className="w-4 h-4 mr-1.5" />
            Ver histórico
          </Link>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Reatribui aprovações SAP pendentes para outro aprovador dentro da mesma empresa e envia
        notificação in-app. Selecione origem e destino pela lista de usuários; filtre também por centro de custo se necessário.
        Faça o preview antes de executar.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Empresa</Label>
          <Select value={companyDb} onValueChange={setCompanyDb}>
            <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
            <SelectContent>
              {companies.map((c) => (
                <SelectItem key={c.company_db} value={c.company_db}>
                  {c.display_name} <span className="opacity-60">({c.company_db})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Para</Label>
          <CachedSearchCombobox
            options={userOptions}
            isLoading={usersLoading}
            value={toUser}
            onChange={(opt) => setToUser(opt as ApprovalUserOption | null)}
            placeholder="Buscar usuário de destino..."
            required
            renderOptionBadge={(opt) => {
              const count = (opt as ApprovalUserOption).pendingCount;
              return count > 0 ? <Badge variant="outline" className="ml-1 font-mono">{count}</Badge> : null;
            }}
            footerHint={`${userOptions.length} usuário(s) em ${selectedCompanyLabel}`}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">De — opcional</Label>
          <CachedSearchCombobox
            options={userOptions}
            isLoading={usersLoading || pendingLoading}
            value={fromUser}
            onChange={(opt) => setFromUser(opt as ApprovalUserOption | null)}
            placeholder="Buscar usuário de origem..."
            renderOptionBadge={(opt) => {
              const count = (opt as ApprovalUserOption).pendingCount;
              return <Badge variant={count > 0 ? "default" : "outline"} className="ml-1 font-mono">{count}</Badge>;
            }}
            footerHint="O número indica aprovações pendentes encontradas para o usuário"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Centro de custo — opcional</Label>
          <Input value={costCenter} onChange={(e) => setCostCenter(e.target.value)} placeholder="ex: 1.8.1.4" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Motivo (aparece no audit log)</Label>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </div>


      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={loading} onClick={() => run(true)}>
          {loading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Eye className="w-4 h-4 mr-1.5" />}
          Preview (dry-run)
        </Button>
        <Button size="sm" disabled={loading} onClick={() => setConfirmOpen(true)}>
          {loading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Play className="w-4 h-4 mr-1.5" />}
          Executar transferência
        </Button>
      </div>

      <div className="rounded-md border border-border bg-muted/20 p-3">
        <p className="text-xs font-medium text-foreground mb-2">Pendências por usuário</p>
        {pendingLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Carregando pendências...
          </div>
        ) : pendingByUser.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma aprovação pendente vinculada aos usuários carregados.</p>
        ) : (
          <div className="max-h-44 overflow-y-auto space-y-1">
            {pendingByUser.map((opt) => (
              <div key={opt.code} className="flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <p className="truncate text-foreground">{opt.name}</p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">{opt.code}{opt.extra ? ` · ${opt.extra}` : ""}</p>
                </div>
                <Badge variant="outline" className="font-mono">{opt.pendingCount}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>

      {result && (
        <div className="mt-2 rounded-lg border border-border bg-muted/30 p-3 space-y-2">
          <div className="text-xs text-muted-foreground">
            {result.dryRun ? "Preview" : "Execução"} — de{" "}
            <span className="font-mono text-foreground">{result.fromUser?.code}</span> →{" "}
            <span className="font-mono text-foreground">{result.toUser?.code}</span>
          </div>
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="text-emerald-600">Transferidas: {result.transferred?.length ?? 0}</span>
            <span className="text-muted-foreground">Ignoradas: {result.skipped?.length ?? 0}</span>
            <span className="text-destructive">Erros: {result.errors?.length ?? 0}</span>
          </div>
          <pre className="text-[11px] leading-relaxed max-h-64 overflow-auto bg-background/50 rounded p-2 border border-border">
{JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Executar transferência de aprovações?"
        description={`As aprovações SAP pendentes${fromUser ? ` de ${fromUser.name}` : ""}${costCenter ? ` no CC ${costCenter}` : ""} serão reatribuídas para ${toUser?.name || "o usuário selecionado"} em ${companyDb}. Essa ação é registrada no audit log.`}
        confirmLabel="Transferir"
        destructive
        onConfirm={() => run(false)}
      />
    </div>
  );
}
