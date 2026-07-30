import { ChevronDown, Check, LayoutGrid } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface SubmenuItem {
  key: string;
  label: string;
}

interface SubmenuBarProps {
  /** Nome do módulo pai (ex.: "Vendas") */
  moduleLabel?: string;
  items: SubmenuItem[];
  active: string;
  onSelect: (key: string) => void;
}

/**
 * Barra de submenu compacta usada nas telas de módulo.
 * Substitui a antiga régua de abas por um seletor em dropdown,
 * que funciona bem tanto no desktop quanto no mobile.
 */
export function SubmenuBar({ moduleLabel, items, active, onSelect }: SubmenuBarProps) {
  const navigate = useNavigate();
  const current = items.find((i) => i.key === active) ?? items[0];

  return (
    <div className="sticky top-[var(--app-header-h,72px)] z-20 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 h-12 flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate("/")}
          aria-label="Ir para os módulos"
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          <LayoutGrid className="w-4 h-4" />
        </button>

        {moduleLabel ? (
          <>
            <span className="text-sm text-muted-foreground truncate max-w-[35vw] sm:max-w-none">
              {moduleLabel}
            </span>
            <span className="text-muted-foreground/50">/</span>
          </>
        ) : null}

        {items.length <= 1 ? (
          <span className="text-sm font-semibold text-foreground truncate">
            {current?.label}
          </span>
        ) : (
        <>
          {/* Desktop: pílulas horizontais */}
          <nav className="hidden md:flex items-center gap-1 overflow-x-auto rounded-full bg-muted/50 p-1">
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onSelect(item.key)}
                aria-current={item.key === current?.key ? "page" : undefined}
                className={cn(
                  "whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-colors",
                  item.key === current?.key
                    ? "bg-background text-foreground font-semibold shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/60",
                )}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Mobile: dropdown compacto */}
          <div className="md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2 font-semibold text-foreground data-[state=open]:bg-muted/60"
            >
              <span className="truncate max-w-[45vw] sm:max-w-none">{current?.label}</span>
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {moduleLabel ? `${moduleLabel} — submódulos` : "Submódulos"}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {items.map((item) => (
              <DropdownMenuItem
                key={item.key}
                onSelect={() => onSelect(item.key)}
                className={cn(
                  "gap-2 cursor-pointer",
                  item.key === current?.key && "text-primary font-medium",
                )}
              >
                <Check
                  className={cn(
                    "w-4 h-4",
                    item.key === current?.key ? "opacity-100" : "opacity-0",
                  )}
                />
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
          </div>
        </>
        )}

      </div>
    </div>
  );
}
