import { supabase } from "@/integrations/supabase/client";

/**
 * "Manter sessão do Google ativa"
 *
 * Quando ligado, o app renova o token de acesso periodicamente (e ao voltar o
 * foco da aba), mantendo o refresh token rotacionando — na prática o usuário
 * segue logado por tempo indeterminado, sem precisar refazer o login Google.
 *
 * Segurança: nada de credencial é armazenado. Apenas uma flag local que
 * dispara o refresh normal do provedor de auth; o logout continua encerrando
 * a sessão imediatamente.
 */
const STORAGE_KEY = "erpflow.keep_session_alive";
const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 min
export const KEEPALIVE_EVENT = "erpflow:keep-session-alive-changed";

export function isKeepSessionAlive(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setKeepSessionAlive(enabled: boolean) {
  try {
    if (enabled) localStorage.setItem(STORAGE_KEY, "1");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage indisponível */
  }
  window.dispatchEvent(new CustomEvent(KEEPALIVE_EVENT, { detail: enabled }));
  syncKeepAlive();
}

let timer: ReturnType<typeof setInterval> | null = null;
let listenersBound = false;
let refreshing = false;

async function refreshNow() {
  if (refreshing || document.visibilityState === "hidden") return;
  refreshing = true;
  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    await supabase.auth.refreshSession();
  } catch {
    /* falha de rede: tenta de novo no próximo ciclo */
  } finally {
    refreshing = false;
  }
}

function onVisible() {
  if (document.visibilityState === "visible") void refreshNow();
}

/** Liga/desliga o timer conforme a flag atual. Idempotente. */
export function syncKeepAlive() {
  const enabled = isKeepSessionAlive();

  if (!enabled) {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (listenersBound) {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      listenersBound = false;
    }
    return;
  }

  if (!timer) {
    timer = setInterval(() => void refreshNow(), REFRESH_INTERVAL_MS);
    void refreshNow();
  }
  if (!listenersBound) {
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    listenersBound = true;
  }
}
