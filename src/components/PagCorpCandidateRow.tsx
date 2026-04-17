import { useState } from "react";
import {
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Loader2,
  Download,
  Link2,
  Ban,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  SapSearchCombobox,
  type SapSearchOption,
} from "@/components/SapSearchCombobox";
import { Checkbox } from "@/components/ui/checkbox";
import { useSap } from "@/contexts/SapContext";
import {
  importPagCorpCandidate,
  savePagCorpSupplierLink,
  type PagCorpCandidate,
} from "@/hooks/useImportPagCorpSuppliers";

function formatCurrency(value: number, currency: string = "BRL") {
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: /^[A-Z]{3}$/.test(currency) ? currency : "BRL",
    }).format(value);
  } catch {
    return value.toFixed(2);
  }
}

function formatDate(d: string) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("pt-BR");
  } catch {
    return d;
  }
}

interface Props {
  candidate: PagCorpCandidate;
  /** Reflect a row update locally (mark as resolved) */
  onResolved: (key: string, patch: Partial<PagCorpCandidate>) => void;
  /** Refresh supplier list after an import */
  onRefreshSuppliers: () => void | Promise<void>;
  /** Bulk-selection state (only meaningful for unresolved, non-failed rows) */
  selected?: boolean;
  onToggleSelected?: (key: string, checked: boolean) => void;
  selectable?: boolean;
}

type Mode = "idle" | "linking" | "importing" | "ignoring";

export function PagCorpCandidateRow({
  candidate: c,
  onResolved,
  onRefreshSuppliers,
  selected,
  onToggleSelected,
  selectable,
}: Props) {
  const { session } = useSap();
  const [mode, setMode] = useState<Mode>("idle");
  const [busy, setBusy] = useState(false);
  const [linkChoice, setLinkChoice] = useState<SapSearchOption | null>(null);

  const resolved =
    c.existing ||
    c.savedResolution === "imported" ||
    c.savedResolution === "linked" ||
    c.savedResolution === "ignored";

  const handleImport = async () => {
    setBusy(true);
    try {
      const created = await importPagCorpCandidate(c, session);
      toast.success("Fornecedor importado", { description: c.card_name });
      onResolved(c.key, {
        savedResolution: "imported",
        existing: true,
        existingMatch: {
          by: "saved_link",
          card_code: created.card_code,
          card_name: created.card_name,
        },
      });
      void onRefreshSuppliers();
    } catch (e) {
      toast.error("Falha ao importar", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
      setMode("idle");
    }
  };

  const handleLink = async () => {
    if (!linkChoice) return;
    setBusy(true);
    try {
      await savePagCorpSupplierLink({
        companyDb: session?.companyDB || null,
        federalTaxId: c.federal_tax_id,
        cardName: c.card_name,
        cardCode: linkChoice.code,
        resolution: "linked",
        resolvedBy: session?.userName || null,
      });
      toast.success("Vinculado", { description: `${c.card_name} → ${linkChoice.name}` });
      onResolved(c.key, {
        savedResolution: "linked",
        existing: true,
        existingMatch: {
          by: "saved_link",
          card_code: linkChoice.code,
          card_name: linkChoice.name,
        },
      });
    } catch (e) {
      toast.error("Falha ao vincular", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
      setMode("idle");
      setLinkChoice(null);
    }
  };

  const handleIgnore = async () => {
    setBusy(true);
    try {
      await savePagCorpSupplierLink({
        companyDb: session?.companyDB || null,
        federalTaxId: c.federal_tax_id,
        cardName: c.card_name,
        resolution: "ignored",
        resolvedBy: session?.userName || null,
      });
      toast.success("Marcado para ignorar", { description: c.card_name });
      onResolved(c.key, { savedResolution: "ignored" });
    } catch (e) {
      toast.error("Falha ao ignorar", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <TableRow className={resolved ? "opacity-70" : ""}>
      <TableCell className="font-medium align-top">{c.card_name}</TableCell>
      <TableCell className="font-mono text-xs align-top">
        {c.federal_tax_id || "—"}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground align-top">
        <div className="line-clamp-1">{c.transactionDescription}</div>
        <div className="text-[10px]">{formatDate(c.transactionDate)}</div>
      </TableCell>
      <TableCell className="text-right text-xs align-top">
        {formatCurrency(c.transactionAmount)}
      </TableCell>
      <TableCell className="align-top">
        <StatusBadge candidate={c} />
      </TableCell>
      <TableCell className="align-top min-w-[320px]">
        {c.aiFailed ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : resolved ? (
          <span className="text-xs text-muted-foreground italic">
            {c.savedResolution === "ignored"
              ? "Ignorado nas próximas importações"
              : c.existingMatch?.card_code
                ? `Vinculado a ${c.existingMatch.card_code}`
                : "Resolvido"}
          </span>
        ) : mode === "linking" ? (
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <SapSearchCombobox
                endpoint="BusinessPartners"
                filterTemplate="CardType eq 'cSupplier' and (contains(CardName,'{q}') or contains(CardCode,'{q}'))"
                selectFields="CardCode,CardName,FederalTaxID"
                mapRow={(row: any) => ({
                  code: row.CardCode,
                  name: row.CardName,
                  extra: row.FederalTaxID || undefined,
                })}
                value={linkChoice}
                onChange={setLinkChoice}
                placeholder="Buscar fornecedor SAP…"
                suggestedQuery={c.card_name}
              />
            </div>
            <Button size="sm" onClick={handleLink} disabled={!linkChoice || busy}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Vincular"}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                setMode("idle");
                setLinkChoice(null);
              }}
              disabled={busy}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" onClick={handleImport} disabled={busy} className="gap-1.5">
              {busy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              Importar
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setMode("linking")}
              disabled={busy}
              className="gap-1.5"
            >
              <Link2 className="w-3.5 h-3.5" />
              Vincular existente
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleIgnore}
              disabled={busy}
              className="gap-1.5 text-muted-foreground"
            >
              <Ban className="w-3.5 h-3.5" />
              Não fazer nada
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

function StatusBadge({ candidate: c }: { candidate: PagCorpCandidate }) {
  if (c.aiFailed) {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertCircle className="w-3 h-3" />
        {c.aiError || "Sem extração"}
      </Badge>
    );
  }
  if (c.savedResolution === "ignored") {
    return (
      <Badge variant="outline" className="gap-1">
        <Ban className="w-3 h-3" />
        Ignorado
      </Badge>
    );
  }
  if (c.savedResolution === "imported") {
    return (
      <Badge className="gap-1 bg-success/20 text-success hover:bg-success/30 border-success/30">
        <Download className="w-3 h-3" />
        Importado
      </Badge>
    );
  }
  if (c.savedResolution === "linked") {
    return (
      <Badge className="gap-1 bg-primary/20 text-primary hover:bg-primary/30 border-primary/30">
        <Link2 className="w-3 h-3" />
        Vinculado
      </Badge>
    );
  }
  if (c.existing) {
    return (
      <Badge variant="secondary" className="gap-1">
        <CheckCircle2 className="w-3 h-3" />
        Já cadastrado
        {c.existingMatch?.card_code ? ` (${c.existingMatch.card_code})` : ""}
      </Badge>
    );
  }
  return (
    <Badge className="gap-1 bg-success/20 text-success hover:bg-success/30 border-success/30">
      <Sparkles className="w-3 h-3" />
      Novo
    </Badge>
  );
}
