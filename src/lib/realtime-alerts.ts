import { toast } from "sonner";

/**
 * Alerta em tempo real de notificações recebidas com a sessão ativa.
 * Mostra um toast clicável e, se o usuário tiver concedido permissão,
 * também uma notificação nativa do navegador.
 */
export interface RealtimeAlertInput {
  id: string;
  title: string;
  body?: string | null;
  link?: string | null;
  category?: string | null;
}

const shown = new Set<string>();

export function canUseBrowserNotifications() {
  return typeof window !== "undefined" && "Notification" in window;
}

export async function requestBrowserNotificationPermission(): Promise<boolean> {
  if (!canUseBrowserNotifications()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

export function showRealtimeAlert(
  n: RealtimeAlertInput,
  navigate?: (path: string) => void,
) {
  if (shown.has(n.id)) return;
  shown.add(n.id);

  const isApproval = (n.category || "") === "approval";
  const fn = isApproval ? toast.info : toast;
  fn(n.title, {
    description: n.body || undefined,
    duration: 12000,
    action: n.link
      ? {
          label: "Abrir",
          onClick: () => {
            if (navigate) navigate(n.link as string);
            else window.location.assign(n.link as string);
          },
        }
      : undefined,
  });

  // Notificação nativa (quando a aba está em segundo plano e há permissão).
  if (
    canUseBrowserNotifications() &&
    Notification.permission === "granted" &&
    document.visibilityState !== "visible"
  ) {
    try {
      const native = new Notification(n.title, {
        body: n.body || undefined,
        tag: n.id,
      });
      native.onclick = () => {
        window.focus();
        if (n.link) window.location.assign(n.link);
        native.close();
      };
    } catch {
      /* navegador bloqueou — o toast já cobre o caso */
    }
  }
}
