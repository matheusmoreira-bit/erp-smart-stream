import { Bell, BellOff, Loader2, Send, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { usePushNotifications } from "@/hooks/usePushNotifications";

/** Ativa/desativa notificações push nativas (Web Push) neste dispositivo. */
export function PushNotificationsCard() {
  const { supported, configured, permission, subscribed, loading, error, enable, disable, sendTest } =
    usePushNotifications();

  const handleToggle = async (next: boolean) => {
    if (next) {
      const ok = await enable();
      if (ok) toast.success("Push ativado neste dispositivo");
      else if (Notification?.permission === "denied") {
        toast.error("Permissão negada pelo navegador. Libere as notificações nas configurações do site.");
      }
    } else {
      const ok = await disable();
      if (ok) toast.success("Push desativado neste dispositivo");
    }
  };

  const handleTest = async () => {
    try {
      const res = await sendTest();
      if (res.ok) toast.success("Notificação de teste enviada");
      else toast.error("Nenhum envio concluído. Verifique as permissões do dispositivo.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar teste");
    }
  };

  return (
    <div className="glass-card p-6 mb-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex gap-3">
          <span className="mt-0.5 text-primary">
            <Smartphone className="w-5 h-5" aria-hidden />
          </span>
          <div>
            <h3 className="text-base font-semibold text-foreground">Notificações push no celular</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              Receba um aviso no aparelho assim que surgir uma aprovação pendente, mesmo com o app fechado.
              A ativação vale apenas para este dispositivo/navegador.
            </p>
            {!supported && (
              <p className="text-xs text-destructive mt-2">
                Este navegador não suporta push. No iPhone, instale o app na tela de início e ative por lá.
              </p>
            )}
            {supported && !configured && (
              <p className="text-xs text-destructive mt-2">
                Push ainda não configurado no servidor (credenciais de mensageria ausentes).
              </p>
            )}
            {permission === "denied" && (
              <p className="text-xs text-destructive mt-2">
                Notificações bloqueadas nas permissões do navegador para este site.
              </p>
            )}
            {error && <p className="text-xs text-destructive mt-2">{error}</p>}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" aria-hidden />}
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {subscribed ? (
              <span className="inline-flex items-center gap-1"><Bell className="w-3.5 h-3.5" /> Ativo</span>
            ) : (
              <span className="inline-flex items-center gap-1"><BellOff className="w-3.5 h-3.5" /> Inativo</span>
            )}
          </span>
          <Switch
            checked={subscribed}
            disabled={!supported || !configured || loading || permission === "denied"}
            onCheckedChange={handleToggle}
            aria-label="Ativar notificações push neste dispositivo"
          />
        </div>
      </div>

      {subscribed && (
        <div className="mt-4 pt-4 border-t border-border">
          <Button variant="outline" size="sm" className="gap-2" onClick={handleTest} disabled={loading}>
            <Send className="w-4 h-4" /> Enviar teste
          </Button>
        </div>
      )}
    </div>
  );
}

export default PushNotificationsCard;
