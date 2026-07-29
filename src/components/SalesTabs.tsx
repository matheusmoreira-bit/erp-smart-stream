import { NavLink } from "react-router-dom";
import { ClipboardList, FileText, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/vendas/pedidos", label: "Pedidos de Venda", icon: ClipboardList },
  { to: "/vendas/nfse", label: "NFS-e", icon: FileText },
  { to: "/vendas/recebimentos", label: "Contas a Receber", icon: Wallet },
];

/** Navegação entre os submódulos do ciclo de vendas. */
export function SalesTabs() {
  return (
    <nav
      aria-label="Submódulos de vendas"
      className="border-b border-border bg-muted/20 px-4 sm:px-6"
    >
      <div className="max-w-7xl mx-auto flex gap-1 overflow-x-auto">
        {TABS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 whitespace-nowrap px-3 py-2.5 text-sm border-b-2 -mb-px transition-colors",
                isActive
                  ? "border-primary text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )
            }
          >
            <Icon className="w-4 h-4" />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
