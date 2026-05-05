import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, RefreshCw, Lock, Unlock, KeyRound, Loader2, Search, Clock, BarChart3, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSapUsers } from "@/hooks/useSapUsers";
import type { SapUser } from "@/lib/cache-repository";
import CreateUserDialog from "@/components/CreateUserDialog";
import { useSap } from "@/contexts/SapContext";
import { listSapTargetCompanies, changePasswordInCompanies } from "@/lib/sap-multi-password";
import { toast } from "sonner";

type ConfirmAction = {
  type: "lock" | "unlock" | "password";
  user: SapUser;
} | null;

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function formatLastLogin(user: SapUser): string {
  if (!user.LastLoginDate) return "Sem registro";

  const raw = user.LastLoginDate.trim();
  const [datePart, timePart] = raw.split("T");
  const match = datePart?.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) return raw;

  const [, year, month, day] = match;
  return `${day}/${month}/${year}${timePart ? `, ${timePart}` : ""}`;
}

export default function UsersPage() {
  const navigate = useNavigate();
  const { session } = useSap();
  const { users, isLoading, error, actionLoading, refresh, toggleLock, resetPassword, createUser } = useSapUsers();
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<string>("recorrentes");

  // Multi-company password reset state
  const [pwdUser, setPwdUser] = useState<SapUser | null>(null);
  const [otherCompanies, setOtherCompanies] = useState<{ company_db: string; display_name: string }[]>([]);
  const [pwdSelected, setPwdSelected] = useState<Set<string>>(new Set());
  const [pwdSubmitting, setPwdSubmitting] = useState(false);

  useEffect(() => {
    if (!pwdUser || !session) return;
    listSapTargetCompanies(session.companyDB).then((cs) =>
      setOtherCompanies(cs.map((c) => ({ company_db: c.company_db, display_name: c.display_name }))),
    );
    setPwdSelected(new Set());
  }, [pwdUser, session]);

  const togglePwdCompany = (db: string) => {
    setPwdSelected((prev) => {
      const next = new Set(prev);
      if (next.has(db)) next.delete(db);
      else next.add(db);
      return next;
    });
  };

  const handleResetPassword = async () => {
    if (!pwdUser) return;
    setPwdSubmitting(true);
    try {
      await resetPassword(pwdUser);
      let extra: Awaited<ReturnType<typeof changePasswordInCompanies>> = [];
      if (pwdSelected.size > 0) {
        extra = await changePasswordInCompanies(pwdUser.UserCode, "Sap@2025", Array.from(pwdSelected));
      }
      const failures = extra.filter((r) => r.status === "error");
      const successes = extra.filter((r) => r.status === "success");
      const skipped = extra.filter((r) => r.status === "skipped");

      if (extra.length === 0) {
        toast.success(`Senha de ${pwdUser.UserName} alterada para Sap@2025`);
      } else if (failures.length === 0) {
        toast.success(
          `Senha alterada em ${1 + successes.length} empresa(s)${skipped.length ? ` (${skipped.length} ignorada(s))` : ""}.`,
        );
      } else {
        toast.warning(
          `Alterada em ${1 + successes.length} empresa(s). Falhas: ${failures.map((f) => f.displayName).join(", ")}`,
        );
      }
      setPwdUser(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao redefinir senha");
    } finally {
      setPwdSubmitting(false);
    }
  };

  const filteredUsers = useMemo(() => {
    let list = users;

    if (viewMode === "recorrentes") {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 60);
      list = list.filter((u) => {
        if (!u.LastLoginDate) return false;
        const loginDate = new Date(u.LastLoginDate);
        return loginDate >= cutoff;
      });
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (u) =>
          u.UserName.toLowerCase().includes(q) ||
          u.UserCode.toLowerCase().includes(q) ||
          (u.eMail?.toLowerCase().includes(q) ?? false)
      );
    }

    return list;
  }, [users, search, viewMode]);

  const handleConfirm = async () => {
    if (!confirmAction) return;
    try {
      if (confirmAction.type === "lock" || confirmAction.type === "unlock") {
        await toggleLock(confirmAction.user);
        toast.success(
          confirmAction.type === "lock"
            ? `Usuário ${confirmAction.user.UserName} bloqueado`
            : `Usuário ${confirmAction.user.UserName} desbloqueado`
        );
      } else {
        await resetPassword(confirmAction.user);
        toast.success(`Senha de ${confirmAction.user.UserName} alterada para Sap@2025`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao executar ação");
    } finally {
      setConfirmAction(null);
    }
  };

  const confirmMessages: Record<string, { title: string; description: string }> = {
    lock: {
      title: "Bloquear Usuário",
      description: `Tem certeza que deseja bloquear o usuário "${confirmAction?.user.UserName}"? Ele não poderá acessar o sistema.`,
    },
    unlock: {
      title: "Desbloquear Usuário",
      description: `Tem certeza que deseja desbloquear o usuário "${confirmAction?.user.UserName}"?`,
    },
    password: {
      title: "Redefinir Senha",
      description: `Tem certeza que deseja redefinir a senha do usuário "${confirmAction?.user.UserName}" para Sap@2025?`,
    },
  };

  const currentMsg = confirmAction ? confirmMessages[confirmAction.type] : null;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-foreground">Gestão de Usuários</h1>
              <p className="text-sm text-muted-foreground">Gerencie o acesso e senhas dos usuários do SAP</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <CreateUserDialog onCreateUser={createUser} isLoading={isLoading} />
            <Button variant="outline" size="sm" onClick={() => navigate("/users/activity")}>
              <BarChart3 className="w-4 h-4 mr-2" />
              Atividade
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/users/idp-sync")}>
              <Users className="w-4 h-4 mr-2" />
              IdP Sync
            </Button>
            <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive text-sm">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por código, nome ou e-mail..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-card border-border"
            />
          </div>
          <ToggleGroup
            type="single"
            value={viewMode}
            onValueChange={(v) => { if (v) setViewMode(v); }}
            className="border border-border rounded-lg p-0.5 bg-muted/50"
          >
            <ToggleGroupItem value="recorrentes" className="text-xs px-3 h-8 rounded-md text-muted-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-sm">
              Recorrentes
            </ToggleGroupItem>
            <ToggleGroupItem value="todos" className="text-xs px-3 h-8 rounded-md text-muted-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-sm">
              Todos
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Carregando usuários…</span>
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden bg-card">
            <div className="grid grid-cols-[1fr_auto_auto] items-center px-6 py-3 border-b border-border bg-muted/30">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Usuário</span>
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground w-48 text-center">Status</span>
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground w-24 text-right">Ações</span>
            </div>

            {filteredUsers.length === 0 ? (
              <div className="text-center text-muted-foreground py-16">
                Nenhum usuário encontrado
              </div>
            ) : (
              filteredUsers.map((user) => {
                const isLocked = user.Locked === "tYES";
                const isActing = actionLoading === user.InternalKey;
                const initials = getInitials(user.UserName || user.UserCode || "?");

                return (
                  <div
                    key={user.InternalKey}
                    className={`grid grid-cols-[1fr_auto_auto] items-center px-6 py-4 border-b border-border last:border-b-0 transition-colors hover:bg-muted/20 ${isLocked ? "opacity-50" : ""}`}
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="flex-shrink-0 w-11 h-11 rounded-full bg-primary/20 flex items-center justify-center">
                        <span className="text-sm font-bold text-primary">{initials}</span>
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground truncate">{user.UserName || "Sem nome"}</p>
                        <p className="text-sm text-muted-foreground truncate">
                          Username: <span className="font-medium text-foreground/80">{user.UserCode || "Sem username"}</span>
                        </p>
                        <p className="text-sm text-muted-foreground truncate">
                          E-mail: {user.eMail || "Sem e-mail"}
                        </p>
                      </div>
                    </div>

                    <div className="w-48 flex flex-col items-center gap-1">
                      <Badge
                        variant={isLocked ? "destructive" : "secondary"}
                        className={
                          !isLocked
                            ? "bg-success/20 text-success border-success/30 font-semibold"
                            : "font-semibold"
                        }
                      >
                        {isLocked ? "BLOQUEADO" : "ATIVO"}
                      </Badge>
                      <span className="text-xs text-muted-foreground flex items-center gap-1 text-center">
                        <Clock className="w-3 h-3" />
                        Login: {formatLastLogin(user)}
                      </span>
                    </div>

                    <div className="w-24 flex items-center justify-end gap-1">
                      {isActing ? (
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title={isLocked ? "Desbloquear" : "Bloquear"}
                            onClick={() =>
                              setConfirmAction({
                                type: isLocked ? "unlock" : "lock",
                                user,
                              })
                            }
                          >
                            {isLocked ? (
                              <Unlock className="w-4 h-4 text-success" />
                            ) : (
                              <Lock className="w-4 h-4 text-destructive" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Redefinir senha"
                            onClick={() => setPwdUser(user)}
                          >
                            <KeyRound className="w-4 h-4 text-warning" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </main>

      <Dialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{currentMsg?.title}</DialogTitle>
            <DialogDescription>{currentMsg?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>
              Cancelar
            </Button>
            <Button
              variant={confirmAction?.type === "lock" ? "destructive" : "default"}
              onClick={handleConfirm}
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pwdUser} onOpenChange={(o) => { if (!o) setPwdUser(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Redefinir Senha</DialogTitle>
            <DialogDescription>
              A senha de <span className="font-medium text-foreground">{pwdUser?.UserName}</span> será redefinida para <span className="font-mono">Sap@2025</span> na empresa atual.
            </DialogDescription>
          </DialogHeader>

          {otherCompanies.length > 0 && (
            <div className="space-y-2 pt-2">
              <p className="text-sm font-medium">Aplicar também em outras empresas</p>
              <p className="text-xs text-muted-foreground">
                Identificamos o usuário pelo código <span className="font-mono">{pwdUser?.UserCode}</span> em cada empresa selecionada (caso exista).
              </p>
              <div className="max-h-48 overflow-y-auto space-y-2 rounded-md border border-border p-2">
                {otherCompanies.map((c) => (
                  <label key={c.company_db} className="flex items-center gap-2 cursor-pointer text-sm">
                    <Checkbox
                      checked={pwdSelected.has(c.company_db)}
                      onCheckedChange={() => togglePwdCompany(c.company_db)}
                    />
                    <span className="text-foreground">{c.display_name}</span>
                    <span className="text-xs text-muted-foreground">({c.company_db})</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPwdUser(null)} disabled={pwdSubmitting}>
              Cancelar
            </Button>
            <Button onClick={handleResetPassword} disabled={pwdSubmitting}>
              {pwdSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
