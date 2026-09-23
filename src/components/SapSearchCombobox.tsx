import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import { Loader2, Search, X, CheckCircle2 } from "lucide-react";
import { sapQuery } from "@/lib/sap-client";
import { useSap } from "@/contexts/SapContext";
import { stripCorporateSuffixes, filterAndRank } from "@/lib/supplier-search";

export interface SapSearchOption {
  code: string;
  name: string;
  extra?: string; // e.g. CNPJ, group
  /** Optional extra columns (e.g. fantasyName, taxId) — when present, dropdown renders in columns */
  details?: {
    fantasyName?: string;
    taxId?: string;
  };
}

interface SapSearchComboboxProps {
  /** SAP Service Layer endpoint, e.g. "BusinessPartners" */
  endpoint: string;
  /** OData $filter template — use {q} as placeholder for the search term */
  filterTemplate: string;
  /** OData $select fields */
  selectFields: string;
  /** Map raw SAP row to our option shape */
  mapRow: (row: any) => SapSearchOption;
  /** Currently selected value */
  value: SapSearchOption | null;
  onChange: (val: SapSearchOption | null) => void;
  placeholder?: string;
  label?: string;
  /** Minimum characters before searching (default 2) */
  minChars?: number;
  /** Max results returned by SAP (default 15) */
  topResults?: number;
  /** Pre-fill text from AI without marking as validated. User must pick from SAP results. */
  suggestedQuery?: string;
}


export function SapSearchCombobox({
  endpoint,
  filterTemplate,
  selectFields,
  mapRow,
  value,
  onChange,
  placeholder = "Buscar...",
  label,
  minChars = 2,
  topResults = 15,
  suggestedQuery,
}: SapSearchComboboxProps) {

  const { session } = useSap();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<SapSearchOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const appliedSuggestionRef = useRef<string | null>(null);
  const [dropdownRect, setDropdownRect] = useState<DOMRect | null>(null);

  const updateDropdownPosition = useCallback(() => {
    setDropdownRect(containerRef.current?.getBoundingClientRect() ?? null);
  }, []);

  // Apply suggestedQuery when it changes (AI pre-fill)
  useEffect(() => {
    if (suggestedQuery && suggestedQuery !== appliedSuggestionRef.current && !value) {
      appliedSuggestionRef.current = suggestedQuery;
      setQuery(suggestedQuery);
      // Auto-trigger search so user sees results
      if (suggestedQuery.length >= minChars) {
        search(suggestedQuery);
        setIsOpen(true);
      }
    }
  }, [suggestedQuery, value, minChars]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        !dropdownRef.current?.contains(target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    updateDropdownPosition();
    window.addEventListener("resize", updateDropdownPosition);
    window.addEventListener("scroll", updateDropdownPosition, true);
    return () => {
      window.removeEventListener("resize", updateDropdownPosition);
      window.removeEventListener("scroll", updateDropdownPosition, true);
    };
  }, [isOpen, updateDropdownPosition]);

  const search = useCallback(
    async (term: string) => {
      if (!session || term.length < minChars) {
        setOptions([]);
        return;
      }
      setIsLoading(true);
      try {
        // Remove siglas (INC., S.A., LTDA…) para tolerar diferenças entre o
        // nome no documento e o cadastro no SAP. Ex.: "Figma Inc." → "figma".
        const core = stripCorporateSuffixes(term);
        // Termos a consultar no SAP: original + core (quando difere). Buscamos
        // pelos dois e mesclamos, dedupando por CardCode.
        const termsToQuery = Array.from(
          new Set([term, core].filter((t) => t && t.length >= minChars)),
        );

        const safe = (s: string) => s.replace(/'/g, "''");
        // Alguns servidores do Service Layer não suportam `tolower(...)` no
        // $filter e respondem 400 ("invalid function parameter"). Nesse caso
        // repetimos a busca sem `tolower`, testando maiúsculas e minúsculas.
        const stripToLower = (f: string) => f.replace(/tolower\(\s*([A-Za-z0-9_.]+)\s*\)/g, "$1");
        const buildFilter = (t: string, lower: boolean) =>
          filterTemplate
            .replace(/\{qLower\}/g, lower ? safe(t).toLowerCase() : safe(t).toUpperCase())
            .replace(/\{q\}/g, safe(t));

        const runFilter = async (filter: string) => {
          const { data } = await sapQuery(session, endpoint, {
            $filter: filter,
            $select: selectFields,
            $top: topResults,
          });
          return ((data as any)?.value || []).map(mapRow) as SapSearchOption[];
        };

        const results = await Promise.all(
          termsToQuery.map(async (t) => {
            try {
              return await runFilter(buildFilter(t, true));
            } catch (e) {
              if (!/tolower\(/i.test(filterTemplate)) {
                console.warn("SAP search variant error:", t, e);
                return [] as SapSearchOption[];
              }
              // Fallback sem tolower: tenta MAIÚSCULAS e depois minúsculas.
              for (const lower of [false, true]) {
                try {
                  const rows = await runFilter(stripToLower(buildFilter(t, lower)));
                  if (rows.length > 0) return rows;
                } catch (err) {
                  console.warn("SAP search fallback error:", t, err);
                }
              }
              return [] as SapSearchOption[];
            }
          }),
        );


        // Dedupe por code
        const seen = new Set<string>();
        const merged: SapSearchOption[] = [];
        for (const list of results) {
          for (const opt of list) {
            const k = String(opt.code || opt.name || "").toLowerCase();
            if (k && !seen.has(k)) {
              seen.add(k);
              merged.push(opt);
            }
          }
        }

        // Re-rankeia localmente com tolerância a siglas para o topo ficar melhor.
        const ranked = filterAndRank(merged, term, topResults);
        setOptions(ranked.length > 0 ? ranked : merged);
      } catch (e) {
        console.error("SAP search error:", e);
        setOptions([]);
      } finally {
        setIsLoading(false);
      }
    },
    [session, endpoint, filterTemplate, selectFields, mapRow, minChars, topResults]
  );


  const handleInputChange = (val: string) => {
    setQuery(val);
    if (value) onChange(null); // clear selection when user types
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.length >= minChars) {
      debounceRef.current = setTimeout(() => search(val), 350);
      setIsOpen(true);
    } else {
      setOptions([]);
      setIsOpen(false);
    }
  };

  const handleSelect = (opt: SapSearchOption) => {
    onChange(opt);
    setQuery("");
    setIsOpen(false);
  };

  const handleClear = () => {
    onChange(null);
    setQuery("");
    setOptions([]);
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
            if (value) {
              // Allow re-searching
            } else if (query.length >= minChars) {
              updateDropdownPosition();
              setIsOpen(true);
            }
          }}
          placeholder={placeholder}
          className={`pl-8 pr-8 text-sm h-9 ${value ? "border-green-500/50 bg-green-500/5" : ""}`}
          readOnly={!!value}
        />
        {(value || query) && (
          <button
            type="button"
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

      {isOpen && options.length > 0 && dropdownRect && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[100] max-h-72 overflow-y-auto rounded-md border border-border bg-popover shadow-md"
          style={{
            left: dropdownRect.left,
            top: dropdownRect.bottom + 4,
            width: dropdownRect.width,
          }}
        >
          {(() => {
            // Detecta nomes duplicados nos resultados para alertar o usuário a escolher pelo CNPJ
            const nameCount = new Map<string, number>();
            options.forEach((o) => {
              const k = (o.name || "").trim().toLowerCase();
              nameCount.set(k, (nameCount.get(k) || 0) + 1);
            });
            return options.map((opt) => {
              const hasColumns = !!(opt.details?.fantasyName || opt.details?.taxId);
              const isDup = (nameCount.get((opt.name || "").trim().toLowerCase()) || 0) > 1;
              return (
                <button
                  type="button"
                  key={opt.code}
                  onClick={() => handleSelect(opt)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  {hasColumns ? (
                    <div className="grid grid-cols-[80px_1fr_1fr_120px] gap-2 items-center">
                      <span className="text-xs font-mono text-muted-foreground truncate">{opt.code}</span>
                      <span className="font-medium text-foreground truncate flex items-center gap-1" title={opt.name}>
                        {opt.name}
                        {isDup && (
                          <span
                            className="text-[10px] px-1 py-0.5 rounded bg-warning/20 text-warning border border-warning/30"
                            title="Existem múltiplos cadastros com este nome — confira o CNPJ"
                          >
                            DUP
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground truncate" title={opt.details?.fantasyName || ""}>
                        {opt.details?.fantasyName || "—"}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums truncate text-right" title={opt.details?.taxId || ""}>
                        {opt.details?.taxId || "—"}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground truncate flex items-center gap-1">
                        {opt.name}
                        {isDup && (
                          <span className="text-[10px] px-1 py-0.5 rounded bg-warning/20 text-warning border border-warning/30">
                            DUP
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {opt.code}{opt.extra ? ` · ${opt.extra}` : ""}
                      </span>
                    </div>
                  )}
                </button>
              );
            });
          })()}
        </div>,
        document.body,
      )}

      {isOpen && !isLoading && query.length >= minChars && options.length === 0 && dropdownRect && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[100] rounded-md border border-border bg-popover p-3 text-center text-sm text-muted-foreground shadow-md"
          style={{
            left: dropdownRect.left,
            top: dropdownRect.bottom + 4,
            width: dropdownRect.width,
          }}
        >
          Nenhum resultado encontrado
        </div>,
        document.body,
      )}
    </div>
  );
}
