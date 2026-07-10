import { cn } from "@/lib/utils";

export interface HubTab {
  key: string;
  label: string;
}

interface HubTabsProps {
  tabs: HubTab[];
  active: string;
  onChange: (key: string) => void;
}

/**
 * Thin tab strip used by hub pages (Aprovações, Auditoria, Integrações, Usuários).
 * Sits at the very top of the viewport above the inner page's own header.
 */
export function HubTabs({ tabs, active, onChange }: HubTabsProps) {
  if (tabs.length <= 1) return null;
  return (
    <div className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="max-w-7xl mx-auto px-2 sm:px-6">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none snap-x snap-mandatory">
          {tabs.map((t) => {
            const isActive = t.key === active;
            return (
              <button
                key={t.key}
                onClick={() => onChange(t.key)}
                className={cn(
                  "relative px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors snap-start min-h-11",
                  isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
                {isActive && <span className="absolute inset-x-2 -bottom-px h-0.5 bg-primary rounded-full" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
