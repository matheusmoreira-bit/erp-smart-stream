import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Plus, Split, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { DecimalInput } from "@/components/DecimalInput";
import { CachedSearchCombobox } from "@/components/CachedSearchCombobox";
import type { SapSearchOption } from "@/components/SapSearchCombobox";
import {
  distributeEvenly,
  emptySplit,
  isSplitComplete,
  percentOf,
  resolveSplitAmounts,
  roundMoney,
  splitRemaining,
  sumSplit,
  type ProjectSplit,
} from "@/lib/project-split";

interface ProjectSplitDialogProps {
  open: boolean;
  onClose: () => void;
  /** Valor total da linha que será rateado. */
  total: number;
  currency?: string;
  projectOptions: SapSearchOption[];
  projectsLoading?: boolean;
  value: ProjectSplit | null;
  onConfirm: (split: ProjectSplit | null) => void;
  lineLabel?: string;
}

function fmt(value: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(
    Number(value) || 0,
  );
}

export function ProjectSplitDialog({
  open,
  onClose,
  total,
  currency = "BRL",
  projectOptions,
  projectsLoading,
  value,
  onConfirm,
  lineLabel,
}: ProjectSplitDialogProps) {
  const [draft, setDraft] = useState<ProjectSplit>(value ?? emptySplit());
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) setDraft(value ?? emptySplit());
  }, [open, value]);

  const resolved = useMemo(() => resolveSplitAmounts(draft, total), [draft, total]);
  const allocated = sumSplit(draft, total);
  const remaining = splitRemaining(draft, total);
  const complete = isSplitComplete(draft, total);

  const addProject = (opt: SapSearchOption | null) => {
    if (!opt?.code) return;
    setDraft((prev) => {
      if (prev.entries.some((e) => e.code === opt.code)) return prev;
      const entries = [...prev.entries, { code: opt.code, name: opt.name || opt.code, amount: 0 }];
      if (prev.mode === "auto") {
        const parts = distributeEvenly(total, entries.length);
        return { ...prev, entries: entries.map((e, i) => ({ ...e, amount: parts[i] })) };
      }
      return { ...prev, entries };
    });
  };

  const removeProject = (code: string) => {
    setDraft((prev) => {
      const entries = prev.entries.filter((e) => e.code !== code);
      if (prev.mode === "auto") {
        const parts = distributeEvenly(total, entries.length);
        return { ...prev, entries: entries.map((e, i) => ({ ...e, amount: parts[i] })) };
      }
      return { ...prev, entries };
    });
  };

  const setMode = (mode: ProjectSplit["mode"]) => {
    setDraft((prev) => {
      if (mode === "auto") {
        const parts = distributeEvenly(total, prev.entries.length);
        return { ...prev, mode, entries: prev.entries.map((e, i) => ({ ...e, amount: parts[i] })) };
      }
      // Ao ir para manual, mantém a distribuição atual como ponto de partida.
      const current = resolveSplitAmounts(prev, total);
      return { ...prev, mode, entries: current };
    });
  };

  const updateAmount = (code: string, amount: number) => {
    setDraft((prev) => ({
      ...prev,
      entries: prev.entries.map((e) => (e.code === code ? { ...e, amount: roundMoney(amount) } : e)),
    }));
  };

  const updatePercent = (code: string, pct: number) => {
    updateAmount(code, (Number(pct) || 0) / 100 * (Number(total) || 0));
  };

  const availableOptions = useMemo(
    () => projectOptions.filter((o) => !draft.entries.some((e) => e.code === o.code)),
    [projectOptions, draft.entries],
  );

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent ref={setContainer as never} className="max-w-[min(720px,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Split className="h-4 w-4 text-primary" aria-hidden="true" />
            Rateio por projeto
          </DialogTitle>
          <DialogDescription>
            {lineLabel ? `${lineLabel} — ` : ""}Valor da linha: <strong>{fmt(total, currency)}</strong>. É obrigatório ratear 100% do valor.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 rounded-md bg-muted p-1 text-sm">
            <button
              type="button"
              onClick={() => setMode("auto")}
              className={`rounded-md px-3 py-2 font-medium transition ${draft.mode === "auto" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
            >
              Automático (divide igualmente)
            </button>
            <button
              type="button"
              onClick={() => setMode("manual")}
              className={`rounded-md px-3 py-2 font-medium transition ${draft.mode === "manual" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
            >
              Manual (valor ou %)
            </button>
          </div>

          <div className="space-y-1.5">
            <Label>Adicionar projeto</Label>
            <CachedSearchCombobox
              options={availableOptions}
              isLoading={projectsLoading}
              value={null}
              onChange={addProject}
              placeholder="Buscar projeto..."
              portalContainer={container}
            />
          </div>

          {draft.mode === "manual" && draft.entries.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Informar por:</span>
              <Button
                type="button"
                size="sm"
                variant={draft.inputMode === "value" ? "default" : "outline"}
                onClick={() => setDraft((p) => ({ ...p, inputMode: "value" }))}
              >
                Valor
              </Button>
              <Button
                type="button"
                size="sm"
                variant={draft.inputMode === "percent" ? "default" : "outline"}
                onClick={() => setDraft((p) => ({ ...p, inputMode: "percent" }))}
              >
                Percentual
              </Button>
            </div>
          )}

          <div className="space-y-2">
            {resolved.length === 0 && (
              <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                Nenhum projeto selecionado para o rateio desta linha.
              </p>
            )}
            {resolved.map((entry) => (
              <div key={entry.code} className="flex items-center gap-2 rounded-md border border-border/70 p-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{entry.code}</div>
                  <div className="truncate text-xs text-muted-foreground">{entry.name}</div>
                </div>
                {draft.mode === "manual" ? (
                  <div className="w-36">
                    {draft.inputMode === "value" ? (
                      <DecimalInput
                        value={entry.amount}
                        onChange={(v) => updateAmount(entry.code, v)}
                        className="h-8 text-sm"
                      />
                    ) : (
                      <DecimalInput
                        value={roundMoney(percentOf(entry.amount, total))}
                        onChange={(v) => updatePercent(entry.code, v)}
                        className="h-8 text-sm"
                      />
                    )}
                  </div>
                ) : (
                  <div className="w-36 text-right text-sm font-mono">{fmt(entry.amount, currency)}</div>
                )}
                <div className="w-16 text-right text-xs text-muted-foreground">
                  {percentOf(entry.amount, total).toFixed(2)}%
                </div>
                <Button type="button" variant="ghost" size="icon" onClick={() => removeProject(entry.code)} aria-label={`Remover ${entry.code}`}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>

          <div className={`flex items-center gap-2 rounded-md border p-3 text-sm ${complete ? "border-green-500/40 bg-green-500/10" : "border-amber-500/40 bg-amber-500/10"}`}>
            {complete ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
            <span>
              Rateado: <strong>{fmt(allocated, currency)}</strong> de {fmt(total, currency)}
              {!complete && <> — faltam <strong>{fmt(remaining, currency)}</strong></>}
            </span>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => { onConfirm(null); onClose(); }}
          >
            Remover rateio
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button
              type="button"
              disabled={!complete}
              onClick={() => {
                onConfirm({ ...draft, entries: resolveSplitAmounts(draft, total) });
                onClose();
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Aplicar rateio
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
