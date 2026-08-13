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

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <App />
  </HelmetProvider>,
);
