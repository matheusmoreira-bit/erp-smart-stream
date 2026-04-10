import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Loader2, Search, X, CheckCircle2 } from "lucide-react";
import type { SapSearchOption } from "@/components/SapSearchCombobox";

interface CachedSearchComboboxProps {
  options: SapSearchOption[];
  isLoading: boolean;
  value: SapSearchOption | null;
  onChange: (val: SapSearchOption | null) => void;
  placeholder?: string;
  label?: string;
  suggestedQuery?: string;
}

export function CachedSearchCombobox({
  options,
  isLoading,
  value,
  onChange,
  placeholder = "Buscar...",
  label,
  suggestedQuery,
}: CachedSearchComboboxProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const appliedSuggestionRef = useRef<string | null>(null);

  // Apply suggestedQuery
  useEffect(() => {
    if (suggestedQuery && suggestedQuery !== appliedSuggestionRef.current && !value) {
      appliedSuggestionRef.current = suggestedQuery;
      setQuery(suggestedQuery);
      setIsOpen(true);
    }
  }, [suggestedQuery, value]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = query.length > 0
    ? options.filter((o) => {
        const q = query.toLowerCase();
        return (o.code ?? "").toLowerCase().includes(q) || (o.name ?? "").toLowerCase().includes(q) || ((o.extra ?? "").toLowerCase().includes(q));
      }).slice(0, 50)
    : options.slice(0, 50);

  const handleInputChange = (val: string) => {
    setQuery(val);
    if (value) onChange(null);
    setIsOpen(true);
  };

  const handleSelect = (opt: SapSearchOption) => {
    onChange(opt);
    setQuery("");
    setIsOpen(false);
  };

  const handleClear = () => {
    onChange(null);
    setQuery("");
  };

  const displayValue = value
    ? `${value.name} — ${value.code}${value.extra ? ` (${value.extra})` : ""}`
    : "";

  return (
    <div ref={containerRef} className="relative">
      {label && <label className="text-xs text-muted-foreground mb-1 block">{label}</label>}
      <div className="relative">
        {value ? (
          <CheckCircle2 className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-green-500" />
        ) : (
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        )}
        <Input
          value={value ? displayValue : query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => {
            if (!value) setIsOpen(true);
          }}
          placeholder={isLoading ? "Carregando..." : placeholder}
          className={`pl-8 pr-8 text-sm h-9 ${value ? "border-green-500/50 bg-green-500/5" : ""}`}
          readOnly={!!value}
          disabled={isLoading}
        />
        {(value || query) && (
          <button
            onClick={handleClear}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        {isLoading && (
          <Loader2 className="w-3.5 h-3.5 absolute right-8 top-1/2 -translate-y-1/2 text-primary animate-spin" />
        )}
      </div>

              {isOpen && filtered.length > 0 && (
        <div className="absolute z-[9999] mt-1 w-full max-h-56 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
          {filtered.map((opt) => (
            <button
              key={opt.code}
              onClick={() => handleSelect(opt)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors flex flex-col"
            >
              <span className="font-medium text-foreground truncate">{opt.name}</span>
              <span className="text-xs text-muted-foreground">
                {opt.code}{opt.extra ? ` · ${opt.extra}` : ""}
              </span>
            </button>
          ))}
        </div>
      )}

      {isOpen && !isLoading && filtered.length === 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-md p-3 text-center text-sm text-muted-foreground">
          Nenhum resultado encontrado
        </div>
      )}
    </div>
  );
}
