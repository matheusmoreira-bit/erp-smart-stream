// Edge function TEMPORÁRIA: mastertax-probe-emitidas
// Teste controlado — verifica se a API Master Tax devolve notas EMITIDAS
// (empresa como prestadora) variando o parâmetro `tipo`.
// Protegida por header x-probe-key (segredo MASTERTAX_PROBE_KEY).
// Não retorna token nem dados sensíveis — só status, contagem e chaves do payload.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { corsHeaders as baseCors } from "npm:@supabase/supabase-js@2/cors";

const corsHeaders = {
  ...baseCors,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-probe-key",
};

const DEFAULT_BASE_URL = "https://api.mastertax.app";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const expected = Deno.env.get("MASTERTAX_PROBE_KEY") || "";
  if (!expected || req.headers.get("x-probe-key") !== expected) {
    return json({ error: "não autorizado" }, 401);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const companyDb = String(body?.company_db || "").trim();
    const tipos: string[] = Array.isArray(body?.tipos) && body.tipos.length
      ? body.tipos.map((t: unknown) => String(t))
      : ["Tomador", "Prestador", "Emitente", ""];
    const dias = Number(body?.dias || 180);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let q = admin
      .from("system_credentials")
      .select("credential_key, credential_value")
      .eq("system_name", "mastertax");
    q = companyDb ? q.eq("company_db", companyDb) : q.is("company_db", null);
    const { data: rows, error } = await q;
    if (error) throw error;
    if (!rows?.length) return json({ error: "sem credenciais Master Tax para esta base" }, 404);

    const creds: Record<string, string> = {};
    for (const r of rows) creds[r.credential_key] = r.credential_value ?? "";

    const baseUrl = (creds.base_url || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
    const token = (creds.token || "").trim();
    const empresaId = (creds.empresa_id || "").split(/[\s,;]+/).filter(Boolean)[0] || "";
    if (!token || !empresaId) return json({ error: "credenciais incompletas" }, 400);
    const authHeader = token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;

    const today = new Date();
    const start = new Date(today.getTime() - dias * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const out: unknown[] = [];
    for (const tipo of tipos) {
      const params = new URLSearchParams({
        empresa_id: empresaId,
        emissaoDe: fmt(start),
        emissaoAte: fmt(today),
        pagina: "1",
        quantidade: "3",
        ordenar: "dataEmissao",
        sentido: "desc",
        retencoes: "todas",
      });
      if (tipo) params.set("tipo", tipo);

      const started = Date.now();
      let status = 0;
      let payloadKeys: string[] = [];
      let total: number | null = null;
      let sample: Record<string, unknown> | null = null;
      let err: string | null = null;
      try {
        const resp = await fetch(`${baseUrl}/api/notas-servico?${params.toString()}`, {
          headers: { Authorization: authHeader, Accept: "application/json" },
          signal: AbortSignal.timeout(25000),
        });
        status = resp.status;
        const text = await resp.text().catch(() => "");
        // deno-lint-ignore no-explicit-any
        let parsed: any = null;
        try { parsed = JSON.parse(text); } catch { err = text.slice(0, 200); }
        if (parsed && typeof parsed === "object") {
          payloadKeys = Object.keys(parsed);
          for (const c of [parsed?.retorno, parsed?.meta, parsed?.pagination, parsed]) {
            if (c && typeof c === "object" && typeof c.total === "number") { total = c.total; break; }
          }
          const list = parsed?.dados ?? parsed?.notas ?? parsed?.data ?? parsed?.items ??
            (Array.isArray(parsed) ? parsed : parsed?.retorno?.dados);
          if (Array.isArray(list) && list[0] && typeof list[0] === "object") {
            const first = list[0] as Record<string, unknown>;
            sample = {
              campos: Object.keys(first).slice(0, 40),
              prestador: first.prestador ?? first.razaoSocialPrestador ?? first.cnpjPrestador ?? null,
              tomador: first.tomador ?? first.razaoSocialTomador ?? first.cnpjTomador ?? null,
              numero: first.numero ?? first.numeroNfse ?? first.numeroNota ?? null,
              dataEmissao: first.dataEmissao ?? null,
            };
          }
        }
      } catch (e) {
        err = e instanceof Error ? e.message : String(e);
      }
      out.push({ tipo: tipo || "(omitido)", status, total, payloadKeys, sample, error: err, elapsedMs: Date.now() - started });
    }

    return json({ company_db: companyDb || null, base_url: baseUrl, resultados: out });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
