import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Loader2, Clock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { isTestCompanyDb } from "@/lib/test-company";
import { expenseRead } from "@/lib/expense-read";

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
  const [syncingFluxo, setSyncingFluxo] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [granularity, setGranularity] = useState<Granularity>("week");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      // Fonte de dados: sap_fluxo_analise_cache (VW_FIN_ANALISE_FLUXO), usando
      // data_lancamento como data do documento. Chave = company_db::id_pedido.
      const all: { doc_date: string; company_db: string; doc_entry: number }[] = [];
      let offset = 0;
      while (true) {
        let q = supabase
          .from("sap_fluxo_analise_cache")
          .select("data_lancamento, company_db, id_pedido")
          .gte("data_lancamento", START_DATE)
          .not("data_lancamento", "is", null)
          .not("id_pedido", "is", null)
          .order("data_lancamento", { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);
        if (!consolidated && companyDb) q = q.eq("company_db", companyDb);
        const { data, error } = await q;
        if (error) {
          console.error("DailyTimeSpentChart load error", error);
          break;
        }
        if (!data || data.length === 0) break;
        for (const r of data as { data_lancamento: string; company_db: string; id_pedido: string }[]) {
          const doc = Number(r.id_pedido);
          if (!Number.isFinite(doc)) continue;
          all.push({
            doc_date: String(r.data_lancamento).slice(0, 10),
            company_db: r.company_db,
            doc_entry: doc,
          });
        }
        if (data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
        if (offset > 200000) break;
      }

      // Fallback: para company_db::id_pedido sem data_lancamento no
      // sap_fluxo_analise_cache, usa doc_date do sap_purchase_order_cache.
      // Isso cobre pedidos ainda não sincronizados no VW_FIN_ANALISE_FLUXO
      // ou linhas onde data_lancamento veio nula (esboço ainda não virou PC).
      const haveKey = new Set(all.map((r) => `${r.company_db}::${r.doc_entry}`));
      let poOffset = 0;
      while (true) {
        let pq = supabase
          .from("sap_purchase_order_cache")
          .select("doc_date, company_db, doc_entry")
          .gte("doc_date", START_DATE)
          .not("doc_date", "is", null)
          .order("doc_date", { ascending: true })
          .range(poOffset, poOffset + PAGE_SIZE - 1);
        if (!consolidated && companyDb) pq = pq.eq("company_db", companyDb);
        const { data, error } = await pq;
        if (error) {
          console.error("DailyTimeSpentChart fallback (PO cache) error", error);
          break;
        }
        if (!data || data.length === 0) break;
        for (const r of data as { doc_date: string; company_db: string; doc_entry: number }[]) {
          const key = `${r.company_db}::${r.doc_entry}`;
          if (haveKey.has(key)) continue;
          haveKey.add(key);
          all.push({
            doc_date: String(r.doc_date).slice(0, 10),
            company_db: r.company_db,
            doc_entry: r.doc_entry,
          });
        }
        if (data.length < PAGE_SIZE) break;
        poOffset += PAGE_SIZE;
        if (poOffset > 200000) break;
      }

      // Identifica POs criados via ERP Flow (têm expense vinculada)
      const expAll: { company_db: string; sap_doc_entry: number }[] = [];
      let expOffset = 0;
      while (true) {
        let eq = expenseRead("expenses")
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

  const runFluxoSync = async () => {
    setSyncingFluxo(true);
    try {
      const { data, error } = await supabase.functions.invoke("sap-fluxo-analise-sync", {
        body: companyDb ? { company_db: companyDb } : {},
      });
      if (error) throw error;
      const total = (data as any)?.total_synced ?? 0;
      toast.success(`VW_FIN_ANALISE_FLUXO sincronizada — ${total} linhas`);
      setReloadKey((k) => k + 1);
    } catch (e: any) {
      toast.error(`Sync do fluxo falhou: ${e?.message || e}`);
    } finally {
      setSyncingFluxo(false);
    }
  };

  // Reconstrói a série completa: sincroniza o cache do fluxo (VW_FIN_ANALISE_FLUXO)
  // e, em seguida, atualiza o cache de pedidos SAP (fonte do fallback usado
  // quando data_lancamento está ausente). Ao final, recarrega o gráfico.
  const [rebuilding, setRebuilding] = useState(false);
  const runRebuildSeries = async () => {
    setRebuilding(true);
    try {
      const { data: fluxoData, error: fluxoErr } = await supabase.functions.invoke("sap-fluxo-analise-sync", {
        body: companyDb ? { company_db: companyDb } : {},
      });
      if (fluxoErr) throw fluxoErr;
      const fluxoTotal = (fluxoData as any)?.total_synced ?? 0;

      const { data: poData, error: poErr } = await supabase.functions.invoke("sap-po-cache-sync", {
        body: { backfill: true, from_date: START_DATE, ...(companyDb ? { company_db: companyDb } : {}) },
      });
      if (poErr) throw poErr;
      const poTotal = (poData as any)?.total_synced ?? 0;

      toast.success(`Série reconstruída — fluxo: ${fluxoTotal} linhas · pedidos (fallback): ${poTotal}`);
      setReloadKey((k) => k + 1);
    } catch (e: any) {
      toast.error(`Reconstrução falhou: ${e?.message || e}`);
    } finally {
      setRebuilding(false);
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
            <>
              <Button size="sm" variant="outline" onClick={runBackfill} disabled={backfilling}>
                {backfilling ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                <span className="ml-1">Backfill SAP</span>
              </Button>
              <Button size="sm" variant="outline" onClick={runFluxoSync} disabled={syncingFluxo}>
                {syncingFluxo ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                <span className="ml-1">Sync Fluxo HANA</span>
              </Button>
              <Button
                size="sm"
                variant="default"
                onClick={runRebuildSeries}
                disabled={rebuilding || backfilling || syncingFluxo}
                title="Sincroniza VW_FIN_ANALISE_FLUXO e o cache de pedidos SAP (usado como fallback quando data_lancamento está ausente) e recarrega o gráfico."
              >
                {rebuilding ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                <span className="ml-1">Reconstruir série</span>
              </Button>
            </>
          )}

        </div>
      </div>

      {/* Legenda fixa: origem das datas e regra de classificação das séries. */}
      <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-foreground/80">
            Origem da data do lançamento
          </div>
          <div>
            Primária:{" "}
            <code className="font-mono text-foreground">sap_fluxo_analise_cache.data_lancamento</code>{" "}
            (view HANA <code className="font-mono">VW_FIN_ANALISE_FLUXO</code>), agrupada pelo{" "}
            {granularity === "day" ? "dia" : granularity === "week" ? "início da semana" : "mês"}.
          </div>
          <div>
            Fallback (quando ausente para <code className="font-mono">company_db::id_pedido</code>):{" "}
            <code className="font-mono text-foreground">sap_purchase_order_cache.doc_date</code>.
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-foreground/80">
            Classificação das séries
          </div>
          <div className="flex items-start gap-2">
            <span aria-hidden className="mt-1 w-2 h-2 rounded-full bg-primary shrink-0" />
            <span>
              <span className="text-primary font-medium">ERP Flow</span> — pedido com{" "}
              <code className="font-mono">expenses.sap_doc_entry</code> vinculado (foi lançado via ERP Flow).
              Vale apenas para lançamentos a partir de {new Date(FLOW_LAUNCH_DATE + "T00:00:00Z").toLocaleDateString("pt-BR")}.
            </span>
          </div>
          <div className="flex items-start gap-2">
            <span aria-hidden className="mt-1 w-2 h-2 rounded-full bg-destructive shrink-0" />
            <span>
              <span className="text-destructive font-medium">SAP puro</span> — pedido sem esse vínculo (lançado direto no SAP).
            </span>
          </div>
          <div className="opacity-80">
            Minutos/dia = (nº pedidos × tempo unitário) ÷ dias do bucket · unitário: SAP {tempoLancarSapMin}min, Flow {tempoLancarFlowMin}min.
          </div>
        </div>
      </div>


      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : data.length === 0 || totals.docs === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Sem lançamentos no cache do fluxo SAP (VW_FIN_ANALISE_FLUXO).{isAdmin ? " Clique em \"Sync Fluxo HANA\" para importar o histórico." : ""}
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
                cursor={{ stroke: "hsl(var(--muted-foreground))", strokeOpacity: 0.25 }}
                content={({ active, label, payload }: any) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const p = payload[0]?.payload || {};
                  const sapPoint = payload.find((it: any) => String(it?.dataKey) === "sap_min");
                  const flowPoint = payload.find((it: any) => String(it?.dataKey) === "flow_min");
                  const sapMin = Number(sapPoint?.value ?? 0);
                  const flowMin = Number(flowPoint?.value ?? 0);
                  const sapDocs = Number(p.docs_sap ?? 0);
                  const flowDocs = Number(p.docs_flow ?? 0);
                  const total = sapDocs + flowDocs;
                  return (
                    <div
                      className="rounded-lg border border-border bg-card/95 backdrop-blur px-3 py-2 shadow-lg text-xs space-y-2 max-w-[320px]"
                      role="tooltip"
                    >
                      <div className="font-semibold text-foreground">
                        {`${bucketNoun[0].toUpperCase() + bucketNoun.slice(1)} de ${fmtBucket(String(label))}`}
                      </div>
                      <div className="text-[11px] leading-snug text-muted-foreground">
                        <div>
                          <span className="text-foreground">Data:</span>{" "}
                          <code className="font-mono">sap_fluxo_analise_cache.data_lancamento</code>{" "}
                          <span className="opacity-70">(fallback:</span>{" "}
                          <code className="font-mono">sap_purchase_order_cache.doc_date</code>
                          <span className="opacity-70">)</span>
                        </div>
                        <div>
                          <span className="text-foreground">Classificação:</span> pedidos com{" "}
                          <code className="font-mono">expenses.sap_doc_entry</code> vinculado ={" "}
                          <span className="text-primary font-medium">ERP Flow</span>; sem vínculo ={" "}
                          <span className="text-destructive font-medium">SAP puro</span>.
                        </div>
                      </div>
                      <div className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-3 gap-y-1">
                        <span className="inline-flex items-center gap-1.5 text-destructive">
                          <span aria-hidden className="w-2 h-2 rounded-full bg-destructive" />
                          SAP puro
                        </span>
                        <span className="text-muted-foreground">
                          {sapDocs} pedidos × {tempoLancarSapMin} min
                        </span>
                        <span className="font-mono text-foreground">{sapMin.toFixed(1)} min/dia</span>

                        <span className="inline-flex items-center gap-1.5 text-primary">
                          <span aria-hidden className="w-2 h-2 rounded-full bg-primary" />
                          ERP Flow
                        </span>
                        <span className="text-muted-foreground">
                          {flowDocs} pedidos × {tempoLancarFlowMin} min
                        </span>
                        <span className="font-mono text-foreground">{flowMin.toFixed(1)} min/dia</span>

                        <span className="pt-1 border-t border-border/60 col-span-3" />
                        <span className="text-muted-foreground">Total</span>
                        <span className="text-muted-foreground">{total} pedidos</span>
                        <span className="font-mono text-foreground">{(sapMin + flowMin).toFixed(1)} min/dia</span>
                      </div>
                    </div>
                  );
                }}
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
