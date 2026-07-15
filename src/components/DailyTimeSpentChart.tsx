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
/** Data em que o ERP Flow entrou em produção. Antes disso, 0 documentos via Flow. */
const FLOW_LAUNCH_DATE = "2026-07-01";
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
  const [rows, setRows] = useState<{ doc_date: string; company_db: string; doc_entry: number }[]>([]);
  const [flowKeys, setFlowKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [granularity, setGranularity] = useState<Granularity>("week");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const all: { doc_date: string; company_db: string; doc_entry: number }[] = [];
      let offset = 0;
      while (true) {
        let q = supabase
          .from("sap_purchase_order_cache")
          .select("doc_date, company_db, doc_entry", { count: "exact" })
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
        all.push(...(data as { doc_date: string; company_db: string; doc_entry: number }[]));
        if (data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
        if (offset > 200000) break;
      }

      // Identifica POs criados via ERP Flow (têm expense vinculada)
      const expAll: { company_db: string; sap_doc_entry: number }[] = [];
      let expOffset = 0;
      while (true) {
        let eq = supabase
          .from("expenses")
          .select("company_db, sap_doc_entry")
          .not("sap_doc_entry", "is", null)
          .range(expOffset, expOffset + PAGE_SIZE - 1);
        if (!consolidated && companyDb) eq = eq.eq("company_db", companyDb);
        const { data, error } = await eq;
        if (error) { console.error("DailyTimeSpentChart expenses error", error); break; }
        if (!data || data.length === 0) break;
        expAll.push(...(data as any));
        if (data.length < PAGE_SIZE) break;
        expOffset += PAGE_SIZE;
        if (expOffset > 200000) break;
      }
      if (cancelled) return;
      const flow = new Set(expAll.map((e) => `${e.company_db}::${e.sap_doc_entry}`));
      // Exclui bases de teste
      setRows(all.filter((r) => !isTestCompanyDb(r.company_db)));
      setFlowKeys(flow);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [companyDb, consolidated, reloadKey]);

  const data = useMemo(() => {
    type B = { sap: number; flow: number };
    const byBucket = new Map<string, B>();
    for (const r of rows) {
      const day = (r.doc_date || "").slice(0, 10);
      if (!day) continue;
      const isFlow = flowKeys.has(`${r.company_db}::${r.doc_entry}`) && day >= FLOW_LAUNCH_DATE;
      const k = bucketKey(day, granularity);
      const cur = byBucket.get(k) || { sap: 0, flow: 0 };
      if (isFlow) cur.flow++; else cur.sap++;
      byBucket.set(k, cur);
    }
    if (!byBucket.size) return [];
    const daysInBucket = granularity === "day" ? 1 : granularity === "week" ? 7 : 30;
    const buckets = [...byBucket.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, { sap, flow }]) => ({
        date: key,
        docs: sap + flow,
        docs_sap: sap,
        docs_flow: flow,
        // SAP puro = docs que NÃO passaram pelo Flow
        sap_min: (sap * tempoLancarSapMin) / daysInBucket,
        // Flow = docs integrados via Flow (0 antes de FLOW_LAUNCH_DATE)
        flow_min: (flow * tempoLancarFlowMin) / daysInBucket,
      }));
    return buckets;
  }, [rows, flowKeys, tempoLancarFlowMin, tempoLancarSapMin, granularity]);

  const totals = useMemo(() => {
    let sapDocs = 0, flowDocs = 0;
    for (const r of rows) {
      const day = (r.doc_date || "").slice(0, 10);
      const isFlow = flowKeys.has(`${r.company_db}::${r.doc_entry}`) && day >= FLOW_LAUNCH_DATE;
      if (isFlow) flowDocs++; else sapDocs++;
    }
    return {
      docs: sapDocs + flowDocs,
      docs_sap: sapDocs,
      docs_flow: flowDocs,
      flow: flowDocs * tempoLancarFlowMin,
      sap: sapDocs * tempoLancarSapMin,
    };
  }, [rows, flowKeys, tempoLancarFlowMin, tempoLancarSapMin]);

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
            Desde 01/06/2025 · <strong className="text-foreground">{totals.docs}</strong> pedidos
            {" "}(<strong className="text-foreground">{totals.docs_sap}</strong> SAP puro + <strong className="text-foreground">{totals.docs_flow}</strong> via Flow) ·
            {" "}Flow <strong className="text-foreground">{fmtH(totals.flow / 60)}</strong> vs
            {" "}SAP puro <strong className="text-foreground">{fmtH(totals.sap / 60)}</strong>
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
                  const p = ctx?.payload || {};
                  const isFlow = name.startsWith("ERP Flow");
                  const n = isFlow ? p.docs_flow : p.docs_sap;
                  return [`${Number(value).toFixed(1)} min/dia (${n ?? 0} pedidos)`, name];
                }}
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="sap_min" name={`SAP puro (${tempoLancarSapMin}min/pedido)`} stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="flow_min" name={`ERP Flow (${tempoLancarFlowMin}min/pedido)`} stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />

            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

    </div>
  );
}
