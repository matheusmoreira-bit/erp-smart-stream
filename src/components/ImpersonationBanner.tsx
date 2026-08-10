import { useEffect, useState } from "react";
import { Loader2, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getImpersonation,
  clearImpersonation,
  IMPERSONATION_EVENT,
  type ImpersonationState,
} from "@/lib/impersonation";
import { clearAuthCache } from "@/lib/auth-cache";
import { logAuditAction } from "@/hooks/useAuditLog";
import { displayUserName } from "@/lib/user-display";

/**
 * Faixa fixa exibida enquanto o admin está atuando como outro usuário.
 * É o único caminho de saída — durante a impersonação o menu de admin some.
 */
export function ImpersonationBanner() {
  const [state, setState] = useState<ImpersonationState | null>(() => getImpersonation());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sync = () => setState(getImpersonation());
    window.addEventListener(IMPERSONATION_EVENT, sync);
    return () => window.removeEventListener(IMPERSONATION_EVENT, sync);
  }, []);

  if (!state) return null;

  const stop = async () => {
    setBusy(true);
    try {
      await logAuditAction({
        action: "impersonation_stop",
        entity_type: "erp_session",
        actor_email: state.adminEmail,
        company_db: state.companyDB,
        details: { target_user: state.targetUser },
      });
    } catch {
      /* auditoria nunca bloqueia a saída */
    }
    clearImpersonation();
    clearAuthCache();
    try {
      const { clearErpLocalState } = await import("@/lib/clear-erp-local-state");
      clearErpLocalState();
      sessionStorage.removeItem("erp_session_v1");
    } catch {
      /* ignore */
    }
    window.location.replace("/");
  };

  return (
    <>
      {/* Moldura ao redor da tela inteira indicando sessão impersonada */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[70] border-4 border-warning/80 rounded-sm"
        style={{ boxShadow: "inset 0 0 24px hsl(var(--warning) / 0.25)" }}
      />

      {/* Etiqueta flutuante com o botão de sair da sessão */}
      <div className="fixed bottom-4 right-4 z-[71] flex items-center gap-3 rounded-full bg-warning/95 text-warning-foreground border border-warning shadow-lg px-4 py-2 mb-[env(safe-area-inset-bottom)]">
        <UserCog className="w-4 h-4 shrink-0" aria-hidden="true" />
        <p className="text-sm max-w-[16rem] truncate">
          Atuando como{" "}
          <strong>{displayUserName(state.targetName || state.targetUser)}</strong>
        </p>
        <Button size="sm" variant="secondary" className="rounded-full" onClick={stop} disabled={busy}>
          {busy && <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />}
          Sair
        </Button>
      </div>
    </>
  );
}

