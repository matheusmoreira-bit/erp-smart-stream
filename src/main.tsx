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
let impersonationReconciled = false;
supabase.auth.onAuthStateChange((event, session) => {
  if (impersonationReconciled || !session) return;
  if (event !== "INITIAL_SESSION" && event !== "SIGNED_IN") return;
  impersonationReconciled = true;
  void (async () => {
    const { isImpersonating } = await import("./lib/impersonation.ts");
    if (isImpersonating()) return;
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
