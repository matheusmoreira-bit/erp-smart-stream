import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isTestCompanyDb } from "@/lib/test-company";


export interface RoiParameters {
  id: string;
  company_db: string | null;
  salario_aprovador: number;
  salario_solicitante: number;
  tempo_lancar_sap_min: number;
  tempo_aprovar_sap_min: number;
  tempo_lancar_flow_min: number;
  tempo_aprovar_flow_min: number;
  custo_licenca_aprovador_sap: number;
  custo_licenca_solicitante_sap: number;
  custo_licenca_flow: number;
  multa_percent: number;
  juros_mes_percent: number;
  horas_mes: number;
}

export interface RoiCompanyMetrics {
  company_db: string;
  display_name: string;
  n_docs: number;
  n_approvals: number;
  n_aprovadores: number;
  n_solicitantes: number;
  // Segregação por origem
  n_docs_sap_only: number;   // Criados direto no SAP (sem passar pelo ERP Flow)
  n_docs_via_flow: number;   // Criados no ERP Flow, aprovados e integrados ao SAP
  valor_sap_only: number;
  valor_via_flow: number;
  docs_atrasados_sap_only: number;
  docs_atrasados_via_flow: number;
  prejuizo_atraso_sap_only: number;
  prejuizo_atraso_via_flow: number;
  antecedencia_media_dias: number | null;
  atraso_medio_dias: number | null;
  docs_atrasados: number;
  valor_total_docs: number;
  prejuizo_atraso: number;
  // Tempos operacionais (horas / período)
  horas_sap: number;
  horas_flow: number;
  // Custos (R$ / período)
  custo_tempo_sap: number;
  custo_tempo_flow: number;
  custo_licencas_sap_mes: number;
  custo_licencas_flow_mes: number;
  // Totais
  custo_total_sap: number;
  custo_total_flow: number;
  economia_periodo: number;
  economia_percent: number;
}

interface Options {
  companyDb?: string;
  from?: Date;
  to?: Date;
  /** true = agrega TODAS empresas (back-office) */
  consolidated?: boolean;
}

function daysBetween(a: Date, b: Date) {
  return (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24);
}

function pickParams(all: RoiParameters[], companyDb: string): RoiParameters {
  const perCompany = all.find((p) => p.company_db === companyDb);
  const global = all.find((p) => p.company_db === null);
  return (perCompany || global) as RoiParameters;
}

/**
 * Cronograma real de aquisição de licenças SAP.
 * A partir de cada data, o total de licenças ativas passa a ser `total`.
 * Distribuição: 60% PRO (R$1.400/mês) + 40% CRM (R$900/mês).
 */
const SAP_LICENSE_SCHEDULE: Array<{ from: string; total: number }> = [
  { from: "2000-01-01", total: 22 },  // contrato original
  { from: "2025-04-28", total: 51 },  // +29
  { from: "2025-06-30", total: 62 },  // +11
  { from: "2025-08-30", total: 83 },  // +21
  { from: "2026-07-14", total: 103 }, // +20 transferidas da Cactus
];
const SAP_PRO_RATIO = 0.6;
const SAP_PRO_MONTHLY = 1400;
const SAP_CRM_MONTHLY = 900;

function sapLicensesOn(dateIso: string): number {
  let n = 0;
  for (const s of SAP_LICENSE_SCHEDULE) if (dateIso >= s.from) n = s.total;
  return n;
}

/** Custo total das licenças SAP no intervalo [from, to] (inclusive), integrando dia a dia. */
function sapLicenseCostInPeriod(from: Date, to: Date): number {
  if (to < from) return 0;
  let total = 0;
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (d <= end) {
    const iso = d.toISOString().slice(0, 10);
    const n = sapLicensesOn(iso);
    const pro = Math.round(n * SAP_PRO_RATIO);
    const crm = n - pro;
    total += (pro * SAP_PRO_MONTHLY + crm * SAP_CRM_MONTHLY) / 30;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return total;
}

interface ExpenseRow {
  id: string;
  company_db: string | null;
  requester_email: string | null;
  created_at: string;
  doc_date: string | null;
  due_date: string | null;
  total_amount: number | null;
  sap_doc_entry: number | null;
  status: string | null;
}

interface ApprovalRow {
  company_db: string;
  decision: string | null;
  decision_date: string | null;
  approver_email: string | null;
  doc_entry: number | null;
}

interface PoCacheRow {
  company_db: string;
  doc_entry: number;
  doc_date: string | null;
  doc_due_date: string | null;
  doc_total: number | null;
}

interface Company {
  company_db: string;
  display_name: string;
}

export function useRoiAnalysis(opts: Options) {
  const { companyDb, from, to, consolidated } = opts;
  const [params, setParams] = useState<RoiParameters[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [pos, setPos] = useState<PoCacheRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fromIso = from?.toISOString();
      const toIso = to?.toISOString();
      const fromDate = fromIso?.slice(0, 10);
      const toDate = toIso?.slice(0, 10);

      // Pagina resultados para contornar o limite padrão do PostgREST (1000 linhas/resposta)
      const PAGE = 1000;
      async function fetchAll<T>(build: () => any): Promise<T[]> {
        const out: T[] = [];
        for (let offset = 0; ; offset += PAGE) {
          const { data, error } = await build().range(offset, offset + PAGE - 1);
          if (error) throw error;
          const rows = (data || []) as T[];
          out.push(...rows);
          if (rows.length < PAGE) break;
          if (offset > 500000) break; // guarda de segurança
        }
        return out;
      }

      const buildExpenses = () => {
        let q = supabase
          .from("expenses")
          .select("id, company_db, requester_email, created_at, doc_date, due_date, total_amount, sap_doc_entry, status")
          .order("created_at", { ascending: true });
        if (!consolidated && companyDb) q = q.eq("company_db", companyDb);
        if (fromIso) q = q.gte("created_at", fromIso);
        if (toIso) q = q.lte("created_at", toIso);
        return q;
      };
      const buildApprovals = () => {
        let q = supabase
          .from("approval_history")
          .select("company_db, decision, decision_date, approver_email, doc_entry")
          .order("decision_date", { ascending: true });
        if (!consolidated && companyDb) q = q.eq("company_db", companyDb);
        if (fromIso) q = q.gte("decision_date", fromIso);
        if (toIso) q = q.lte("decision_date", toIso);
        return q;
      };
      const buildPos = () => {
        let q = supabase
          .from("sap_purchase_order_cache")
          .select("company_db, doc_entry, doc_date, doc_due_date, doc_total")
          .order("doc_date", { ascending: true });
        if (!consolidated && companyDb) q = q.eq("company_db", companyDb);
        if (fromDate) q = q.gte("doc_date", fromDate);
        if (toDate) q = q.lte("doc_date", toDate);
        return q;
      };

      const [pr, cr, expensesAll, approvalsAll, posAll] = await Promise.all([
        supabase.from("roi_parameters").select("*"),
        supabase.from("companies").select("company_db, display_name"),
        fetchAll<ExpenseRow>(buildExpenses),
        fetchAll<ApprovalRow>(buildApprovals),
        fetchAll<PoCacheRow>(buildPos),
      ]);

      if (pr.error) throw pr.error;
      if (cr.error) throw cr.error;

      setParams((pr.data || []) as RoiParameters[]);
      // Remove bases de teste da análise
      setCompanies(((cr.data || []) as Company[]).filter((c) => !isTestCompanyDb(c.company_db)));
      setExpenses(expensesAll.filter((e) => !isTestCompanyDb(e.company_db)));
      setApprovals(approvalsAll.filter((a) => !isTestCompanyDb(a.company_db)));
      setPos(posAll.filter((p) => !isTestCompanyDb(p.company_db)));

    } catch (e: any) {
      console.error("useRoiAnalysis load error", e);
      setError(e?.message || "Falha ao carregar dados de ROI");
    } finally {
      setLoading(false);
    }
  }, [companyDb, from?.getTime(), to?.getTime(), consolidated]);

  useEffect(() => { load(); }, [load]);

  const metricsByCompany = useMemo<RoiCompanyMetrics[]>(() => {
    if (!params.length) return [];
    const periodDays = from && to ? Math.max(1, daysBetween(from, to)) : 30;

    // Custo TOTAL de licenças SAP no período, com base no cronograma real de aquisição
    // (22 → 51 → 62 → 83 → 103), split 60% PRO / 40% CRM.
    const now = new Date();
    const effFrom = from || new Date(now.getTime() - periodDays * 86400000);
    const effTo = to || now;
    const totalSapLicenseCost = sapLicenseCostInPeriod(effFrom, effTo);

    // Agrupa aprovações finais (Y) por company+doc_entry
    const approvedIdx = new Map<string, ApprovalRow>();
    for (const a of approvals) {
      if (a.decision !== "Y" || !a.doc_entry) continue;
      const key = `${a.company_db}::${a.doc_entry}`;
      const prev = approvedIdx.get(key);
      if (!prev || (a.decision_date && prev.decision_date && a.decision_date > prev.decision_date)) {
        approvedIdx.set(key, a);
      }
    }

    // Index de expenses por (company_db, sap_doc_entry) para juntar com cache SAP
    const expenseByPo = new Map<string, ExpenseRow>();
    for (const e of expenses) {
      if (e.company_db && e.sap_doc_entry) {
        expenseByPo.set(`${e.company_db}::${e.sap_doc_entry}`, e);
      }
    }

    // Docs unificados por (company_db, doc_entry): união (cache SAP ∪ expenses)
    type UnifiedDoc = {
      company_db: string;
      doc_entry: number | null;
      due_date: string | null;
      total_amount: number;
      created_at: string | null;
      requester_email: string | null;
      source: "cache" | "expense" | "both";
    };
    const unifiedByCompany = new Map<string, UnifiedDoc[]>();
    const seenKeys = new Set<string>();

    for (const po of pos) {
      if (!po.company_db) continue;
      const key = `${po.company_db}::${po.doc_entry}`;
      const exp = expenseByPo.get(key);
      const arr = unifiedByCompany.get(po.company_db) || [];
      arr.push({
        company_db: po.company_db,
        doc_entry: po.doc_entry,
        due_date: exp?.due_date || po.doc_due_date,
        total_amount: Number(exp?.total_amount || po.doc_total || 0),
        created_at: exp?.created_at || (po.doc_date ? `${po.doc_date}T00:00:00Z` : null),
        requester_email: exp?.requester_email || null,
        source: exp ? "both" : "cache",
      });
      unifiedByCompany.set(po.company_db, arr);
      seenKeys.add(key);
    }
    // Expenses sem PO no cache (ainda contam como documentos do Flow)
    for (const e of expenses) {
      if (!e.company_db) continue;
      const key = e.sap_doc_entry ? `${e.company_db}::${e.sap_doc_entry}` : `exp::${e.id}`;
      if (seenKeys.has(key)) continue;
      const arr = unifiedByCompany.get(e.company_db) || [];
      arr.push({
        company_db: e.company_db,
        doc_entry: e.sap_doc_entry,
        due_date: e.due_date,
        total_amount: Number(e.total_amount || 0),
        created_at: e.created_at,
        requester_email: e.requester_email,
        source: "expense",
      });
      unifiedByCompany.set(e.company_db, arr);
    }
    // Empresas que só têm aprovações
    for (const a of approvals) {
      if (a.company_db && !unifiedByCompany.has(a.company_db)) {
        unifiedByCompany.set(a.company_db, []);
      }
    }

    const companiesToProcess = consolidated
      ? Array.from(unifiedByCompany.keys())
      : companyDb
        ? [companyDb]
        : Array.from(unifiedByCompany.keys());

    // Total de docs analisados (para ratear o custo de licenças SAP entre empresas)
    const totalDocsAllCompanies = companiesToProcess.reduce(
      (s, db) => s + (unifiedByCompany.get(db)?.length || 0),
      0,
    );

    return companiesToProcess.map((db) => {
      const p = pickParams(params, db);
      const docs = unifiedByCompany.get(db) || [];
      const companyApprovals = approvals.filter((a) => a.company_db === db && a.decision === "Y");

      const solicitantes = new Set<string>();
      const aprovadores = new Set<string>();
      let sumAntecedencia = 0;
      let countAntecedencia = 0;
      let sumAtraso = 0;
      let countAtrasados = 0;
      let valorTotal = 0;
      let prejuizo = 0;
      // Segregação por origem
      let nDocsSapOnly = 0;
      let nDocsViaFlow = 0;
      let valorSapOnly = 0;
      let valorViaFlow = 0;
      let atrasoSapOnly = 0;
      let atrasoViaFlow = 0;
      let prejuizoSapOnly = 0;
      let prejuizoViaFlow = 0;

      for (const d of docs) {
        if (d.requester_email) solicitantes.add(d.requester_email.toLowerCase());
        valorTotal += d.total_amount;

        const viaFlow = d.source !== "cache"; // "expense" ou "both" → passou pelo ERP Flow
        if (viaFlow) { nDocsViaFlow++; valorViaFlow += d.total_amount; }
        else { nDocsSapOnly++; valorSapOnly += d.total_amount; }

        // antecedência: created_at → due_date
        if (d.due_date && d.created_at) {
          const created = new Date(d.created_at);
          const due = new Date(d.due_date);
          const dias = daysBetween(created, due);
          if (Number.isFinite(dias)) {
            sumAntecedencia += dias;
            countAntecedencia++;
          }
        }

        // atraso: approvedAt > due_date (via approval_history + doc_entry)
        // Ignora docs "nascidos vencidos" (criação > vencimento): atraso não é do fluxo de aprovação.
        if (d.doc_entry && d.due_date) {
          const approvedRow = approvedIdx.get(`${db}::${d.doc_entry}`);
          if (approvedRow?.decision_date) {
            const due = new Date(d.due_date);
            const createdLate = d.created_at ? new Date(d.created_at) > due : false;
            if (!createdLate) {
              const approved = new Date(approvedRow.decision_date);
              const atraso = daysBetween(due, approved);
              if (atraso > 0) {
                sumAtraso += atraso;
                countAtrasados++;
                const p_val = d.total_amount * (p.multa_percent / 100 + (p.juros_mes_percent / 100) * (atraso / 30));
                prejuizo += p_val;
                if (viaFlow) { atrasoViaFlow++; prejuizoViaFlow += p_val; }
                else { atrasoSapOnly++; prejuizoSapOnly += p_val; }
              }
            }
          }
        }
      }

      for (const a of companyApprovals) {
        if (a.approver_email) aprovadores.add(a.approver_email.toLowerCase());
      }

      const nDocs = docs.length;
      const nApprovals = companyApprovals.length;
      const nAprovadores = aprovadores.size;
      const nSolicitantes = solicitantes.size;

      // Tempo total operacional (min → horas) no período
      const minSap = nDocs * p.tempo_lancar_sap_min + nApprovals * p.tempo_aprovar_sap_min;
      const minFlow = nDocs * p.tempo_lancar_flow_min + nApprovals * p.tempo_aprovar_flow_min;
      const horasSap = minSap / 60;
      const horasFlow = minFlow / 60;

      // Custos de tempo (R$)
      const custoHoraAprov = p.salario_aprovador / p.horas_mes;
      const custoHoraSolic = p.salario_solicitante / p.horas_mes;
      const custoTempoSap =
        (nDocs * p.tempo_lancar_sap_min / 60) * custoHoraSolic +
        (nApprovals * p.tempo_aprovar_sap_min / 60) * custoHoraAprov;
      const custoTempoFlow =
        (nDocs * p.tempo_lancar_flow_min / 60) * custoHoraSolic +
        (nApprovals * p.tempo_aprovar_flow_min / 60) * custoHoraAprov;

      // Licenças SAP: rateio pelo cronograma real (22→103), proporcional aos docs da empresa.
      const docShare = totalDocsAllCompanies > 0 ? nDocs / totalDocsAllCompanies : 0;
      const licencasSap = totalSapLicenseCost * docShare;
      // Licenças Flow: contagem de usuários ativos × custo unitário, pro-rata ao período.
      const proRata = periodDays / 30;
      const licencasFlow = (nAprovadores + nSolicitantes) * p.custo_licenca_flow * proRata;

      const custoTotalSap = custoTempoSap + licencasSap + prejuizo;
      const custoTotalFlow = custoTempoFlow + licencasFlow + prejuizo; // prejuízo já materializado nos dois cenários base
      const economia = custoTotalSap - custoTotalFlow;
      const economiaPercent = custoTotalSap > 0 ? (economia / custoTotalSap) * 100 : 0;

      const company = companies.find((c) => c.company_db === db);

      return {
        company_db: db,
        display_name: company?.display_name || db,
        n_docs: nDocs,
        n_approvals: nApprovals,
        n_aprovadores: nAprovadores,
        n_solicitantes: nSolicitantes,
        n_docs_sap_only: nDocsSapOnly,
        n_docs_via_flow: nDocsViaFlow,
        valor_sap_only: valorSapOnly,
        valor_via_flow: valorViaFlow,
        docs_atrasados_sap_only: atrasoSapOnly,
        docs_atrasados_via_flow: atrasoViaFlow,
        prejuizo_atraso_sap_only: prejuizoSapOnly,
        prejuizo_atraso_via_flow: prejuizoViaFlow,
        antecedencia_media_dias: countAntecedencia > 0 ? sumAntecedencia / countAntecedencia : null,
        atraso_medio_dias: countAtrasados > 0 ? sumAtraso / countAtrasados : null,
        docs_atrasados: countAtrasados,
        valor_total_docs: valorTotal,
        prejuizo_atraso: prejuizo,
        horas_sap: horasSap,
        horas_flow: horasFlow,
        custo_tempo_sap: custoTempoSap,
        custo_tempo_flow: custoTempoFlow,
        custo_licencas_sap_mes: licencasSap,
        custo_licencas_flow_mes: licencasFlow,
        custo_total_sap: custoTotalSap,
        custo_total_flow: custoTotalFlow,
        economia_periodo: economia,
        economia_percent: economiaPercent,
      };
    });
  }, [params, expenses, approvals, pos, companyDb, consolidated, companies, from?.getTime(), to?.getTime()]);

  const totals = useMemo(() => {
    if (!metricsByCompany.length) return null;
    const sum = (k: keyof RoiCompanyMetrics) =>
      metricsByCompany.reduce((s, m) => s + (Number(m[k]) || 0), 0);
    const totalSap = sum("custo_total_sap");
    const totalFlow = sum("custo_total_flow");
    return {
      n_docs: sum("n_docs"),
      n_approvals: sum("n_approvals"),
      horas_sap: sum("horas_sap"),
      horas_flow: sum("horas_flow"),
      custo_tempo_sap: sum("custo_tempo_sap"),
      custo_tempo_flow: sum("custo_tempo_flow"),
      custo_licencas_sap: sum("custo_licencas_sap_mes"),
      custo_licencas_flow: sum("custo_licencas_flow_mes"),
      prejuizo_atraso: sum("prejuizo_atraso"),
      custo_total_sap: totalSap,
      custo_total_flow: totalFlow,
      economia_periodo: totalSap - totalFlow,
      economia_percent: totalSap > 0 ? ((totalSap - totalFlow) / totalSap) * 100 : 0,
    };
  }, [metricsByCompany]);

  const activeParams = useMemo(() => {
    if (!params.length) return null;
    if (companyDb) return pickParams(params, companyDb);
    return params.find((p) => p.company_db === null) || params[0];
  }, [params, companyDb]);

  return { metricsByCompany, totals, params, activeParams, loading, error, refresh: load };
}
