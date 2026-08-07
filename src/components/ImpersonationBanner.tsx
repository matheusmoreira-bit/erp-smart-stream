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
    <div className="fixed bottom-0 inset-x-0 z-[60] bg-warning/95 text-warning-foreground border-t border-warning shadow-lg">
      <div className="max-w-5xl mx-auto flex items-center gap-3 px-4 py-2 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
        <UserCog className="w-4 h-4 shrink-0" aria-hidden="true" />
        <p className="text-sm flex-1 min-w-0 truncate">
          Você está atuando como{" "}
          <strong>{displayUserName(state.targetName || state.targetUser)}</strong>
          <span className="hidden sm:inline"> · sessão iniciada por {state.adminEmail}</span>
        </p>
        <Button size="sm" variant="secondary" onClick={stop} disabled={busy}>
          {busy && <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />}
          Encerrar
        </Button>
      </div>
    </div>
  );
}
