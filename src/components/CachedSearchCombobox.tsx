import { useState, useRef, useEffect, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import { Loader2, Search, X, CheckCircle2, AlertTriangle } from "lucide-react";
import type { SapSearchOption } from "@/components/SapSearchCombobox";

interface CachedSearchComboboxProps {
  options: SapSearchOption[];
  isLoading: boolean;
  value: SapSearchOption | null;
  onChange: (val: SapSearchOption | null) => void;
  placeholder?: string;
  label?: string;
  suggestedQuery?: string;
  portalContainer?: HTMLElement | null;
  /** Quando true e o campo estiver vazio, exibe destaque âmbar (obrigatório). */
  required?: boolean;
}

export function CachedSearchCombobox({
  options,
  isLoading,
  value,
  onChange,
  placeholder = "Buscar...",
  label,
  suggestedQuery,
  portalContainer,
  required = false,
}: CachedSearchComboboxProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputWrapperRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const appliedSuggestionRef = useRef<string | null>(null);

  useEffect(() => {
    if (suggestedQuery && suggestedQuery !== appliedSuggestionRef.current && !value) {
      appliedSuggestionRef.current = suggestedQuery;
      setQuery(suggestedQuery);
      setIsOpen(true);
    }
  }, [suggestedQuery, value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;

      if (containerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;

      setIsOpen(false);
    };

    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const updateDropdownPosition = () => {
      const rect = inputWrapperRef.current?.getBoundingClientRect();
      if (!rect) return;

      if (portalContainer) {
        const containerRect = portalContainer.getBoundingClientRect();

        setDropdownPosition({
          top: rect.bottom - containerRect.top + portalContainer.scrollTop + 4,
          left: rect.left - containerRect.left + portalContainer.scrollLeft,
          width: rect.width,
        });
        return;
      }

      setDropdownPosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    };

    updateDropdownPosition();

    window.addEventListener("resize", updateDropdownPosition);
    window.addEventListener("scroll", updateDropdownPosition, true);

    return () => {
      window.removeEventListener("resize", updateDropdownPosition);
      window.removeEventListener("scroll", updateDropdownPosition, true);
    };
  }, [isOpen, query, value, options.length, portalContainer]);

  const filtered = query.length > 0
    ? options.filter((o) => {
        const q = query.toLowerCase();
        const qDigits = query.replace(/\D/g, "");
        const extraDigits = (o.extra ?? "").replace(/\D/g, "");
        const taxDigits = (o.details?.taxId ?? "").replace(/\D/g, "");
        const fantasy = (o.details?.fantasyName ?? "").toLowerCase();
        return (o.code ?? "").toLowerCase().includes(q)
          || (o.name ?? "").toLowerCase().includes(q)
          || (o.extra ?? "").toLowerCase().includes(q)
          || fantasy.includes(q)
          || (qDigits.length >= 3 && (extraDigits.includes(qDigits) || taxDigits.includes(qDigits)));
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
    setIsOpen(false);
  };

  const displayValue = value
    ? `${value.name} — ${value.code}${value.extra ? ` (${value.extra})` : ""}`
    : "";

  const showResults = isOpen && filtered.length > 0 && dropdownPosition;
  const showEmptyState = isOpen && !isLoading && filtered.length === 0 && dropdownPosition;
  const dropdownStyle: CSSProperties | undefined = dropdownPosition
    ? {
        position: portalContainer ? "absolute" : "fixed",
        top: dropdownPosition.top,
        left: dropdownPosition.left,
        width: dropdownPosition.width,
      }
    : undefined;

  return (
    <>
      <div ref={containerRef} className="relative">
        {label && <label className="mb-1 block text-xs text-muted-foreground">{label}</label>}

        <div ref={inputWrapperRef} className="relative">
          {value ? (
            <CheckCircle2 className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-green-500" />
          ) : (
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          )}

          <Input
            value={value ? displayValue : query}
            onChange={(e) => handleInputChange(e.target.value)}
            onFocus={() => {
              if (!value) setIsOpen(true);
            }}
            placeholder={isLoading ? "Carregando..." : placeholder}
            className={`h-9 pl-8 pr-8 text-sm ${value ? "border-green-500/50 bg-green-500/5" : ""}`}
            readOnly={!!value}
            disabled={isLoading}
          />

          {(value || query) && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}

          {isLoading && (
            <Loader2 className="absolute right-8 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-primary" />
          )}
        </div>
      </div>

      {typeof document !== "undefined" && showResults && createPortal(
        <div
          ref={dropdownRef}
          style={dropdownStyle}
          className="z-[9999] max-h-56 overflow-y-auto rounded-md border border-border bg-popover shadow-md"
        >
          {filtered.map((opt) => {
            const hasColumns = !!(opt.details?.fantasyName || opt.details?.taxId);
            return (
              <button
                key={opt.code}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); handleSelect(opt); }}
                className="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {hasColumns ? (
                  <div className="grid grid-cols-[80px_1fr_1fr_120px] gap-2 items-center">
                    <span className="text-xs font-mono text-muted-foreground truncate">{opt.code}</span>
                    <span className="font-medium text-foreground truncate" title={opt.name}>{opt.name}</span>
                    <span className="text-xs text-muted-foreground truncate" title={opt.details?.fantasyName || ""}>
                      {opt.details?.fantasyName || "—"}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums truncate text-right" title={opt.details?.taxId || ""}>
                      {opt.details?.taxId || "—"}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col">
                    <span className="truncate font-medium text-foreground">{opt.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {opt.code}{opt.extra ? ` · ${opt.extra}` : ""}
                    </span>
                  </div>
                )}
              </button>
            );
          })}
        </div>,
        portalContainer || document.body,
      )}

      {typeof document !== "undefined" && showEmptyState && createPortal(
        <div
          ref={dropdownRef}
          style={dropdownStyle}
          className="z-[9999] rounded-md border border-border bg-popover p-3 text-center text-sm text-muted-foreground shadow-md"
        >
          Nenhum resultado encontrado
        </div>,
        portalContainer || document.body,
      )}
    </>
  );
}
