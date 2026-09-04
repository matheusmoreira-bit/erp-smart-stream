import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

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
    plugins: [react(), mode === "development" && componentTagger()].filter(
      Boolean,
    ),
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
