import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Search, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TimelineEvent {
  occurred_at: string | null;
  source: string;
  category: string;
  title: string | null;
  detail: string | null;
  actor: string | null;
  status: string | null;
  meta: Record<string, unknown> | null;
}

const SOURCE_LABEL: Record<string, string> = {
  documento: "Documento",
  aprovacao: "Aprovação",
  auditoria: "Auditoria",
  banco: "Banco de dados",
  integracao: "Integração",
  sap: "SAP",
  notificacao: "Notificação",
  email: "E-mail",
};

const SOURCE_TONE: Record<string, string> = {
  documento: "bg-slate-500/15 text-slate-500 border-slate-500/30",
  aprovacao: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  auditoria: "bg-violet-500/15 text-violet-500 border-violet-500/30",
  banco: "bg-blue-500/15 text-blue-500 border-blue-500/30",
  integracao: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  sap: "bg-cyan-500/15 text-cyan-600 border-cyan-500/30",
  notificacao: "bg-fuchsia-500/15 text-fuchsia-500 border-fuchsia-500/30",
  email: "bg-teal-500/15 text-teal-600 border-teal-500/30",
};

const fmt = (v: string | null) => (v ? new Date(v).toLocaleString("pt-BR") : "—");

function statusTone(status: string | null) {
  const s = (status ?? "").toLowerCase();
  if (["failed", "erro", "error", "rejeitado", "exhausted"].some((k) => s.includes(k))) return "text-destructive";
  if (["success", "aprovado", "sent", "ok", "finalizado"].some((k) => s.includes(k))) return "text-emerald-600";
  if (["pending", "pendente", "retry", "in_flight"].some((k) => s.includes(k))) return "text-amber-600";
  return "text-muted-foreground";
}

/**
 * Linha do tempo unificada de um documento: reúne eventos de ciclo de vida,
 * aprovações, auditoria de dados, integrações ERP/SAP, notificações e e-mails.
 */
export function DocumentTimeline({ expenseId }: { expenseId: string }) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sources, setSources] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("get_document_timeline" as never, {
      _expense_id: expenseId,
    } as never);
    if (err) setError(err.message);
    else setEvents((data ?? []) as unknown as TimelineEvent[]);
    setLoading(false);
  }, [expenseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const availableSources = useMemo(
    () => Array.from(new Set(events.map((e) => e.source))),
    [events],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((e) => {
      if (sources.length > 0 && !sources.includes(e.source)) return false;
      if (!q) return true;
      return [e.title, e.detail, e.actor, e.status, e.source, JSON.stringify(e.meta ?? {})]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [events, query, sources]);

  const toggleSource = (s: string) =>
    setSources((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Pesquisar em toda a trilha (ator, erro, status, campo…)"
            className="pl-8"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      {availableSources.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {availableSources.map((s) => (
            <button key={s} type="button" onClick={() => toggleSource(s)}>
              <Badge
                variant="outline"
                className={cn(
                  "cursor-pointer text-[11px]",
                  sources.length === 0 || sources.includes(s)
                    ? SOURCE_TONE[s] ?? ""
                    : "opacity-40",
                )}
              >
                {SOURCE_LABEL[s] ?? s} · {events.filter((e) => e.source === s).length}
              </Badge>
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading && (
        <div className="py-8 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
      {!loading && filtered.length === 0 && !error && (
        <p className="text-sm text-muted-foreground py-6 text-center">
          Nenhum evento encontrado para este documento com os filtros atuais.
        </p>
      )}

      <ol className="relative border-l border-border pl-5 space-y-4">
        {filtered.map((e, i) => (
          <li key={`${e.source}-${e.occurred_at}-${i}`} className="relative">
            <span
              className={cn(
                "absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background",
                (SOURCE_TONE[e.source] ?? "bg-muted").split(" ")[0],
              )}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={cn("text-[10px]", SOURCE_TONE[e.source] ?? "")}>
                {SOURCE_LABEL[e.source] ?? e.source}
              </Badge>
              <span className="text-sm font-medium">{e.title ?? "—"}</span>
              {e.status && (
                <span className={cn("text-xs", statusTone(e.status))}>{e.status}</span>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {fmt(e.occurred_at)}
              {e.actor ? ` · ${e.actor}` : ""}
            </div>
            {e.detail && <p className="text-xs mt-1 break-words">{e.detail}</p>}
            {e.meta && Object.keys(e.meta).length > 0 && (
              <details className="mt-1">
                <summary className="text-[11px] text-muted-foreground cursor-pointer">Detalhes técnicos</summary>
                <pre className="text-[11px] bg-muted/40 rounded p-2 mt-1 overflow-x-auto">
                  {JSON.stringify(e.meta, null, 2)}
                </pre>
              </details>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
