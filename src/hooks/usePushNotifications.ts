import { useCallback, useEffect, useState } from "react";
import { sapFunctionFetch } from "@/lib/auth-fetch";

const SW_URL = "/push-sw.js";
const SW_SCOPE = "/push/";

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

export type PushPermission = "default" | "granted" | "denied";

interface State {
  supported: boolean;
  configured: boolean;
  permission: PushPermission;
  subscribed: boolean;
  loading: boolean;
  error: string | null;
}

async function call(action: string, payload: Record<string, unknown> = {}) {
  const res = await sapFunctionFetch("push-subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Falha na operação (${res.status}).`);
  return json;
}

/** Gerencia a inscrição de Web Push (VAPID) do usuário neste dispositivo. */
export function usePushNotifications() {
  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  const [state, setState] = useState<State>({
    supported,
    configured: false,
    permission: supported ? (Notification.permission as PushPermission) : "denied",
    subscribed: false,
    loading: true,
    error: null,
  });

  const refresh = useCallback(async () => {
    if (!supported) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }
    try {
      const key = await call("get-key");
      const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      setState((s) => ({
        ...s,
        configured: !!key?.configured,
        subscribed: !!sub,
        permission: Notification.permission as PushPermission,
        loading: false,
        error: null,
      }));
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }));
    }
  }, [supported]);

  useEffect(() => { void refresh(); }, [refresh]);

  const enable = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { public_key: publicKey, configured } = await call("get-key");
      if (!configured || !publicKey) throw new Error("Push não configurado no servidor.");

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState((s) => ({ ...s, loading: false, permission: permission as PushPermission }));
        return false;
      }

      const reg = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
      await navigator.serviceWorker.ready.catch(() => undefined);
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ||
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));

      const raw = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      await call("subscribe", {
        endpoint: raw.endpoint,
        keys: raw.keys,
        user_agent: navigator.userAgent,
      });
      setState((s) => ({ ...s, subscribed: true, permission: "granted", loading: false }));
      return true;
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }));
      return false;
    }
  }, []);

  const disable = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await call("unsubscribe", { endpoint: sub.endpoint }).catch(() => undefined);
        await sub.unsubscribe().catch(() => undefined);
      }
      setState((s) => ({ ...s, subscribed: false, loading: false }));
      return true;
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }));
      return false;
    }
  }, []);

  const sendTest = useCallback(async () => {
    const res = await call("test");
    return res as { ok: boolean; sent: number; failed: number };
  }, []);

  return { ...state, enable, disable, sendTest, refresh };
}
