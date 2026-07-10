import { useState, useRef, useEffect, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import { Loader2, Search, X, CheckCircle2, AlertTriangle } from "lucide-react";
import type { SapSearchOption } from "@/components/SapSearchCombobox";
import { filterAndRank } from "@/lib/supplier-search";

interface CachedSearchComboboxProps {
  options: SapSearchOption[];
  isLoading: boolean;
  value: SapSearchOption | null;
  onChange: (val: SapSearchOption | null) => void;
  onRawValueChange?: (val: string) => void;
  placeholder?: string;
  label?: string;
  suggestedQuery?: string;
  portalContainer?: HTMLElement | null;
  /** Quando true e o campo estiver vazio, exibe destaque âmbar (obrigatório). */
  required?: boolean;
  /** Renderiza um badge/hint por opção (ex.: "Inativo", "Não sincronizado"). */
  renderOptionBadge?: (opt: SapSearchOption) => ReactNode;
  /** Conteúdo customizado do empty state — recebe o termo pesquisado. Se retornar null, cai para o texto padrão. */
  renderEmptyState?: (query: string) => ReactNode;
  /** Rodapé fixo abaixo da lista (contexto: "Buscando em Empresa X · N ativos"). */
  footerHint?: ReactNode;
  /** Bloqueia a seleção de uma opção (ex.: fornecedor inativo). */
  isOptionDisabled?: (opt: SapSearchOption) => boolean;
  /** Texto exibido abaixo do nome quando a opção está desabilitada. */
  getDisabledReason?: (opt: SapSearchOption) => string | null | undefined;
}

export function CachedSearchCombobox({
  options,
  isLoading,
  value,
  onChange,
  onRawValueChange,
  placeholder = "Buscar...",
  label,
  suggestedQuery,
  portalContainer,
  required = false,
  renderOptionBadge,
  renderEmptyState,
  footerHint,
  isOptionDisabled,
  getDisabledReason,
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
    const handler = (e: globalThis.MouseEvent) => {
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

  const filtered = filterAndRank(options, query, 50);

  const handleInputChange = (val: string) => {
    setQuery(val);
    if (value) onChange(null);
    onRawValueChange?.(val);
    setIsOpen(true);
  };

  const handleSelect = (opt: SapSearchOption) => {
    if (isOptionDisabled?.(opt)) return;
    onChange(opt);
    setQuery("");
    setIsOpen(false);
  };

  const handleOptionPointerDown = (e: ReactPointerEvent<HTMLButtonElement>, opt: SapSearchOption) => {
    e.preventDefault();
    e.stopPropagation();
    handleSelect(opt);
  };

  const handleOptionMouseDown = (e: ReactMouseEvent<HTMLButtonElement>, opt: SapSearchOption) => {
    e.preventDefault();
    e.stopPropagation();
    handleSelect(opt);
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
      <div ref={containerRef} className="relative min-w-0 max-w-full">
        {label && <label className="mb-1 block text-xs text-muted-foreground">{label}</label>}

        <div ref={inputWrapperRef} className="relative min-w-0 max-w-full">
          {value ? (
            <CheckCircle2 className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-green-500" />
          ) : required ? (
            <AlertTriangle
              className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-amber-600 dark:text-amber-400"
              aria-label="Campo obrigatório"
            />
          ) : (
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          )}

          <Input
            value={value ? displayValue : query}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && isOpen && filtered.length > 0) {
                e.preventDefault();
                handleSelect(filtered[0]);
              }
              if (e.key === "Escape") setIsOpen(false);
            }}
            onFocus={() => {
              if (!value) setIsOpen(true);
            }}
            placeholder={isLoading ? "Carregando..." : placeholder}
            className={`h-9 min-w-0 truncate pl-8 pr-8 text-sm ${
              value
                ? "border-green-500/50 bg-green-500/5"
                : required
                  ? "border-amber-500/50 bg-amber-500/5"
                  : ""
            }`}
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
          style={{ ...dropdownStyle, pointerEvents: "auto" }}
          className="z-[9999] max-w-[calc(100dvw-1rem)] rounded-md border border-border bg-popover shadow-md"
        >
          <div className="max-h-56 overflow-y-auto overflow-x-hidden">
            {filtered.map((opt) => {
              const hasColumns = !!(opt.details?.fantasyName || opt.details?.taxId);
              const badge = renderOptionBadge?.(opt);
              return (
                <button
                  key={opt.code}
                  type="button"
                  onPointerDownCapture={(e) => handleOptionPointerDown(e, opt)}
                  onMouseDown={(e) => handleOptionMouseDown(e, opt)}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSelect(opt);
                  }}
                  className="w-full min-w-0 text-left px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  {hasColumns ? (
                    <div className="grid min-w-0 grid-cols-[64px_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[80px_minmax(0,1fr)_minmax(0,1fr)_120px]">
                      <span className="text-xs font-mono text-muted-foreground truncate">{opt.code}</span>
                      <span className="font-medium text-foreground truncate flex items-center gap-1.5" title={opt.name}>
                        <span className="truncate">{opt.name}</span>
                        {badge}
                      </span>
                      <span className="hidden text-xs text-muted-foreground truncate sm:block" title={opt.details?.fantasyName || ""}>
                        {opt.details?.fantasyName || "—"}
                      </span>
                      <span className="hidden text-xs text-muted-foreground tabular-nums truncate text-right sm:block" title={opt.details?.taxId || ""}>
                        {opt.details?.taxId || "—"}
                      </span>
                    </div>
                  ) : (
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium text-foreground flex items-center gap-1.5">
                        <span className="truncate">{opt.name}</span>
                        {badge}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {opt.code}{opt.extra ? ` · ${opt.extra}` : ""}
                      </span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          {footerHint && (
            <div className="border-t border-border/60 bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
              {footerHint}
            </div>
          )}
        </div>,
        portalContainer || document.body,
      )}

      {typeof document !== "undefined" && showEmptyState && createPortal(
        <div
          ref={dropdownRef}
          style={{ ...dropdownStyle, pointerEvents: "auto" }}
          className="z-[9999] max-w-[calc(100dvw-1rem)] rounded-md border border-border bg-popover shadow-md"
        >
          {renderEmptyState ? (
            <div className="p-2">{renderEmptyState(query)}</div>
          ) : (
            <div className="p-3 text-center text-sm text-muted-foreground">
              Nenhum resultado encontrado
            </div>
          )}
          {footerHint && (
            <div className="border-t border-border/60 bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
              {footerHint}
            </div>
          )}
        </div>,
        portalContainer || document.body,
      )}
    </>
  );
}

