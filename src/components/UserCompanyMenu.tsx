import { useEffect, useMemo, useState } from "react";
import { Building2, ChevronDown, Compass, Loader2, LogOut, KeyRound, Check, UserCog, Sparkles, Infinity as InfinityIcon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { isKeepSessionAlive, setKeepSessionAlive } from "@/lib/session-keepalive";

import { ONBOARDING_REPLAY_EVENT, onboardingTourKey } from "@/components/OnboardingTour";
import { WHATSNEW_REPLAY_EVENT, whatsNewTourKey } from "@/components/WhatsNewWizard";
import { resetTour } from "@/lib/tour-state";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { useSap } from "@/contexts/SapContext";
import { useCompanies } from "@/hooks/useCompanies";
import { supabase } from "@/integrations/supabase/client";
import { displayUserName } from "@/lib/user-display";
import { getImpersonation } from "@/lib/impersonation";
import { useAuth } from "@/hooks/useAuth";
import { ImpersonationDialog } from "@/components/ImpersonationDialog";

/**
 * Bloco padrão do canto direito do cabeçalho: empresa + usuário como dropdown,
 * com as opções "Trocar de empresa" e "Sair".
 */
export function UserCompanyMenu({ className = "" }: { className?: string }) {
  const { session, logout, loginIdentity } = useSap();
  const { companies, getLabel } = useCompanies(true);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [busyDb, setBusyDb] = useState<string | null>(null);
  const [google, setGoogle] = useState<{ name: string; email: string; avatar: string } | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [impersonateOpen, setImpersonateOpen] = useState(false);
  const [keepAlive, setKeepAliveState] = useState(() => isKeepSessionAlive());

  const { isAdmin } = useAuth();

  const companyLabel = getLabel(session?.companyDB || "");

  // Durante a impersonação o menu mostra o usuário alvo, e não a conta Google
  // do admin — caso contrário parece que a sessão "voltou" para o admin.
  const impersonation = getImpersonation();
  const displayName = impersonation
    ? displayUserName(impersonation.targetName || impersonation.targetUser)
    : "";
  const displayEmail = impersonation ? impersonation.targetEmail || "" : "";

  // Conta Google (Lovable Cloud) — foto, nome e e-mail, padrão Google.
  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!alive) return;
      const u = data.user;
      if (!u) { setGoogle(null); return; }
      const meta = (u.user_metadata || {}) as Record<string, unknown>;
      setGoogle({
        name: String(meta.full_name || meta.name || "").trim(),
        email: u.email || "",
        avatar: String(meta.avatar_url || meta.picture || "").trim(),
      });
    });
    return () => { alive = false; };
  }, []);

  const initials = useMemo(() => {
    const base = displayName || google?.name || google?.email || displayUserName(session?.userName || "");
    return base
      .replace(/@.*/, "")
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() || "")
      .join("");
  }, [displayName, google, session?.userName]);

  const handleGoogleSignOut = async () => {
    setSigningOut(true);
    try {
      const { clearErpLocalState } = await import("@/lib/clear-erp-local-state");
      clearErpLocalState();
      await supabase.auth.signOut();
      toast.success("Você saiu da conta Google");
    } catch (e) {
      toast.error("Falha ao encerrar a sessão Google", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSigningOut(false);
      window.setTimeout(() => window.location.replace("/"), 300);
    }
  };


  useEffect(() => {
    if (!open) setExpanded(false);
  }, [open]);

  const list = useMemo(
    () => companies.filter((c) => c.is_active).sort((a, b) => a.display_name.localeCompare(b.display_name, "pt-BR")),
    [companies],
  );

  const finish = () => {
    setOpen(false);
    window.setTimeout(() => window.location.replace("/"), 300);
  };

  const handleSelect = async (companyDb: string, erpType: string) => {
    if (companyDb === session?.companyDB) {
      setOpen(false);
      return;
    }
    setBusyDb(companyDb);
    try {
      // A troca de empresa é validada apenas pela sessão Google (identidade
      // Lovable Cloud). Nenhum login do ERP é solicitado aqui — a sessão do
      // Service Layer é criada sob demanda, só quando uma ação exigir.
      const { data } = await supabase.auth.getSession();
      const email = data.session?.user?.email || "";
      if (!email) throw new Error("Sessão Google não encontrada. Entre novamente com sua conta Google.");

      const { canEnterCompany } = await import("@/lib/company-access");
      const allowed = await canEnterCompany({ email, companyDb, erpType, isAdmin });
      if (!allowed) {
        toast.error("Acesso não liberado", {
          description: `Sua conta ${email} não está autorizada para ${getLabel(companyDb)}.`,
        });
        return;
      }

      await loginIdentity(companyDb, erpType as never);
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


  if (!session) return null;

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted/60 transition-colors max-w-[260px] ${className}`}
            aria-label="Menu da conta e empresa"
          >
            <Avatar className="w-8 h-8 shrink-0">
              {!impersonation && google?.avatar && <AvatarImage src={google.avatar} alt={google.name || google.email || "Conta Google"} referrerPolicy="no-referrer" />}
              <AvatarFallback className="text-xs">{initials || "?"}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 hidden sm:block">
              <p className="text-sm font-medium text-foreground truncate">{companyLabel}</p>
              <p className="text-xs text-muted-foreground truncate">
                {displayName || google?.name || displayUserName(session.userName)}
              </p>
            </div>
            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72 bg-popover z-50">
          {/* Cartão da conta Google — foto, nome e e-mail */}
          <div className="flex items-center gap-3 px-2 py-3">
            <Avatar className="w-10 h-10 shrink-0">
              {!impersonation && google?.avatar && <AvatarImage src={google.avatar} alt={google.name || google.email || "Conta Google"} referrerPolicy="no-referrer" />}
              <AvatarFallback className="text-sm">{initials || "?"}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {displayName || google?.name || displayUserName(session.userName)}
              </p>
              {(displayEmail || (!impersonation && google?.email)) && (
                <p className="text-xs text-muted-foreground truncate">{displayEmail || google?.email}</p>
              )}
              <p className="text-[11px] text-muted-foreground truncate">
                <Building2 className="w-3 h-3 inline mr-1 -mt-0.5" aria-hidden="true" />
                {companyLabel}
              </p>
            </div>
          </div>
          <DropdownMenuSeparator />


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
              {list.map((c) => {
                const isCurrent = c.company_db === session.companyDB;
                return (
                  <button
                    key={c.company_db}
                    onClick={() => handleSelect(c.company_db, c.erp_type)}
                    disabled={busyDb !== null}
                    className="w-full flex items-center gap-2 rounded-sm pl-8 pr-2 py-1.5 text-left text-sm hover:bg-muted/60 transition-colors disabled:opacity-60"
                  >
                    <span className="flex-1 truncate text-foreground">{c.display_name}</span>
                    {busyDb === c.company_db && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />
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
          <DropdownMenuItem
            onSelect={() => {
              setOpen(false);
              window.location.assign("/perfil");
            }}
          >
            <UserCog className="w-4 h-4 mr-2" /> Meu perfil e senha
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setOpen(false);
              window.location.assign("/perfil?senha=1");
            }}
          >
            <KeyRound className="w-4 h-4 mr-2" /> Alterar senha do ERP
          </DropdownMenuItem>

          {isAdmin && (

            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setOpen(false);
                  setImpersonateOpen(true);
                }}
              >
                <UserCog className="w-4 h-4 mr-2" /> Atuar como outro usuário
              </DropdownMenuItem>
            </>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              const next = !keepAlive;
              setKeepAliveState(next);
              setKeepSessionAlive(next);
              toast.success(
                next
                  ? "Sessão do Google será mantida ativa neste dispositivo."
                  : "Sessão do Google voltará a expirar normalmente."
              );
            }}
          >
            <InfinityIcon className="w-4 h-4 mr-2" />
            <span className="flex-1">Manter sessão do Google ativa</span>
            <Switch checked={keepAlive} className="pointer-events-none" aria-hidden="true" />
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onSelect={() => {
              setOpen(false);
              void resetTour(whatsNewTourKey);
              window.dispatchEvent(new CustomEvent(WHATSNEW_REPLAY_EVENT));
            }}
          >
            <Sparkles className="w-4 h-4 mr-2" /> Reiniciar tour inicial
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              void resetTour(onboardingTourKey);
              window.dispatchEvent(new CustomEvent(ONBOARDING_REPLAY_EVENT));
            }}
          >
            <Compass className="w-4 h-4 mr-2" /> Rever tour de boas-vindas
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => logout()}>
            <LogOut className="w-4 h-4 mr-2" /> Sair da empresa
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={signingOut}
            onSelect={(e) => {
              e.preventDefault();
              void handleGoogleSignOut();
            }}
          >
            {signingOut ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <LogOut className="w-4 h-4 mr-2" />
            )}
            Sair da conta Google
          </DropdownMenuItem>

        </DropdownMenuContent>
      </DropdownMenu>




      {isAdmin && (
        <ImpersonationDialog open={impersonateOpen} onOpenChange={setImpersonateOpen} />
      )}
    </>
  );
}

