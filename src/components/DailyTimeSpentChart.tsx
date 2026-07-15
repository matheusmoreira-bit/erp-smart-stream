import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Loader2, Clock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { isTestCompanyDb } from "@/lib/test-company";

interface Props {
  companyDb?: string;
  consolidated?: boolean;
  tempoLancarFlowMin: number;
  tempoLancarSapMin: number;
}

type Granularity = "day" | "week" | "month";
const START_DATE = "2025-06-01";
const PAGE_SIZE = 1000;

function bucketKey(iso: string, g: Granularity): string {
  if (g === "day") return iso;
  const d = new Date(iso + "T00:00:00Z");
  if (g === "month") return iso.slice(0, 7); // YYYY-MM
  // week: segunda-feira como âncora
  const day = d.getUTCDay(); // 0=Dom..6=Sáb
  const diff = (day + 6) % 7; // dias desde segunda
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

function fmtBucketLabel(key: string, g: Granularity): string {
  if (g === "month") {
    const [y, m] = key.split("-");
    return `${m}/${y.slice(2)}`;
  }
  const [y, m, d] = key.split("-");
  return `${d}/${m}`;
}


export function DailyTimeSpentChart({ companyDb, consolidated, tempoLancarFlowMin, tempoLancarSapMin }: Props) {
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState<{ doc_date: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const all: { doc_date: string }[] = [];
      let offset = 0;
      // Paginar sap_purchase_order_cache
      while (true) {
        let q = supabase
          .from("sap_purchase_order_cache")
          .select("doc_date", { count: "exact" })
          .gte("doc_date", START_DATE)
          .not("doc_date", "is", null)
          .order("doc_date", { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);
        if (!consolidated && companyDb) q = q.eq("company_db", companyDb);
        const { data, error } = await q;
        if (error) {
          console.error("DailyTimeSpentChart load error", error);
          break;
        }
        if (!data || data.length === 0) break;
        all.push(...(data as { doc_date: string }[]));
        if (data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
        if (offset > 200000) break; // hard cap
      }
      if (cancelled) return;
      setRows(all);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [companyDb, consolidated, reloadKey]);

  const data = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const r of rows) {
      const day = (r.doc_date || "").slice(0, 10);
      if (!day) continue;
      byDay.set(day, (byDay.get(day) || 0) + 1);
    }
    if (!byDay.size) return [];
    const days: { date: string; docs: number; flow_min: number; sap_min: number }[] = [];
    const start = new Date(START_DATE + "T00:00:00Z");
    const end = new Date();
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      const docs = byDay.get(key) || 0;
      days.push({
        date: key,
        docs,
        flow_min: docs * tempoLancarFlowMin,
        sap_min: docs * tempoLancarSapMin,
      });
    }
    return days;
  }, [rows, tempoLancarFlowMin, tempoLancarSapMin]);

  const totals = useMemo(() => {
    const docs = data.reduce((s, d) => s + d.docs, 0);
    const flow = data.reduce((s, d) => s + d.flow_min, 0);
    const sap = data.reduce((s, d) => s + d.sap_min, 0);
    return { docs, flow, sap };
  }, [data]);

  const fmtDate = (v: string) => {
    const [y, m, d] = v.split("-");
    return `${d}/${m}`;
  };
  const fmtH = (v: number) => `${v.toFixed(1)}h`;

  const runBackfill = async () => {
    setBackfilling(true);
    try {
      const { data, error } = await supabase.functions.invoke("sap-po-cache-sync", {
        body: { backfill: true, from_date: START_DATE, ...(companyDb ? { company_db: companyDb } : {}) },
      });
      if (error) throw error;
      const total = (data as any)?.total_synced ?? 0;
      toast.success(`Backfill executado — ${total} pedidos importados`);
      setReloadKey((k) => k + 1);
    } catch (e: any) {
      toast.error(`Backfill falhou: ${e?.message || e}`);
    } finally {
      setBackfilling(false);
    }
  };

  return (
    <div className="glass-card p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm sm:text-base font-semibold flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" />
          Tempo gasto no lançamento por dia (pedidos de compra SAP)
        </h3>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            Desde 01/06/2025 · <strong className="text-foreground">{totals.docs}</strong> pedidos ·
            {" "}Flow <strong className="text-foreground">{fmtH(totals.flow / 60)}</strong> vs
            {" "}SAP <strong className="text-foreground">{fmtH(totals.sap / 60)}</strong> ·
            {" "}economia <strong className="text-primary">{fmtH((totals.sap - totals.flow) / 60)}</strong>
          </span>
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={runBackfill} disabled={backfilling}>
              {backfilling ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              <span className="ml-1">Backfill SAP</span>
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : data.length === 0 || totals.docs === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Sem pedidos no cache SAP.{isAdmin ? " Clique em \"Backfill SAP\" para importar o histórico." : ""}
        </div>
      ) : (
        <div className="h-72 w-full">
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={24} fontSize={11} />
              <YAxis
                fontSize={11}
                tickFormatter={(v) => `${v}min`}
                label={{ value: "min/dia", angle: -90, position: "insideLeft", fontSize: 11 }}
              />
              <Tooltip
                labelFormatter={(l) => `Dia ${fmtDate(String(l))}`}
                formatter={(value: any, name: string, ctx: any) => {
                  const docs = ctx?.payload?.docs;
                  return [`${value} min (${docs} pedidos)`, name];
                }}
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="sap_min" name={`SAP (${tempoLancarSapMin}min/pedido)`} stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="flow_min" name={`ERP Flow (${tempoLancarFlowMin}min/pedido)`} stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
