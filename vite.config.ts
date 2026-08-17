import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { componentTagger } from "lovable-tagger";

const REQUIRED_CLIENT_ENV = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
] as const;

function assertRequiredClientEnv(mode: string) {
  const env = loadEnv(mode, process.cwd(), "");
  const missing = REQUIRED_CLIENT_ENV.filter((key) => !env[key]?.trim());

  if (missing.length > 0) {
    throw new Error(
      [
        `Missing required Vite env: ${missing.join(", ")}`,
        "Set them in .env or pass Docker build args before running npm run build.",
      ].join("\n"),
    );
  }

  const fakeAuthEnabled = ["1", "true", "yes", "on"].includes(
    String(env.VITE_ENABLE_FAKE_AUTH || "").trim().toLowerCase(),
  );
  if (fakeAuthEnabled) {
    const backendUrl = env.VITE_SUPABASE_URL || "";
    const localBackend = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/i.test(backendUrl);
    if (env.VITE_SUPABASE_PROJECT_ID !== "standalone-local" || !localBackend) {
      throw new Error(
        "VITE_ENABLE_FAKE_AUTH só pode ser usado com project_id=standalone-local e backend local.",
      );
    }
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  if (command === "build") {
    assertRequiredClientEnv(mode);
  }

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": new URL("./src", import.meta.url).pathname,
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
    },
    build: {
      // S1.4 — não publicar source maps em produção (evita expor código-fonte).
      sourcemap: mode === "development",
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) {
              return "react-vendor";
            }
            if (id.includes("node_modules/@supabase/")) return "supabase-vendor";
            if (id.includes("node_modules/@radix-ui/")) return "radix-vendor";
            return undefined;
          },
        },
      },
    },
  };
});
