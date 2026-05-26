import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireUser, authErrorResponse, AuthError } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, company_db, endpoint, params } = body;

    // OMIE proxy handles its own auth via app_key/app_secret from system_credentials.
    // No Supabase user auth required — credentials are validated per-company below.

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    if (!action || typeof action !== "string") {
      return new Response(
        JSON.stringify({ error: "action é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!company_db || typeof company_db !== "string" || company_db.length > 100) {
      return new Response(
        JSON.stringify({ error: "company_db é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch OMIE credentials from system_credentials
    const { data: creds, error: credErr } = await supabase
      .from("system_credentials")
      .select("credential_key, credential_value")
      .eq("system_name", "omie")
      .eq("company_db", company_db);

    if (credErr || !creds || creds.length === 0) {
      return new Response(
        JSON.stringify({ error: "Credenciais OMIE não configuradas para esta empresa" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const credMap: Record<string, string> = {};
    creds.forEach((c) => { credMap[c.credential_key] = c.credential_value; });

    const appKey = credMap["app_key"];
    const appSecret = credMap["app_secret"];

    if (!appKey || !appSecret) {
      return new Response(
        JSON.stringify({ error: "app_key e app_secret são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "login") {
      const omieRes = await fetch("https://app.omie.com.br/api/v1/geral/empresas/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          call: "ListarEmpresas",
          app_key: appKey,
          app_secret: appSecret,
          param: [{ pagina: 1, registros_por_pagina: 1 }],
        }),
      });

      if (!omieRes.ok) {
        const errText = await omieRes.text();
        console.error("OMIE login error:", errText);
        return new Response(
          JSON.stringify({ error: "Falha ao autenticar com OMIE. Verifique as credenciais." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const omieData = await omieRes.json();

      if (omieData.faultstring) {
        return new Response(
          JSON.stringify({ error: omieData.faultstring }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, empresas: omieData.empresas_cadastro || [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "call") {
      if (!endpoint || typeof endpoint !== "string" || endpoint.length > 500) {
        return new Response(
          JSON.stringify({ error: "endpoint é obrigatório e deve ser válido" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate endpoint is a safe relative path
      if (endpoint.includes("..") || endpoint.startsWith("/") || endpoint.startsWith("http")) {
        return new Response(
          JSON.stringify({ error: "endpoint inválido" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const omieRes = await fetch(`https://app.omie.com.br/api/v1/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...params,
          app_key: appKey,
          app_secret: appSecret,
        }),
      });

      const data = await omieRes.json();

      if (data.faultstring) {
        return new Response(
          JSON.stringify({ error: data.faultstring }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ data }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: `Ação desconhecida: ${action}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") {
      return new Response(
        JSON.stringify({ error: "Não autenticado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    console.error("omie-proxy error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
