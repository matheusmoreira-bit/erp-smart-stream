import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, RefreshCw, Lock, Unlock, KeyRound, Loader2, Users as UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSapUsers } from "@/hooks/useSapUsers";
import type { SapUser } from "@/lib/cache-repository";
import { toast } from "sonner";

type ConfirmAction = {
  type: "lock" | "unlock" | "password";
  user: SapUser;
} | null;

export default function UsersPage() {
  const navigate = useNavigate();
  const { users, isLoading, error, actionLoading, refresh, toggleLock, resetPassword } = useSapUsers();
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);

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

  const formatLastLogin = (user: SapUser) => {
    if (!user.LastLoginDate) return "—";
    try {
      const date = new Date(user.LastLoginDate);
      return date.toLocaleDateString("pt-BR");
    } catch {
      return user.LastLoginDate;
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
      {/* Header */}
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="p-2 rounded-lg bg-primary/10">
              <UsersIcon className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Usuários SAP</h1>
              <p className="text-xs text-muted-foreground">Gestão de acessos</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-4 p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive text-sm">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Carregando usuários…</span>
          </div>
        ) : (
          <div className="glass-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Último Login</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                      Nenhum usuário encontrado
                    </TableCell>
                  </TableRow>
                ) : (
                  users.map((user) => {
                    const isLocked = user.Locked === "tYES";
                    const isActing = actionLoading === user.InternalKey;

                    return (
                      <TableRow key={user.InternalKey} className={isLocked ? "opacity-60" : ""}>
                        <TableCell className="font-medium">{user.UserName}</TableCell>
                        <TableCell className="text-muted-foreground">{user.UserCode}</TableCell>
                        <TableCell className="text-muted-foreground">{user.eMail || "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{formatLastLogin(user)}</TableCell>
                        <TableCell>
                          <Badge variant={isLocked ? "destructive" : "secondary"} className={!isLocked ? "bg-success/20 text-success border-success/30" : ""}>
                            {isLocked ? "Bloqueado" : "Ativo"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {isActing ? (
                              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
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
                                  onClick={() =>
                                    setConfirmAction({ type: "password", user })
                                  }
                                >
                                  <KeyRound className="w-4 h-4 text-warning" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </main>

      {/* Confirmation Dialog */}
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
    </div>
  );
}
