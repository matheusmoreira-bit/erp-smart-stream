import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";
import { installDbMetrics } from "./lib/db-metrics.ts";
import { installReadOnlyGuards } from "./lib/read-only-guard.ts";
import { supabase } from "./integrations/supabase/client.ts";

installDbMetrics();
// Impersonação é somente leitura: bloqueia mutações no client do Cloud.
installReadOnlyGuards(supabase as never);

// F12: se o navegador não está mais em impersonação (aba fechada, logout),
// encerra no servidor qualquer impersonação órfã desse usuário.
const IMPERSONATION_HEARTBEAT_KEY = "erp_impersonation_heartbeat";
const beatImpersonation = () => {
  void import("./lib/impersonation.ts").then(({ isImpersonating }) => {
    try {
      if (isImpersonating()) localStorage.setItem(IMPERSONATION_HEARTBEAT_KEY, String(Date.now()));
    } catch { /* ignore */ }
  });
};
beatImpersonation();
setInterval(beatImpersonation, 30_000);
window.addEventListener("erp:impersonation-changed", beatImpersonation);
let impersonationReconciled = false;
supabase.auth.onAuthStateChange((event, session) => {
  // F13: saiu da conta → nenhum dado local do usuário sobrevive.
  if (event === "SIGNED_OUT") {
    void import("./lib/clear-erp-local-state.ts").then((m) => m.clearErpLocalState()).catch((error) => console.error("[logout] limpeza local incompleta", error));
    return;
  }
  if (impersonationReconciled || !session) return;
  if (event !== "INITIAL_SESSION" && event !== "SIGNED_IN") return;
  impersonationReconciled = true;
  void (async () => {
    const { isImpersonating } = await import("./lib/impersonation.ts");
    if (isImpersonating()) return;
    // sessionStorage é por aba: se outra aba ainda está impersonando
    // (heartbeat recente), não encerra a sessão dela no servidor.
    const hb = Number(localStorage.getItem(IMPERSONATION_HEARTBEAT_KEY) || 0);
    if (Date.now() - hb < 90_000) return;
    const { data } = await supabase.from("impersonation_sessions").select("id").is("ended_at", null).limit(1);
    if (!data || data.length === 0) return;
    const { authFetch } = await import("./lib/auth-fetch.ts");
    await authFetch("impersonation-audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "reconcile" }),
    }).catch(() => undefined);
  })();
});

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <App />
  </HelmetProvider>,
);
