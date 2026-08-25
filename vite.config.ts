import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    proxy: process.env.VITE_LOCAL_BACKEND_PROXY_TARGET
      ? {
          "/local-api": {
            target: process.env.VITE_LOCAL_BACKEND_PROXY_TARGET,
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
}));
