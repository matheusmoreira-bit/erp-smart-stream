import { useState } from "react";
import { Menu, Lock, LayoutGrid } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useModuleAccess } from "@/hooks/usePermissions";
import {
  modules,
  moduleGroups,
  moduleHasAccess,
  firstAccessiblePath,
  type ModuleCard,
} from "@/lib/modules-catalog";

/**
 * Menu lateral com os módulos do painel, na mesma ordem/agrupamento do dashboard.
 * Renderizado no cabeçalho das telas internas.
 */
export function ModulesNavSheet() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { userModules, loading: permLoading } = useModuleAccess();

  const go = (mod: ModuleCard) => {
    setOpen(false);
    navigate(firstAccessiblePath(mod, userModules, permLoading));
  };

  const isActive = (mod: ModuleCard) => {
    const base = mod.path.split("?")[0];
    return base !== "/" && pathname.startsWith(base);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Abrir menu de módulos"
        >
          <Menu className="w-5 h-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-80 overflow-y-auto p-0">
        <SheetHeader className="border-b border-border px-4 py-4 text-left">
          <SheetTitle className="flex items-center gap-2 text-base">
            <LayoutGrid className="h-4 w-4 text-primary" aria-hidden="true" />
            Módulos
          </SheetTitle>
          <SheetDescription className="text-xs">
            Navegue entre os módulos sem voltar ao painel.
          </SheetDescription>
        </SheetHeader>

        <nav className="px-2 py-3">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate("/");
            }}
            className="mb-2 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted/60"
          >
            <LayoutGrid className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Painel de módulos
          </button>

          {moduleGroups.map((group) => {
            const groupModules = group.keys
              .map((k) => modules[k])
              .filter((m): m is ModuleCard => Boolean(m));
            const visible = groupModules.filter(
              (m) => permLoading || moduleHasAccess(m, userModules),
            );
            if (visible.length === 0) return null;
            return (
              <div key={group.title} className="mb-3">
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.title}
                </p>
                <ul className="space-y-0.5">
                  {visible.map((mod) => {
                    const Icon = mod.icon;
                    const allowed = permLoading || moduleHasAccess(mod, userModules);
                    return (
                      <li key={`${group.title}-${mod.title}`}>
                        <button
                          type="button"
                          disabled={!allowed}
                          aria-current={isActive(mod) ? "page" : undefined}
                          onClick={() => allowed && go(mod)}
                          className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                            isActive(mod)
                              ? "bg-primary/10 font-medium text-foreground"
                              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                          } ${allowed ? "" : "cursor-not-allowed opacity-50"}`}
                        >
                          <Icon className={`h-4 w-4 shrink-0 ${group.color}`} aria-hidden="true" />
                          <span className="truncate">{mod.title}</span>
                          {!allowed && <Lock className="ml-auto h-3.5 w-3.5" aria-hidden="true" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}

export default ModulesNavSheet;
