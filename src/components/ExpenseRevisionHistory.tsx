import { useEffect, useState } from "react";
import { History, Loader2, PencilLine, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { displayUserName } from "@/lib/user-display";

export interface RevisionChange {
  field: string;
  label: string;
  before: unknown;
  after: unknown;
}

export interface ExpenseRevision {
  id: string;
  revision_number: number;
  changed_by_name: string | null;
  changed_by_email: string | null;
  status_before: string | null;
  status_after: string | null;
  resubmitted: boolean;
  changes: RevisionChange[];
  created_at: string;
}

const CURRENCY_FIELDS = new Set(["total_amount"]);
const DATE_FIELDS = new Set(["doc_date", "due_date"]);

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (CURRENCY_FIELDS.has(field)) {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    }
  }
  if (DATE_FIELDS.has(field)) {
    const d = new Date(String(value));
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString("pt-BR");
  }
  return String(value);
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function useExpenseRevisions(expenseId?: string | null, refreshKey?: unknown) {
  const [revisions, setRevisions] = useState<ExpenseRevision[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!expenseId) {
      setRevisions([]);
      return;
    }
    setLoading(true);
    void (async () => {
      const { data, error } = await supabase
        .from("expense_revisions")
        .select(
          "id, revision_number, changed_by_name, changed_by_email, status_before, status_after, resubmitted, changes, created_at",
        )
        .eq("expense_id", expenseId)
        .order("revision_number", { ascending: false })
        .limit(50);
      if (cancelled) return;
      if (error) {
        setRevisions([]);
      } else {
        setRevisions(
          (data || []).map((r) => ({
            ...(r as unknown as ExpenseRevision),
            changes: Array.isArray((r as { changes?: unknown }).changes)
              ? ((r as { changes: RevisionChange[] }).changes)
              : [],
          })),
        );
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [expenseId, refreshKey]);

  return { revisions, loading };
}

function ChangeRow({ change }: { change: RevisionChange }) {
  return (
    <li className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">{change.label}:</span>
      <span className="line-through text-muted-foreground/80 break-all">
        {formatValue(change.field, change.before)}
      </span>
      <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" aria-hidden />
      <span className="font-medium text-foreground break-all">
        {formatValue(change.field, change.after)}
      </span>
    </li>
  );
}

/** Aviso compacto ao aprovador: este documento é uma ATUALIZAÇÃO, não um novo pedido. */
export function ExpenseUpdateNotice({
  expenseId,
  revisionNumber,
}: {
  expenseId?: string | null;
  revisionNumber?: number | null;
}) {
  const { revisions, loading } = useExpenseRevisions(expenseId);
  const isRevision = Number(revisionNumber || 1) > 1 || revisions.length > 0;
  if (!expenseId || !isRevision) return null;
  const latest = revisions[0];

  return (
    <section
      aria-label="Aviso de atualização do pedido"
      className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 space-y-2"
    >
      <div className="flex items-center gap-2">
        <PencilLine className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" aria-hidden />
        <h4 className="text-sm font-semibold text-foreground">
          Atualização de pedido existente · versão {Number(revisionNumber || latest?.revision_number || 2)}
        </h4>
      </div>
      <p className="text-xs text-muted-foreground">
        Este documento já havia sido enviado antes. Ele voltou para aprovação porque foi alterado —
        não é um novo pedido.
      </p>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> Carregando alterações…
        </div>
      ) : latest && latest.changes.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            O que mudou nesta versão
          </p>
          <ul className="space-y-1">
            {latest.changes.map((c, i) => (
              <ChangeRow key={`${c.field}-${i}`} change={c} />
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground pt-1">
            Alterado por {displayUserName(latest.changed_by_name || latest.changed_by_email || "—")} em{" "}
            {formatDateTime(latest.created_at)}.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Detalhe das alterações não disponível para esta versão.
        </p>
      )}
    </section>
  );
}

/** Histórico completo de versões do pedido. */
export function ExpenseRevisionHistory({
  expenseId,
  refreshKey,
}: {
  expenseId?: string | null;
  refreshKey?: unknown;
}) {
  const { revisions, loading } = useExpenseRevisions(expenseId, refreshKey);

  if (!expenseId) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <History className="w-4 h-4 text-muted-foreground" aria-hidden />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Histórico de versões
        </p>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> Carregando…
        </div>
      ) : revisions.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhuma alteração registrada — o pedido está na versão original.
        </p>
      ) : (
        <ol className="space-y-2">
          {revisions.map((rev) => (
            <li key={rev.id} className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">
                  Versão {rev.revision_number}
                </span>
                <span className="text-[11px] text-muted-foreground">{formatDateTime(rev.created_at)}</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Por {displayUserName(rev.changed_by_name || rev.changed_by_email || "—")}
                {rev.resubmitted ? " · reenviado para aprovação" : ""}
              </p>
              {rev.changes.length > 0 ? (
                <ul className="space-y-1">
                  {rev.changes.map((c, i) => (
                    <ChangeRow key={`${c.field}-${i}`} change={c} />
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">Sem detalhes de campos alterados.</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
