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
  const [rows, setRows] = useState<{ doc_date: string; company_db: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [granularity, setGranularity] = useState<Granularity>("week");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const all: { doc_date: string; company_db: string }[] = [];
      let offset = 0;
      while (true) {
        let q = supabase
          .from("sap_purchase_order_cache")
          .select("doc_date, company_db", { count: "exact" })
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
        all.push(...(data as { doc_date: string; company_db: string }[]));
        if (data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
        if (offset > 200000) break;
      }
      if (cancelled) return;
      // Exclui bases de teste
      setRows(all.filter((r) => !isTestCompanyDb(r.company_db)));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [companyDb, consolidated, reloadKey]);

  const data = useMemo(() => {
    const byBucket = new Map<string, number>();
    for (const r of rows) {
      const day = (r.doc_date || "").slice(0, 10);
      if (!day) continue;
      const k = bucketKey(day, granularity);
      byBucket.set(k, (byBucket.get(k) || 0) + 1);
    }
    if (!byBucket.size) return [];
    // Média por dia dentro do bucket: total_min / dias_no_bucket
    const daysInBucket = granularity === "day" ? 1 : granularity === "week" ? 7 : 30;
    const buckets = [...byBucket.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, docs]) => ({
        date: key,
        docs,
        flow_min: (docs * tempoLancarFlowMin) / daysInBucket,
        sap_min: (docs * tempoLancarSapMin) / daysInBucket,
      }));
    return buckets;
  }, [rows, tempoLancarFlowMin, tempoLancarSapMin, granularity]);

  const totals = useMemo(() => {
    const docs = rows.length;
    const flow = docs * tempoLancarFlowMin;
    const sap = docs * tempoLancarSapMin;
    return { docs, flow, sap };
  }, [rows, tempoLancarFlowMin, tempoLancarSapMin]);

  const fmtBucket = (v: string) => fmtBucketLabel(v, granularity);
  const fmtH = (v: number) => `${v.toFixed(1)}h`;
  const unitLabel = granularity === "day" ? "min/dia (média)" : granularity === "week" ? "min/dia (média da semana)" : "min/dia (média do mês)";
  const bucketNoun = granularity === "day" ? "dia" : granularity === "week" ? "semana" : "mês";


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
          Tempo gasto no lançamento por {bucketNoun} (pedidos de compra SAP)
        </h3>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <ToggleGroup
            type="single"
            size="sm"
            value={granularity}
            onValueChange={(v) => v && setGranularity(v as Granularity)}
          >
            <ToggleGroupItem value="day" className="text-xs h-7 px-2">Dia</ToggleGroupItem>
            <ToggleGroupItem value="week" className="text-xs h-7 px-2">Semana</ToggleGroupItem>
            <ToggleGroupItem value="month" className="text-xs h-7 px-2">Mês</ToggleGroupItem>
          </ToggleGroup>
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
              <XAxis dataKey="date" tickFormatter={fmtBucket} minTickGap={24} fontSize={11} />
              <YAxis
                fontSize={11}
                tickFormatter={(v) => `${Math.round(v)}min`}
                label={{ value: unitLabel, angle: -90, position: "insideLeft", fontSize: 11 }}
              />
              <Tooltip
                labelFormatter={(l) => `${bucketNoun[0].toUpperCase() + bucketNoun.slice(1)} de ${fmtBucket(String(l))}`}
                formatter={(value: any, name: string, ctx: any) => {
                  const docs = ctx?.payload?.docs;
                  return [`${Number(value).toFixed(1)} min/dia (${docs} pedidos)`, name];
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
