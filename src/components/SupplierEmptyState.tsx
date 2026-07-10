import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { UserPlus, RefreshCw, Building2, Loader2 } from "lucide-react";
import type { CrossCompanyMatch } from "@/hooks/useMergedSupplierOptions";
import { onlyDigits } from "@/lib/supplier-search";

interface Props {
  query: string;
  bpLabel: string;
  currentCompanyLabel: string;
  onCreateNew: () => void;
  onRefresh: () => void;
  crossCompanyLookup: (query: string) => Promise<CrossCompanyMatch[]>;
}

/**
 * Empty state acionável do combobox de Fornecedor:
 *   • "Cadastrar novo fornecedor" — abre SupplierFormModal pré-preenchido.
 *   • "Encontrei em outra empresa" — lista ocorrências em outras company_db.
 *   • "Atualizar lista" — força refetch do cache SAP.
 */
export function SupplierEmptyState({
  query,
  bpLabel,
  currentCompanyLabel,
  onCreateNew,
  onRefresh,
  crossCompanyLookup,
}: Props) {
  const [matches, setMatches] = useState<CrossCompanyMatch[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const q = query.trim();
    if (q.length < 3) {
      setMatches([]);
      return;
    }
    setLoading(true);
    crossCompanyLookup(q)
      .then((res) => {
        if (!cancelled) setMatches(res);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, crossCompanyLookup]);

  const digits = onlyDigits(query);
  const looksLikeCnpj = digits.length === 14;
  const looksLikeCpf = digits.length === 11;
  const displayQuery = looksLikeCnpj
    ? digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5")
    : looksLikeCpf
      ? digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")
      : query.trim();

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="px-2 py-1.5 text-xs text-muted-foreground">
        Nenhum {bpLabel.toLowerCase()} encontrado{currentCompanyLabel ? ` em ${currentCompanyLabel}` : ""}.
      </div>

      <button
        type="button"
        onPointerDownCapture={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onCreateNew();
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-left transition-colors hover:bg-primary/10"
      >
        <UserPlus className="mt-0.5 h-4 w-4 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground">
            Cadastrar novo {bpLabel.toLowerCase()}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {displayQuery ? `"${displayQuery}"` : "Preencher dados manualmente"}
          </div>
        </div>
      </button>

      {(loading || matches.length > 0) && (
        <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Building2 className="h-3 w-3" />
            {loading ? "Buscando em outras empresas…" : "Encontrado em outras empresas"}
          </div>
          {loading ? (
            <div className="flex items-center gap-1.5 py-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> aguarde…
            </div>
          ) : (
            <ul className="space-y-1">
              {matches.slice(0, 5).map((m) => (
                <li key={`${m.companyDb}-${m.cardCode || m.cardName}`} className="text-xs">
                  <span className="font-medium text-foreground">{m.companyLabel}</span>
                  <span className="text-muted-foreground">
                    {" — "}
                    {m.cardName}
                    {m.cardCode ? ` (${m.cardCode})` : ""}
                    {m.federalTaxId ? ` · ${m.federalTaxId}` : ""}
                  </span>
                </li>
              ))}
              {matches.length > 5 && (
                <li className="text-[11px] text-muted-foreground">
                  +{matches.length - 5} outra(s) empresa(s)
                </li>
              )}
              <li className="mt-1 text-[11px] text-muted-foreground">
                Cada empresa mantém seu próprio cadastro — se precisa aqui, cadastre nesta empresa.
              </li>
            </ul>
          )}
        </div>
      )}

      <button
        type="button"
        onPointerDownCapture={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onRefresh();
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        className="flex items-center justify-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      >
        <RefreshCw className="h-3 w-3" />
        Atualizar lista do ERP
      </button>
    </div>
  );
}
