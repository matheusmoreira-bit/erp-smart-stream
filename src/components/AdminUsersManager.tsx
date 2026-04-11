import { useState, useEffect, useCallback } from "react";
import {
  UserPlus,
  Trash2,
  Loader2,
  Mail,
  ShieldCheck,
  Clock,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface AdminUser {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  role: string;
}

export default function AdminUsersManager() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteDialog, setInviteDialog] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("admin-users", {
      method: "GET",
    });
    if (error) {
      toast.error("Erro ao carregar usuários");
    } else {
      setUsers(Array.isArray(data) ? data : []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !inviteEmail.includes("@")) {
      toast.error("Informe um email válido");
      return;
    }
    setInviting(true);
    const { data, error } = await supabase.functions.invoke("admin-users", {
      method: "POST",
      body: { email: inviteEmail.trim().toLowerCase() },
    });
    if (error || data?.error) {
      toast.error(data?.error || "Erro ao convidar usuário");
    } else {
      toast.success("Convite enviado por email");
      setInviteEmail("");
      setInviteDialog(false);
      fetchUsers();
    }
    setInviting(false);
  };

  const handleDelete = async (user: AdminUser) => {
    if (!confirm(`Remover o usuário "${user.email}"? Essa ação é irreversível.`)) return;
    setDeleting(user.id);
    const { data, error } = await supabase.functions.invoke("admin-users", {
      method: "DELETE",
      body: { userId: user.id },
    });
    if (error || data?.error) {
      toast.error(data?.error || "Erro ao remover usuário");
    } else {
      toast.success("Usuário removido");
      fetchUsers();
    }
    setDeleting(null);
  };

  const formatDate = (d: string | null) => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">
            Usuários Administradores
          </h3>
          <Badge variant="outline" className="text-[10px]">
            {users.length}
          </Badge>
        </div>
        <Button size="sm" onClick={() => setInviteDialog(true)}>
          <UserPlus className="w-4 h-4 mr-1" />
          Convidar
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Usuários com acesso ao painel de administração. Novos usuários recebem
        um email de convite para definir sua senha.
      </p>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : users.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Nenhum usuário encontrado.
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden bg-card">
          <div className="grid grid-cols-[1fr_auto_auto_auto] items-center px-4 py-2.5 border-b border-border bg-muted/30 gap-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Email
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground w-28 text-center">
              Status
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground w-36 text-center">
              Último Acesso
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground w-16 text-right">
              Ação
            </span>
          </div>

          {users.map((u) => (
            <div
              key={u.id}
              className="grid grid-cols-[1fr_auto_auto_auto] items-center px-4 py-3 border-b border-border last:border-b-0 hover:bg-muted/20 gap-4"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium text-foreground truncate">
                  {u.email}
                </span>
                <Badge variant="secondary" className="text-[10px] shrink-0">
                  {u.role === "admin" ? "Admin" : "Usuário"}
                </Badge>
              </div>

              <div className="w-28 flex justify-center">
                {u.email_confirmed_at ? (
                  <Badge
                    variant="outline"
                    className="text-[10px] text-emerald-600 border-emerald-200 bg-emerald-50"
                  >
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Ativo
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="text-[10px] text-amber-600 border-amber-200 bg-amber-50"
                  >
                    <Clock className="w-3 h-3 mr-1" />
                    Pendente
                  </Badge>
                )}
              </div>

              <div className="w-36 text-center">
                <span className="text-xs text-muted-foreground">
                  {formatDate(u.last_sign_in_at)}
                </span>
              </div>

              <div className="w-16 flex justify-end">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => handleDelete(u)}
                  disabled={deleting === u.id}
                  title="Remover usuário"
                >
                  {deleting === u.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Invite Dialog */}
      <Dialog open={inviteDialog} onOpenChange={setInviteDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Convidar Administrador</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Email
              </label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="admin@empresa.com"
                onKeyDown={(e) => e.key === "Enter" && handleInvite()}
              />
              <p className="text-xs text-muted-foreground">
                O usuário receberá um email com link para definir a senha e
                acessar o painel de administração.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setInviteDialog(false)}
            >
              Cancelar
            </Button>
            <Button onClick={handleInvite} disabled={inviting}>
              {inviting ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1" />
              ) : (
                <UserPlus className="w-4 h-4 mr-1" />
              )}
              Enviar Convite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
