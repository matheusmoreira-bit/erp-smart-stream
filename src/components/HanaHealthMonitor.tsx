import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, Radio, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ProbeRow {
  id: string;
  base_url: string;
  company_db: string | null;
  view_name: string | null;
  ok: boolean;
  http_status: number | null;
  duration_ms: number | null;
  error_message: string | null;
  created_at: string;
}

const fmtMs = (v: number | null) => (v == null ? "—" : v < 1000 ? `${Math.round(v)}ms` : `${(v / 1000).toFixed(1)}s`);
const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleString("pt-BR") : "—");

interface EndpointStat {
  base: string;
  last: ProbeRow;
  total: number;
  errors: number;
  uptime: number;
  avgMs: number;
}

export function HanaHealthMonitor() {
  const [rows, setRows] = useState<ProbeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const since = new Date(Date.now() - 24 * 3600_000).toISOString();
      const { data, error: err } = await supabase
        .from("hana_health_probes")
        .select("id, base_url, company_db, view_name, ok, http_status, duration_ms, error_message, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(500);
      if (err) throw err;
      setRows((data ?? []) as ProbeRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const endpoints = useMemo<EndpointStat[]>(() => {
    const map = new Map<string, ProbeRow[]>();
    for (const r of rows) {
      const list = map.get(r.base_url) ?? [];
      list.push(r);
      map.set(r.base_url, list);
    }
    return Array.from(map.entries()).map(([base, list]) => {
      const errors = list.filter((r) => !r.ok).length;
      return {
        base,
        last: list[0],
        total: list.length,
        errors,
        uptime: list.length ? (100 * (list.length - errors)) / list.length : 0,
        avgMs: list.length ? Math.round(list.reduce((a, r) => a + Number(r.duration_ms ?? 0), 0) / list.length) : 0,
      };
    }).sort((a, b) => a.base.localeCompare(b.base));
  }, [rows]);

  const failures = useMemo(() => rows.filter((r) => !r.ok).slice(0, 15), [rows]);

  const runProbe = async () => {
    setProbing(true);
    try {
      const { data, error: err } = await supabase.functions.invoke("hana-health-probe", { body: {} });
      if (err) throw err;
      const down = (data as { allDown?: boolean } | null)?.allDown;
      toast[down ? "error" : "success"](
        down ? "HanaAPI V2 sem comunicação em todos os endpoints" : "Sondagem concluída",
      );
      await load();
    } catch (e) {
      toast.error(`Falha na sondagem: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setProbing(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Radio className="w-4 h-4 text-muted-foreground" />
              Monitor HanaAPI V2
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Sondagem ativa a cada 5 minutos em cada endpoint (IP primário e fallback). Alerta por e-mail/Slack em falhas
              non-2XX ou queda de comunicação.
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={() => void runProbe()} disabled={probing}>
              {probing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radio className="w-4 h-4" />}
              <span className="ml-2">Testar agora</span>
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="w-4 h-4" /> {error}
          </div>
        )}

        {endpoints.length === 0 && !loading ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma sondagem nas últimas 24h. Use “Testar agora” para gerar a primeira medição.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {endpoints.map((e) => (
              <div key={e.base} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono truncate">{e.base}</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px]",
                      e.last.ok
                        ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"
                        : "bg-destructive/15 text-destructive border-destructive/30",
                    )}
                  >
                    {e.last.ok ? "online" : e.last.http_status ? `HTTP ${e.last.http_status}` : "sem resposta"}
                  </Badge>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Disponibilidade 24h</span>
                  <span className={cn("font-medium", e.uptime < 95 ? "text-destructive" : "text-emerald-600")}>
                    {e.uptime.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Tempo médio</span>
                  <span className="font-medium">{fmtMs(e.avgMs)}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Última sondagem</span>
                  <span>{fmtDate(e.last.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {failures.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Erro</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failures.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="text-xs whitespace-nowrap">{fmtDate(f.created_at)}</TableCell>
                    <TableCell className="text-xs font-mono">{f.base_url}</TableCell>
                    <TableCell className="text-xs">{f.http_status ?? "sem resposta"}</TableCell>
                    <TableCell className="text-xs max-w-[420px] truncate" title={f.error_message ?? ""}>
                      {f.error_message ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
