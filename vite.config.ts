import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
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
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
    },
    build: {
      // S1.4 — não publicar source maps em produção (evita expor código-fonte).
      sourcemap: mode === "development",
    },
  };
});
