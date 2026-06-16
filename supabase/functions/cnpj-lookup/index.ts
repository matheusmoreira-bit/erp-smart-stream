import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function digits(s: string): string {
  return (s || "").replace(/\D+/g, "");
}

function mapPayload(p: any) {
  const est = p?.estabelecimento ?? {};
  const ie = Array.isArray(est?.inscricoes_estaduais)
    ? est.inscricoes_estaduais.find((x: any) => x?.ativo)?.inscricao_estadual ?? null
    : null;
  const logradouro = [est?.tipo_logradouro, est?.logradouro].filter(Boolean).join(" ").trim();
  const cnaes_sec = Array.isArray(est?.atividades_secundarias)
    ? est.atividades_secundarias.map((c: any) => ({
        codigo: c?.subclasse ?? null,
        descricao: c?.descricao ?? null,
      }))
    : [];
  const socios = Array.isArray(p?.socios)
    ? p.socios.map((s: any) => ({
        nome: s?.nome ?? null,
        qualificacao: s?.qualificacao_socio?.descricao ?? null,
      }))
    : [];
  return {
    tipo_pessoa: "pj",
    cnpj: digits(est?.cnpj ?? ""),
    razao_social: p?.razao_social ?? null,
    nome_fantasia: est?.nome_fantasia ?? null,
    tipo_estabelecimento: est?.tipo ?? null,
    situacao_cadastral: est?.situacao_cadastral ?? null,
    data_inicio_atividade: est?.data_inicio_atividade ?? null,
    natureza_juridica_id: p?.natureza_juridica?.id ? String(p.natureza_juridica.id) : null,
    natureza_juridica_descricao: p?.natureza_juridica?.descricao ?? null,
    porte: p?.porte?.descricao ?? null,
    capital_social: p?.capital_social != null ? Number(p.capital_social) : null,
    cnae_principal_codigo: est?.atividade_principal?.subclasse ?? null,
    cnae_principal_descricao: est?.atividade_principal?.descricao ?? null,
    cnaes_secundarios: cnaes_sec,
    logradouro: logradouro || null,
    numero: est?.numero ?? null,
    complemento: est?.complemento ?? null,
    bairro: est?.bairro ?? null,
    cep: est?.cep ? digits(est.cep) : null,
    municipio: est?.cidade?.nome ?? null,
    municipio_ibge: est?.cidade?.ibge_id ? String(est.cidade.ibge_id) : null,
    uf: est?.estado?.sigla ?? null,
    pais: est?.pais?.nome ?? null,
    telefone1: est?.ddd1 && est?.telefone1 ? `${est.ddd1}${est.telefone1}` : null,
    telefone2: est?.ddd2 && est?.telefone2 ? `${est.ddd2}${est.telefone2}` : null,
    email: est?.email ?? null,
    inscricao_estadual: ie,
    simples_nacional: p?.simples == null ? false : !!p?.simples?.optante,
    socios,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const cnpj = digits(String(body?.cnpj ?? ""));
    if (cnpj.length !== 14) return json({ error: "CNPJ inválido (deve ter 14 dígitos)" }, 400);

    // Duplicate check
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: existing } = await admin
      .from("fornecedores")
      .select("id, razao_social, nome_fantasia, cnpj")
      .eq("cnpj", cnpj)
      .maybeSingle();
    if (existing) {
      return json({ exists: true, fornecedor: existing });
    }

    // Public API
    const apiRes = await fetch(`https://publica.cnpj.ws/cnpj/${cnpj}`, {
      headers: { "Accept": "application/json", "User-Agent": "ERP-Flow/1.0" },
    });
    if (apiRes.status === 429) {
      return json({ error: "Limite de consultas atingido na API pública. Tente novamente em alguns segundos." }, 429);
    }
    if (apiRes.status === 404) {
      return json({ error: "CNPJ não encontrado na base pública." }, 404);
    }
    if (!apiRes.ok) {
      const txt = await apiRes.text().catch(() => "");
      return json({ error: `Falha na consulta (${apiRes.status}): ${txt.slice(0, 200)}` }, 502);
    }
    const payload = await apiRes.json();
    const mapped = mapPayload(payload);
    return json({ exists: false, data: mapped, raw: payload });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
