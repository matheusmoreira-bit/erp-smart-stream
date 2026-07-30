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

  if (!session?.userName) return null;
  if (pathname === "/" || pathname.startsWith("/backoffice")) return null;

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

  return (
    <SubmenuBar
      moduleLabel={mod.label}
      items={items.map((i) => ({ key: i.path, label: i.label }))}
      active={active}
      onSelect={(key) => navigate(key)}
    />
  );
}
