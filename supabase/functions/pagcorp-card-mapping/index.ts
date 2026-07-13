// Edge function para CRUD do mapeamento de cartões PagCorp.
// Usa service_role para contornar a RLS quando o usuário está apenas
// autenticado pela sessão SAP (sem JWT do Lovable Cloud). Valida a
// requisição exigindo um JWT válido OU os headers de sessão SAP.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { requireUserOrSapSessionHeaders, authErrorResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface SaveRow {
  id?: string;
  company_db: string;
  card_identifier?: string | null;
  card_label?: string | null;
  cost_center?: string | null;
  project?: string | null;
  item_code?: string | null;
  is_fallback?: boolean;
}

function serializeError(e: unknown) {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Método não permitido" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    await requireUserOrSapSession(req);
  } catch (err) {
    const authResp = authErrorResponse(err, corsHeaders);
    if (authResp) return authResp;
    return new Response(JSON.stringify({ error: "Não autenticado" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "JSON inválido" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const action: "save" | "delete" | "catalog" | "list" | "list-mappings" = body?.action;
  if (action !== "save" && action !== "delete" && action !== "catalog" && action !== "list" && action !== "list-mappings") {
    return new Response(JSON.stringify({ error: "Ação inválida" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }


  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    if (action === "list") {
      const companyDb = String(body?.company_db || req.headers.get("x-company-db") || "").trim();
      if (!companyDb) {
        return new Response(JSON.stringify({ error: "company_db obrigatório" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await sb
        .from("pagcorp_cards")
        .select("card_identifier,card_label,card_name,card_last_digits,account_alias,last_seen_at")
        .eq("company_db", companyDb)
        .order("last_seen_at", { ascending: false });
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, cards: data || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "list-mappings") {
      const companyDb = String(body?.company_db || req.headers.get("x-company-db") || "").trim();
      if (!companyDb) {
        return new Response(JSON.stringify({ error: "company_db obrigatório" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await sb
        .from("pagcorp_card_mapping")
        .select("*")
        .eq("company_db", companyDb)
        .order("is_fallback", { ascending: false });
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, mappings: data || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "delete") {
      const id = body?.id;
      if (typeof id !== "string" || !id) {
        return new Response(JSON.stringify({ error: "id obrigatório" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { error } = await sb.from("pagcorp_card_mapping").delete().eq("id", id);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "catalog") {
      const cards: any[] = Array.isArray(body?.cards) ? body.cards : [];
      const cleaned = cards
        .filter((c) => c?.company_db && c?.card_identifier)
        .map((c) => ({
          company_db: String(c.company_db),
          card_identifier: String(c.card_identifier),
          card_name: c.card_name ?? null,
          card_last_digits: c.card_last_digits ?? null,
          card_label: c.card_label ?? null,
          account_alias: c.account_alias ?? null,
          last_seen_at: c.last_seen_at ?? new Date().toISOString(),
        }));
      if (cleaned.length === 0) {
        return new Response(JSON.stringify({ success: true, upserted: 0 }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { error } = await sb
        .from("pagcorp_cards")
        .upsert(cleaned, { onConflict: "company_db,card_identifier" });
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, upserted: cleaned.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    // save (insert ou update)
    const rows: SaveRow[] = Array.isArray(body?.rows) ? body.rows : [];
    if (rows.length === 0) {
      return new Response(JSON.stringify({ error: "rows vazio" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: any[] = [];
    for (const r of rows) {
      if (!r.company_db) continue;
      if (!r.is_fallback && !r.card_identifier) continue;

      const payload = {
        company_db: r.company_db,
        card_identifier: r.is_fallback ? null : r.card_identifier,
        card_label: r.card_label ?? null,
        cost_center: r.cost_center ?? null,
        project: r.project ?? null,
        item_code: r.item_code ?? null,
        is_fallback: !!r.is_fallback,
      };

      if (r.id) {
        const { data, error } = await sb
          .from("pagcorp_card_mapping").update(payload).eq("id", r.id).select().single();
        if (error) throw error;
        results.push(data);
      } else if (payload.is_fallback) {
        // O banco usa índice único parcial (company_db WHERE is_fallback = true),
        // que não é compatível com PostgREST upsert/onConflict. Fazemos merge manual.
        const { data: existing, error: existingErr } = await sb
          .from("pagcorp_card_mapping")
          .select("id")
          .eq("company_db", payload.company_db)
          .eq("is_fallback", true)
          .maybeSingle();
        if (existingErr) throw existingErr;

        if (existing?.id) {
          const { data, error } = await sb
            .from("pagcorp_card_mapping")
            .update(payload)
            .eq("id", existing.id)
            .select()
            .single();
          if (error) throw error;
          results.push(data);
        } else {
          const { data, error } = await sb
            .from("pagcorp_card_mapping")
            .insert(payload)
            .select()
            .single();
          if (error) throw error;
          results.push(data);
        }
      } else {
        // O índice único de cartão também é parcial (WHERE is_fallback = false),
        // então evitamos upsert/onConflict e fazemos merge manual.
        const { data: existing, error: existingErr } = await sb
          .from("pagcorp_card_mapping")
          .select("id")
          .eq("company_db", payload.company_db)
          .eq("card_identifier", payload.card_identifier)
          .eq("is_fallback", false)
          .maybeSingle();
        if (existingErr) throw existingErr;

        if (existing?.id) {
          const { data, error } = await sb
            .from("pagcorp_card_mapping")
            .update(payload)
            .eq("id", existing.id)
            .select()
            .single();
          if (error) throw error;
          results.push(data);
        } else {
          const { data, error } = await sb
            .from("pagcorp_card_mapping")
            .insert(payload)
            .select()
            .single();
          if (error) throw error;
          results.push(data);
        }
      }
    }

    return new Response(JSON.stringify({ success: true, rows: results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("pagcorp-card-mapping error:", e);
    return new Response(JSON.stringify({ error: serializeError(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
