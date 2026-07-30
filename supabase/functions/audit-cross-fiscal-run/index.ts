// Edge function: audit-cross-fiscal-run
// Motor de cruzamento MasterTax × ERP (agnóstico de ERP).
// Recebe { empresa_id, periodo_inicio, periodo_fim } e:
// 1) descobre o ERP da empresa em public.companies.erp_type
// 2) pega o adapter correspondente e chama getContasPagas
// 3) lê as notas MasterTax do período (nf_entrada_imports)
// 4) cruza por CNPJ + valor (tolerância) + data (janela)
// 5) grava resultados em auditoria_cruzamento_fiscal (idempotente)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getAdapter } from "../_shared/erp-adapters/index.ts";
import type { ContaPagaERP } from "../_shared/erp-adapters/types.ts";
import {
  DEFAULT_TOLERANCE, cnpjEquals, dataDentroJanela, matchScore,
  normalizeCnpj, valorDentroTolerancia, type MatchTolerance,
} from "../_shared/fiscal-match.ts";

interface RunBody {
  empresa_id: string;
  periodo_inicio: string; // YYYY-MM-DD
  periodo_fim: string;    // YYYY-MM-DD
}

interface NotaRow {
  id: string;
  cnpj_fornecedor: string | null;
  nome_fornecedor: string | null;
  numero_nf: string | null;
  chave_acesso: string | null;
  valor_total: number | null;
  data_emissao: string | null;
  lancamento_status: string | null;
  lancamento_id: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = (await req.json()) as RunBody;
    if (!body?.empresa_id || !body?.periodo_inicio || !body?.periodo_fim) {
      return new Response(JSON.stringify({ error: "empresa_id, periodo_inicio, periodo_fim são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 1) empresa + ERP
    const { data: emp, error: empErr } = await supabase
      .from("companies")
      .select("id, company_db, erp_type, tax_id, display_name")
      .eq("id", body.empresa_id)
      .maybeSingle();
    if (empErr || !emp) throw new Error("Empresa não encontrada");

    const adapter = getAdapter(emp.erp_type);
    if (!adapter) {
      return new Response(JSON.stringify({ error: `ERP '${emp.erp_type}' sem adapter registrado` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2) tolerâncias (config por empresa ou default)
    const { data: cfg } = await supabase
      .from("auditoria_cruzamento_config")
      .select("*")
      .eq("empresa_id", body.empresa_id)
      .maybeSingle();
    const tol: MatchTolerance = {
      toleranciaValorAbs: Number(cfg?.tolerancia_valor_abs ?? DEFAULT_TOLERANCE.toleranciaValorAbs),
      toleranciaValorPct: Number(cfg?.tolerancia_valor_pct ?? DEFAULT_TOLERANCE.toleranciaValorPct),
      janelaDias: Number(cfg?.janela_dias ?? DEFAULT_TOLERANCE.janelaDias),
      usarRaizCnpjFallback: Boolean(cfg?.usar_raiz_cnpj_fallback ?? DEFAULT_TOLERANCE.usarRaizCnpjFallback),
    };

    // 2b) conciliação automática (3 pernas: NF × pagamento × lançamento no ERP)
    const autoConciliar = cfg?.auto_conciliar ?? true;
    const autoScoreMin = Number(cfg?.auto_score_min ?? 0.9);
    const autoExigirLancamento = Boolean(cfg?.auto_exigir_lancamento_erp ?? false);
    const LANC_OK = new Set(["completed", "awaiting_invoice", "nf_entrada", "pagamento", "finalizado"]);

    // Bases-fonte para leitura de notas MasterTax:
    // sempre inclui a própria company_db + as configuradas em source_company_dbs.
    const cfgSources: string[] = Array.isArray(cfg?.source_company_dbs) ? cfg!.source_company_dbs : [];
    const sourceCompanyDbs = Array.from(
      new Set<string>([emp.company_db, ...cfgSources].filter(Boolean) as string[]),
    );

    // 3) notas MasterTax do período (tolerando janela para casar com baixas fora do mês)
    const janelaMs = tol.janelaDias * 24 * 60 * 60 * 1000;
    const notaInicio = new Date(new Date(body.periodo_inicio).getTime() - janelaMs).toISOString().slice(0, 10);
    const notaFim = body.periodo_fim;
    const { data: notasRaw, error: notasErr } = await supabase
      .from("nf_entrada_imports")
      .select("id, cnpj_fornecedor, nome_fornecedor, numero_nf, chave_acesso, valor_total, data_emissao, sap_company_db, status, sap_invoice_draft_id, expense_id")
      .gte("data_emissao", notaInicio)
      .lte("data_emissao", notaFim)
      .in("sap_company_db", sourceCompanyDbs);
    if (notasErr) throw notasErr;
    const notas: NotaRow[] = (notasRaw || []).map((n: any) => ({
      id: n.id,
      cnpj_fornecedor: n.cnpj_fornecedor,
      nome_fornecedor: n.nome_fornecedor,
      numero_nf: n.numero_nf,
      chave_acesso: n.chave_acesso,
      valor_total: n.valor_total,
      data_emissao: n.data_emissao,
      lancamento_status: n.status ?? null,
      lancamento_id: n.sap_invoice_draft_id ?? n.expense_id ?? null,
    }));

    // 4) contas pagas via adapter
    const contas: ContaPagaERP[] = await adapter.getContasPagas({
      supabase,
      empresa_id: emp.id,
      company_db: emp.company_db,
      periodo_inicio: body.periodo_inicio,
      periodo_fim: body.periodo_fim,
    });

    // 5) cruzamento
    const contasConsumidas = new Set<string>();
    const rowsToUpsert: any[] = [];

    for (const nota of notas) {
      const cnpjN = normalizeCnpj(nota.cnpj_fornecedor || "");
      const valorN = Number(nota.valor_total || 0);
      const dataN = nota.data_emissao || body.periodo_inicio;
      if (!cnpjN || !valorN || !dataN) continue;

      const candidatos = contas
        .filter((c) => !contasConsumidas.has(c.id_externo))
        .filter((c) => cnpjEquals(cnpjN, c.cnpj_fornecedor, tol.usarRaizCnpjFallback))
        .map((c) => {
          const v = valorDentroTolerancia(valorN, c.valor_pago, tol);
          const d = dataDentroJanela(dataN, c.data_baixa, tol);
          return { c, v, d, score: matchScore(v.diff, d.diff, tol) };
        })
        .filter((x) => x.v.ok && x.d.ok)
        .sort((a, b) => b.score - a.score);

      const base = {
        empresa_id: emp.id,
        company_db: emp.company_db,
        cnpj_fornecedor: cnpjN,
        razao_social_fornecedor: nota.nome_fornecedor,
        nota_mastertax_id: nota.id,
        nota_chave_acesso: nota.chave_acesso,
        nota_numero: nota.numero_nf,
        nota_valor: valorN,
        nota_data_emissao: dataN,
        periodo_inicio: body.periodo_inicio,
        periodo_fim: body.periodo_fim,
        lancamento_erp_status: nota.lancamento_status,
        lancamento_erp_id: nota.lancamento_id,
      };
      const lancamentoOk = !!nota.lancamento_status && LANC_OK.has(String(nota.lancamento_status));

      if (candidatos.length === 0) {
        rowsToUpsert.push({ ...base, cenario: "nota_sem_pagamento", status_match: "automatico", erp_origem: null });
      } else if (candidatos.length === 1) {
        const m = candidatos[0];
        contasConsumidas.add(m.c.id_externo);
        const auto = Boolean(autoConciliar) && m.score >= autoScoreMin && (!autoExigirLancamento || lancamentoOk);
        rowsToUpsert.push({
          ...base,
          cenario: "conciliado",
          status_match: "automatico",
          auto_conciliado: auto,
          auto_conciliado_em: auto ? new Date().toISOString() : null,
          auto_regra: auto
            ? `score>=${autoScoreMin} · candidato único${autoExigirLancamento ? " · lançamento ERP confirmado" : ""}`
            : null,
          erp_origem: m.c.erp_origem,
          conta_paga_id_externo: m.c.id_externo,
          conta_paga_valor: m.c.valor_pago,
          conta_paga_data_baixa: m.c.data_baixa,
          conta_paga_forma_pagamento: m.c.forma_pagamento ?? null,
          conta_paga_link_origem: m.c.link_origem ?? null,
          diferenca_valor: m.v.diff,
          diferenca_dias: m.d.diff,
          score_confianca: m.score,
        });
      } else {
        const m = candidatos[0];
        contasConsumidas.add(m.c.id_externo);
        rowsToUpsert.push({
          ...base,
          cenario: "conciliado",
          status_match: "ambiguo",
          erp_origem: m.c.erp_origem,
          conta_paga_id_externo: m.c.id_externo,
          conta_paga_valor: m.c.valor_pago,
          conta_paga_data_baixa: m.c.data_baixa,
          conta_paga_forma_pagamento: m.c.forma_pagamento ?? null,
          conta_paga_link_origem: m.c.link_origem ?? null,
          diferenca_valor: m.v.diff,
          diferenca_dias: m.d.diff,
          score_confianca: m.score,
          candidatos_ambiguos: candidatos.slice(0, 5).map((x) => ({
            id_externo: x.c.id_externo,
            valor: x.c.valor_pago,
            data_baixa: x.c.data_baixa,
            score: x.score,
          })),
        });
      }
    }

    // contas não consumidas => pago sem nota
    for (const c of contas) {
      if (contasConsumidas.has(c.id_externo)) continue;
      rowsToUpsert.push({
        empresa_id: emp.id,
        company_db: emp.company_db,
        cenario: "pago_sem_nota",
        status_match: "automatico",
        erp_origem: c.erp_origem,
        cnpj_fornecedor: c.cnpj_fornecedor,
        razao_social_fornecedor: c.razao_social_fornecedor,
        conta_paga_id_externo: c.id_externo,
        conta_paga_valor: c.valor_pago,
        conta_paga_data_baixa: c.data_baixa,
        conta_paga_forma_pagamento: c.forma_pagamento ?? null,
        conta_paga_link_origem: c.link_origem ?? null,
        periodo_inicio: body.periodo_inicio,
        periodo_fim: body.periodo_fim,
      });
    }

    // 6) persist — apaga resultados automáticos anteriores do período e insere os novos.
    // Preserva casos com revisão manual (confirmado_manual/ignorado).
    await supabase
      .from("auditoria_cruzamento_fiscal")
      .delete()
      .eq("empresa_id", emp.id)
      .eq("periodo_inicio", body.periodo_inicio)
      .eq("periodo_fim", body.periodo_fim)
      .in("status_match", ["automatico", "ambiguo"]);

    // Insere em lotes de 500
    let inseridos = 0;
    for (let i = 0; i < rowsToUpsert.length; i += 500) {
      const chunk = rowsToUpsert.slice(i, i + 500);
      const { error: insErr } = await supabase
        .from("auditoria_cruzamento_fiscal")
        .insert(chunk);
      if (insErr) throw insErr;
      inseridos += chunk.length;
    }

    return new Response(JSON.stringify({
      ok: true,
      empresa_id: emp.id,
      erp_origem: adapter.erp_origem,
      notas_analisadas: notas.length,
      contas_analisadas: contas.length,
      linhas_geradas: inseridos,
      auto_conciliados: rowsToUpsert.filter((r) => r.auto_conciliado).length,
      excecoes: rowsToUpsert.filter((r) => !r.auto_conciliado).length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("[audit-cross-fiscal-run]", e);
    return new Response(JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
