import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Loader2, Clock } from "lucide-react";

interface Props {
  companyDb?: string;
  consolidated?: boolean;
  tempoLancarFlowMin: number;
  tempoLancarSapMin: number;
}

const START_DATE = "2025-06-01";

export function DailyTimeSpentChart({ companyDb, consolidated, tempoLancarFlowMin, tempoLancarSapMin }: Props) {
  const [rows, setRows] = useState<{ created_at: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let q = supabase
        .from("expenses")
        .select("created_at")
        .gte("created_at", `${START_DATE}T00:00:00Z`)
        .order("created_at", { ascending: true })
        .limit(50000);
      if (!consolidated && companyDb) q = q.eq("company_db", companyDb);
      const { data, error } = await q;
      if (cancelled) return;
      if (error) {
        console.error("DailyTimeSpentChart load error", error);
        setRows([]);
      } else {
        setRows((data || []) as { created_at: string }[]);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [companyDb, consolidated]);

  const data = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const r of rows) {
      const day = r.created_at.slice(0, 10);
      byDay.set(day, (byDay.get(day) || 0) + 1);
    }
    // preencher dias faltantes
    if (!byDay.size) return [];
    const days: { date: string; docs: number; flow_min: number; sap_min: number; flow_h: number; sap_h: number }[] = [];
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
        flow_h: (docs * tempoLancarFlowMin) / 60,
        sap_h: (docs * tempoLancarSapMin) / 60,
      });
    }
    return days;
  }, [rows, tempoLancarFlowMin, tempoLancarSapMin]);

  const totals = useMemo(() => {
    const docs = data.reduce((s, d) => s + d.docs, 0);
    const flow = data.reduce((s, d) => s + d.flow_min, 0);
    const sap = data.reduce((s, d) => s + d.sap_min, 0);
    return { docs, flow, sap, economia: sap - flow };
  }, [data]);

  const fmtDate = (v: string) => {
    const [y, m, d] = v.split("-");
    return `${d}/${m}`;
  };
  const fmtH = (v: number) => `${v.toFixed(1)}h`;

  return (
    <div className="glass-card p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm sm:text-base font-semibold flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" />
          Tempo gasto no lançamento por dia
        </h3>
        <div className="text-xs text-muted-foreground">
          Desde 01/06/2025 · <strong className="text-foreground">{totals.docs}</strong> documentos ·
          {" "}Flow <strong className="text-foreground">{fmtH(totals.flow / 60)}</strong> vs
          {" "}SAP <strong className="text-foreground">{fmtH(totals.sap / 60)}</strong> ·
          {" "}economia <strong className="text-primary">{fmtH((totals.sap - totals.flow) / 60)}</strong>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : data.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Sem documentos no período.</div>
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
                  return [`${value} min (${docs} docs)`, name];
                }}
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="sap_min" name={`SAP (${tempoLancarSapMin}min/doc)`} stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="flow_min" name={`ERP Flow (${tempoLancarFlowMin}min/doc)`} stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
