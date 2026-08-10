import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, UserCog } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSap } from "@/contexts/SapContext";
import { useSapUsers } from "@/hooks/useSapUsers";
import { useCompanies } from "@/hooks/useCompanies";
import { supabase } from "@/integrations/supabase/client";
import { setImpersonation } from "@/lib/impersonation";
import { clearAuthCache } from "@/lib/auth-cache";
import { logAuditAction } from "@/hooks/useAuditLog";
import { displayUserName } from "@/lib/user-display";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

/**
 * Inicia uma sessão de impersonação: o admin faz login real no ERP com o
 * usuário alvo (validando a senha provisionada) e o app passa a resolver
 * permissões e visibilidade como esse usuário.
 */
export function ImpersonationDialog({ open, onOpenChange }: Props) {
  const { session, login } = useSap();
  const { getLabel } = useCompanies(true);
  const { users, isLoading } = useSapUsers();
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<string>("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setTarget("");
      setPassword("");
    }
  }, [open]);

  const list = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (users || [])
      .filter((u) => u.Locked !== "tYES")
      .filter((u) => {
        if (!term) return true;
        return [u.UserCode, u.UserName, u.eMail]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(term));
      })
      .sort((a, b) => (a.UserName || a.UserCode || "").localeCompare(b.UserName || b.UserCode || "", "pt-BR"))
      .slice(0, 40);
  }, [users, search]);

  const selected = useMemo(
    () => (users || []).find((u) => (u.UserCode || "") === target),
    [users, target],
  );

  const start = async () => {
    if (!session?.companyDB) return;
    if (!target) {
      toast.error("Selecione o usuário");
      return;
    }
    setBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      const adminEmail = data.session?.user?.email || "";
      if (!adminEmail) throw new Error("Sessão Google não encontrada.");

      // A partir daqui os privilégios de admin ficam suspensos.
      setImpersonation({
        targetUser: target,
        targetName: selected?.UserName || undefined,
        targetEmail: selected?.eMail || undefined,
        adminEmail,
        companyDB: session.companyDB,
        startedAt: Date.now(),
      });
      clearAuthCache();

      if (password) {
        // Com senha: valida a credencial provisionada abrindo sessão real no ERP.
        await login(target, password, session.companyDB, "sap");
      } else {
        // Sem senha: entra apenas por identidade — a sessão do Service Layer,
        // quando necessária, é resolvida sob demanda pelo broker.
        sessionStorage.setItem(
          "erp_session_v1",
          JSON.stringify({
            erpType: session.erpType || "sap",
            companyDB: session.companyDB,
            userName: target,
          }),
        );
      }

      await logAuditAction({
        action: "impersonation_start",
        entity_type: "erp_session",
        actor_email: adminEmail,
        company_db: session.companyDB,
        details: {
          target_user: target,
          target_email: selected?.eMail || null,
          company: getLabel(session.companyDB),
          with_password: !!password,
        },
      });

      toast.success(`Atuando como ${displayUserName(selected?.UserName || target)}`);
      window.setTimeout(() => window.location.replace("/"), 400);
    } catch (e) {
      // Falhou o login: desfaz a impersonação para não deixar o admin sem poderes.
      const { clearImpersonation } = await import("@/lib/impersonation");
      clearImpersonation();
      clearAuthCache();
      toast.error("Não foi possível atuar como este usuário", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };


  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCog className="w-4 h-4 text-primary" aria-hidden="true" />
            Atuar como outro usuário
          </DialogTitle>
          <DialogDescription>
            Você entrará em {getLabel(session?.companyDB || "")} com a identidade do usuário
            escolhido, incluindo a sessão do ERP. Todas as ações ficam registradas em auditoria
            com o seu e-mail.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="imp-search">Usuário</Label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                id="imp-search"
                className="pl-9"
                placeholder="Buscar por nome, código ou e-mail"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="max-h-48 overflow-y-auto rounded-md border border-border divide-y divide-border">
              {isLoading && (
                <p className="text-sm text-muted-foreground px-3 py-3 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando usuários…
                </p>
              )}
              {!isLoading && list.length === 0 && (
                <p className="text-sm text-muted-foreground px-3 py-3">Nenhum usuário encontrado.</p>
              )}
              {list.map((u) => (
                <button
                  key={u.UserCode || u.InternalKey}
                  type="button"
                  onClick={() => setTarget(u.UserCode || "")}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/60 transition-colors ${
                    target === u.UserCode ? "bg-muted" : ""
                  }`}
                >
                  <span className="block text-foreground truncate">{u.UserName || u.UserCode}</span>
                  <span className="block text-xs text-muted-foreground truncate">
                    {u.UserCode}
                    {u.eMail ? ` · ${u.eMail}` : ""}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="imp-pass">Senha do usuário (opcional)</Label>
            <Input
              id="imp-pass"
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Deixe em branco para entrar sem senha"
            />
            <p className="text-xs text-muted-foreground">
              Sem senha você entra pela identidade do usuário; informe a senha apenas se quiser
              validar a credencial provisionada no ERP.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={start} disabled={busy || !target}>

            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Atuar como este usuário
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
