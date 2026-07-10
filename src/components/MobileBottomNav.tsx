import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ClipboardCheck, ShoppingCart, Bell, Menu, Home } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNotifications } from "@/hooks/useNotifications";
import { useModuleAccess } from "@/hooks/usePermissions";
import { useSap } from "@/contexts/SapContext";
import { MobileMenuSheet } from "@/components/MobileMenuSheet";

interface Item {
  to?: string;
  label: string;
  icon: typeof Home;
  moduleKey?: string;
  onClick?: () => void;
  badge?: number;
  active?: boolean;
}

export function MobileBottomNav() {
  const { session } = useSap();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const { userModules } = useModuleAccess();

  // Only show when user is authenticated
  const hasSession = !!session?.userName;

  let unreadCount = 0;
  try {
    const n = useNotifications();
    unreadCount = n.unreadCount ?? 0;
  } catch {
    unreadCount = 0;
  }

  if (!hasSession) return null;

  const canApprovals =
    userModules.includes("approvals") || userModules.includes("approval_history");
  const canExpenses = userModules.includes("expenses");

  const items: Item[] = [
    { to: "/", label: "Início", icon: Home },
    ...(canApprovals
      ? [{ to: "/aprovacoes", label: "Aprovar", icon: ClipboardCheck } as Item]
      : []),
    ...(canExpenses
      ? [{ to: "/compras", label: "Compras", icon: ShoppingCart } as Item]
      : []),
    { to: "/notificacoes", label: "Alertas", icon: Bell, badge: unreadCount },
    {
      label: "Menu",
      icon: Menu,
      onClick: () => setMenuOpen(true),
      active: menuOpen,
    },
  ];

  return (
    <>
      <nav
        className={cn(
          "md:hidden fixed inset-x-0 bottom-0 z-40",
          "bg-background/95 backdrop-blur-lg border-t border-border",
          "pb-[max(env(safe-area-inset-bottom),0.25rem)]",
        )}
        aria-label="Navegação principal"
      >
        <ul className="grid grid-cols-5">
          {items.map((it, idx) => {
            const Icon = it.icon;
            const isActive =
              it.active ??
              (it.to
                ? it.to === "/"
                  ? location.pathname === "/"
                  : location.pathname.startsWith(it.to)
                : false);
            const content = (
              <div
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 py-2 px-1 min-h-14 relative",
                  isActive ? "text-primary" : "text-muted-foreground",
                )}
              >
                <div className="relative">
                  <Icon className="w-5 h-5" />
                  {it.badge && it.badge > 0 ? (
                    <span className="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                      {it.badge > 99 ? "99+" : it.badge}
                    </span>
                  ) : null}
                </div>
                <span className="text-[10px] font-medium leading-none">
                  {it.label}
                </span>
                {isActive && (
                  <span className="absolute top-0 inset-x-6 h-0.5 bg-primary rounded-b-full" />
                )}
              </div>
            );
            return (
              <li key={idx}>
                {it.to ? (
                  <NavLink to={it.to} className="block active:opacity-70">
                    {content}
                  </NavLink>
                ) : (
                  <button
                    type="button"
                    onClick={it.onClick}
                    className="w-full active:opacity-70"
                  >
                    {content}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
      <MobileMenuSheet open={menuOpen} onOpenChange={setMenuOpen} />
    </>
  );
}
