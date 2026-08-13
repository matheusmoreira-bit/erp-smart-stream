import { useEffect, useState } from "react";
import { Loader2, UserCog, Undo2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSap } from "@/contexts/SapContext";
import { Button } from "@/components/ui/button";
import {
  getImpersonation,
  clearImpersonation,
  IMPERSONATION_EVENT,
  logImpersonationServerSide,
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
  const queryClient = useQueryClient();
  const { impersonateAs } = useSap();

  useEffect(() => {
    const sync = () => setState(getImpersonation());
    window.addEventListener(IMPERSONATION_EVENT, sync);
    return () => window.removeEventListener(IMPERSONATION_EVENT, sync);
  }, []);

  if (!state) return null;

  const stop = async () => {
    setBusy(true);
    await logImpersonationServerSide({
      event: "stop",
      target_user: state.targetUser,
      target_name: state.targetName || null,
      target_email: state.targetEmail || null,
      company_db: state.companyDB,
      with_password: !!state.withPassword,
      started_at: new Date(state.startedAt).toISOString(),
    });

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

    // Caminho preferido: volta à identidade original em memória, sem recarregar
    // a página — a tela atual (rota, filtros, formulários) é preservada.
    const adminUser = state.adminUser;
    if (!state.withPassword && adminUser) {
      clearImpersonation();
      clearAuthCache();
      impersonateAs(adminUser);
      try { queryClient.invalidateQueries(); } catch { /* ignore */ }
      setBusy(false);
      toast.success("Você voltou ao seu usuário");
      return;
    }

    // Fallback: houve login real no ERP com a senha do alvo, então é preciso
    // reidratar a sessão do admin do zero.
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
        <Button
          size="sm"
          variant="secondary"
          className="rounded-full"
          onClick={stop}
          disabled={busy}
          title="Encerra a impersonação mantendo a tela atual"
        >
          {busy ? (
            <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
          ) : (
            <Undo2 className="w-3.5 h-3.5 mr-2" aria-hidden="true" />
          )}
          Voltar ao meu usuário
        </Button>
      </div>
    </>
  );
}

