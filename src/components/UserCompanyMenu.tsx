import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, ChevronDown, Loader2, LogOut, ShieldCheck, KeyRound, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSap } from "@/contexts/SapContext";
import { useCompanies } from "@/hooks/useCompanies";
import { supabase } from "@/integrations/supabase/client";

/**
 * Bloco padrão do canto direito do cabeçalho: empresa + usuário como dropdown,
 * com as opções "Trocar de empresa" e "Sair".
 */
export function UserCompanyMenu({ className = "" }: { className?: string }) {
  const { session, logout, login, loginManaged } = useSap();
  const { companies, getLabel } = useCompanies(true);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [managed, setManaged] = useState<Set<string>>(new Set());
  const [loadingCreds, setLoadingCreds] = useState(false);
  const [busyDb, setBusyDb] = useState<string | null>(null);
  const [formDb, setFormDb] = useState<string | null>(null);
  const [userName, setUserName] = useState("");
  const [password, setPassword] = useState("");

  const companyLabel = getLabel(session?.companyDB || "");

  const loadManaged = useCallback(async () => {
    setLoadingCreds(true);
    try {
      const { listUserSapCredentials } = await import("@/lib/user-sap-credentials");
      const creds = await listUserSapCredentials();
      setManaged(new Set(creds.map((c) => c.company_db)));
    } catch {
      setManaged(new Set());
    } finally {
      setLoadingCreds(false);
    }
  }, []);

  useEffect(() => {
    if (expanded) loadManaged();
  }, [expanded, loadManaged]);

  useEffect(() => {
    if (!open) setExpanded(false);
  }, [open]);

  const list = useMemo(
    () => companies.filter((c) => c.is_active).sort((a, b) => a.display_name.localeCompare(b.display_name, "pt-BR")),
    [companies],
  );

  const finish = () => {
    setOpen(false);
    setFormDb(null);
    window.setTimeout(() => window.location.replace("/"), 300);
  };

  const handleSelect = async (companyDb: string, erpType: string) => {
    if (companyDb === session?.companyDB) {
      setOpen(false);
      return;
    }
    if (erpType === "sap" && !managed.has(companyDb)) {
      setUserName("");
      setPassword("");
      setFormDb(companyDb);
      setOpen(false);
      return;
    }
    setBusyDb(companyDb);
    try {
      if (erpType === "sap") {
        await loginManaged(companyDb);
      } else {
        const { data } = await supabase.auth.getSession();
        const email = data.session?.user?.email || "";
        if (!email) throw new Error("Sessão Google não encontrada.");
        await login(email, "", companyDb, erpType as never);
      }
      toast.success(`Conectado a ${getLabel(companyDb)}`);
      finish();
    } catch (e) {
      toast.error("Não foi possível trocar de empresa", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusyDb(null);
    }
  };

  const handleFormLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formDb || !userName || !password) {
      toast.error("Preencha usuário e senha");
      return;
    }
    setBusyDb(formDb);
    try {
      const sapUser = userName.includes("@") ? userName.split("@")[0].trim() : userName.trim();
      await login(sapUser, password, formDb, "sap");
      toast.success(`Conectado a ${getLabel(formDb)}`);
      finish();
    } catch (err) {
      toast.error("Falha no login", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyDb(null);
    }
  };

  if (!session) return null;

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted/60 transition-colors max-w-[240px] ${className}`}
            aria-label="Menu da conta e empresa"
          >
            <div className="min-w-0 hidden sm:block">
              <p className="text-sm font-medium text-foreground truncate">{companyLabel}</p>
              <p className="text-xs text-muted-foreground truncate">{session.userName}</p>
            </div>
            <Building2 className="w-4 h-4 text-muted-foreground sm:hidden" aria-hidden="true" />
            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 bg-popover z-50">
          <div className="px-2 py-1.5 sm:hidden">
            <p className="text-sm font-medium text-foreground truncate">{companyLabel}</p>
            <p className="text-xs text-muted-foreground truncate">{session.userName}</p>
          </div>

          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setExpanded((v) => !v);
            }}
          >
            <Building2 className="w-4 h-4 mr-2" />
            <span className="flex-1">Trocar de empresa</span>
            <ChevronDown
              className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </DropdownMenuItem>

          {expanded && (
            <div className="max-h-64 overflow-y-auto py-1">
              {loadingCreds && (
                <p className="text-[11px] text-muted-foreground px-3 pb-1">Verificando senhas provisionadas…</p>
              )}
              {list.map((c) => {
                const isCurrent = c.company_db === session.companyDB;
                const hasManaged = c.erp_type === "sap" ? managed.has(c.company_db) : true;
                return (
                  <button
                    key={c.company_db}
                    onClick={() => handleSelect(c.company_db, c.erp_type)}
                    disabled={busyDb !== null}
                    className="w-full flex items-center gap-2 rounded-sm pl-8 pr-2 py-1.5 text-left text-sm hover:bg-muted/60 transition-colors disabled:opacity-60"
                  >
                    <span className="flex-1 truncate text-foreground">{c.display_name}</span>
                    {busyDb === c.company_db ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />
                    ) : hasManaged ? (
                      <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0" aria-label="Senha provisionada" />
                    ) : (
                      <KeyRound className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-label="Requer login" />
                    )}
                    {isCurrent && <Check className="w-3.5 h-3.5 text-success shrink-0" aria-label="Empresa atual" />}
                  </button>
                );
              })}
              {list.length === 0 && (
                <p className="text-sm text-muted-foreground px-3 py-2">Nenhuma empresa disponível.</p>
              )}
            </div>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => logout()}>
            <LogOut className="w-4 h-4 mr-2" /> Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={formDb !== null} onOpenChange={(o) => !o && setFormDb(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Entrar em {formDb ? getLabel(formDb) : ""}</DialogTitle>
            <DialogDescription>
              Esta empresa não possui senha provisionada. Informe suas credenciais do ERP.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleFormLogin} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="switch-user">Usuário</Label>
              <Input
                id="switch-user"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                autoComplete="username"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="switch-pass">Senha</Label>
              <Input
                id="switch-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setFormDb(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busyDb === formDb}>
                {busyDb === formDb ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Entrar
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

