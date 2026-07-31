import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { SubmenuBar } from "@/components/SubmenuBar";
import { findNavModule } from "@/lib/nav-map";
import { useModuleAccess } from "@/hooks/usePermissions";
import { useSap } from "@/contexts/SapContext";

/**
 * Barra de submenu global: aparece no topo de todas as telas de módulo
 * (acima do cabeçalho da página) e permite trocar de submódulo sem voltar ao painel.
 */
export function ModuleSubmenu() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { session } = useSap();
  const { userModules } = useModuleAccess();
  const [host, setHost] = useState<HTMLElement | null>(null);
  // Quando a tela não tem um <header> próprio, renderizamos a régua inline
  // (no topo do conteúdo) em vez de sumir com o breadcrumb.
  const [inline, setInline] = useState(false);

  // Monta um container logo abaixo do <header> sticky da página atual,
  // para que o breadcrumb apareça sob a logo (e não acima dela).
  useEffect(() => {
    let cancelled = false;
    setHost(null);
    setInline(false);
    const attach = () => {
      if (cancelled) return true;
      const header =
        document.querySelector<HTMLElement>("header.border-b") ||
        document.querySelector<HTMLElement>("header");
      if (!header || !header.parentElement) return false;
      let el = document.getElementById("module-submenu-host");
      if (!el) {
        el = document.createElement("div");
        el.id = "module-submenu-host";
      }
      if (header.nextSibling !== el) {
        header.parentElement.insertBefore(el, header.nextSibling);
      }
      setHost(el);
      return true;
    };
    if (!attach()) {
      const t = window.setInterval(() => {
        if (attach()) window.clearInterval(t);
      }, 50);
      const to = window.setTimeout(() => {
        window.clearInterval(t);
        if (!cancelled) setInline(true);
      }, 1500);
      return () => {
        cancelled = true;
        window.clearInterval(t);
        window.clearTimeout(to);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [pathname]);


  if (!session?.userName) return null;
  if (pathname === "/" || pathname.startsWith("/backoffice")) return null;
  // Hubs com régua própria (TabsHub) — evita barra duplicada.
  // Vendas não usa TabsHub, então mantém a régua global.
  if (/^\/(usuarios|auditoria|integracoes)\b/.test(pathname)) return null;

  const mod = findNavModule(pathname);
  if (!mod) return null;

  const items = mod.items.filter(
    (i) => !i.moduleKey || userModules.length === 0 || userModules.includes(i.moduleKey),
  );
  if (items.length === 0) return null;

  const current = `${pathname}${search}`;
  const active =
    items.find((i) => i.path === current)?.path ??
    items.find((i) => pathname === i.path.split("?")[0])?.path ??
    items.find((i) => pathname.startsWith(i.path.split("?")[0]))?.path ??
    items[0].path;

  const bar = (
    <SubmenuBar
      moduleLabel={mod.label}
      items={items.map((i) => ({ key: i.path, label: i.label }))}
      active={active}
      onSelect={(key) => navigate(key)}
    />
  );

  return host ? createPortal(bar, host) : null;
}
