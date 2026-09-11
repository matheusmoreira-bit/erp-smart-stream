import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Identificador do build atual, injetado pelo Vite em tempo de compilação. */
declare const __APP_BUILD_ID__: string;
const CURRENT_BUILD_ID = typeof __APP_BUILD_ID__ === "string" ? __APP_BUILD_ID__ : "dev";

const CHECK_INTERVAL_MS = 120_000;
const RELOAD_GUARD_KEY = "erp:reload-guard";

/** Recarrega a página forçando o navegador a buscar o HTML/JS novos. */
function hardReload() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0);
    // Evita loop de recarga caso o servidor devolva versões inconsistentes.
    if (Date.now() - last < 30_000) return;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    /* storage indisponível — segue com o reload */
  }
  const url = new URL(window.location.href);
  url.searchParams.set("_v", Date.now().toString(36));
  window.location.replace(url.toString());
}

async function fetchDeployedBuildId(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { buildId?: unknown };
    return typeof data.buildId === "string" ? data.buildId : null;
  } catch {
    return null;
  }
}

/**
 * Garante que todos os usuários rodem a última versão publicada.
 *
 * - Consulta `/version.json` (sem cache) periodicamente, ao voltar o foco e a
 *   cada troca de tela.
 * - Ao detectar versão nova, avisa e recarrega na próxima navegação.
 * - Recarrega automaticamente quando um pedaço antigo do app some do servidor
 *   (erro típico de cache velho após deploy).
 */
export function AppVersionAgent() {
  const [stale, setStale] = useState(false);
  const location = useLocation();
  const staleRef = useRef(false);
  const notifiedRef = useRef(false);

  useEffect(() => {
    staleRef.current = stale;
  }, [stale]);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      if (cancelled || staleRef.current || document.visibilityState === "hidden") return;
      const deployed = await fetchDeployedBuildId();
      if (cancelled || !deployed || deployed === CURRENT_BUILD_ID) return;
      setStale(true);
      if (notifiedRef.current) return;
      notifiedRef.current = true;
      toast("Nova versão disponível", {
        duration: Infinity,
        description: "Atualize para carregar a versão mais recente do sistema.",
        action: {
          label: "Atualizar agora",
          onClick: () => hardReload(),
        },
      });
    };

    const timer = window.setInterval(check, CHECK_INTERVAL_MS);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    void check();

    // Arquivo antigo removido do servidor após um deploy: recarrega na hora.
    const onChunkError = (event: Event) => {
      const message = String(
        (event as ErrorEvent).message ||
          ((event as PromiseRejectionEvent).reason as { message?: string })?.message ||
          "",
      );
      if (/dynamically imported module|Importing a module script failed|ChunkLoadError|Failed to fetch dynamically/i.test(message)) {
        hardReload();
      }
    };
    window.addEventListener("error", onChunkError);
    window.addEventListener("unhandledrejection", onChunkError as EventListener);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("error", onChunkError);
      window.removeEventListener("unhandledrejection", onChunkError as EventListener);
    };
  }, []);

  // Troca de tela é o momento seguro para aplicar a atualização: nenhum
  // formulário aberto é perdido no meio do preenchimento.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (stale) hardReload();
  }, [location.pathname, stale]);

  if (!stale) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[60] mb-[env(safe-area-inset-bottom)]">
      <Button size="sm" onClick={() => hardReload()} className="rounded-full shadow-lg">
        <RefreshCw className="w-3.5 h-3.5 mr-2" aria-hidden="true" />
        Atualizar para a nova versão
      </Button>
    </div>
  );
}
