import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

const BUILD_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Publica /version.json com o identificador do build para o app detectar,
 * em runtime, que existe uma versão mais nova publicada.
 */
function buildVersionPlugin(): Plugin {
  const payload = JSON.stringify({ buildId: BUILD_ID, builtAt: new Date().toISOString() });
  return {
    name: "erp-build-version",
    configureServer(server) {
      server.middlewares.use("/version.json", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(payload);
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: payload });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const localBackendProxyTarget =
    process.env.VITE_LOCAL_BACKEND_PROXY_TARGET ||
    env.VITE_LOCAL_BACKEND_PROXY_TARGET;

  return {
    server: {
      host: "::",
      port: 8080,
      proxy: localBackendProxyTarget
        ? {
            "/local-api": {
              target: localBackendProxyTarget,
              changeOrigin: true,
              ws: true,
              rewrite: (requestPath) => requestPath.replace(/^\/local-api/, ""),
            },
          }
        : undefined,
      hmr: {
        overlay: false,
      },
    },
    define: {
      __APP_BUILD_ID__: JSON.stringify(BUILD_ID),
    },
    plugins: [
      react(),
      buildVersionPlugin(),
      mode === "development" && componentTagger(),
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    build: {
      // S1.4 — não publicar source maps em produção (evita expor código-fonte).
      sourcemap: mode === "development",
    },
  };
});
