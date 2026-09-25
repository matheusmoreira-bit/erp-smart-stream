import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { callerHasMfa, isCorporateEmail } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller is admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await anonClient.auth.getUser();
    if (!caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check admin role
    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: roleData } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData || !callerHasMfa(req)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const method = req.method;

    // LIST users
    if (method === "GET") {
      const users = await listAllAuthUsers(adminClient);

      // Get admin roles
      const { data: roles } = await adminClient
        .from("user_roles")
        .select("user_id, role");

      const enriched = (users || []).map((u) => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        email_confirmed_at: u.email_confirmed_at,
        role: (roles || []).find((r) => r.user_id === u.id)?.role || "user",
      }));

      return new Response(JSON.stringify(enriched), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // CREATE (invite) user
    if (method === "POST") {
      const body = await req.json();
      const { email: rawEmail, assignAdmin = true } = body ?? {};
      const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        return new Response(JSON.stringify({ error: "Email inválido" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!isCorporateEmail(email)) {
        return new Response(JSON.stringify({ error: "Domínio de e-mail não autorizado" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Usuário comum: cria a conta já confirmada para entrar com Google
      // (cadastro público fechado). Sem papel de admin, sem e-mail de convite.
      if (assignAdmin === false) {
        const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
          email,
          email_confirm: true,
        });
        if (createErr || !created?.user) {
          return new Response(JSON.stringify({ error: createErr?.message || "Falha ao criar usuário" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        await adminClient.from("audit_log").insert({
          action: "admin_user_created",
          actor_email: caller.email,
          details: { target_email: email, target_user_id: created.user.id, admin: false },
        }).then(() => undefined, () => undefined);
        return new Response(JSON.stringify({ success: true, user: { id: created.user.id, email } }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: inviteData, error: inviteError } =
        await adminClient.auth.admin.inviteUserByEmail(email, {
          redirectTo: `${url.origin.replace('supabase.co/functions/v1', 'supabase.co').replace('/functions/v1/admin-users', '')}/admin/login`,
        });

      if (inviteError) {
        return new Response(JSON.stringify({ error: inviteError.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Optionally assign admin role
      if (inviteData.user && assignAdmin) {
        await adminClient.from("user_roles").upsert(
          { user_id: inviteData.user.id, role: "admin" },
          { onConflict: "user_id,role" }
        );
      }

      return new Response(JSON.stringify({ success: true, user: inviteData.user }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // UPDATE email
    if (method === "PATCH") {
      const body = await req.json().catch(() => null);
      let userId = typeof body?.userId === "string" ? body.userId : "";
      const currentEmail = typeof body?.currentEmail === "string" ? body.currentEmail.trim().toLowerCase() : "";
      if (!userId && currentEmail) {
        const all = await listAllAuthUsers(adminClient);
        const found = all.find((u) => (u.email || "").toLowerCase() === currentEmail);
        if (!found) {
          return new Response(JSON.stringify({ error: `Nenhuma conta de login encontrada para ${currentEmail}` }), {
            status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        userId = found.id;
      }
      const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!/^[0-9a-f-]{36}$/i.test(userId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        return new Response(JSON.stringify({ error: "Dados inválidos" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!isCorporateEmail(email)) {
        return new Response(JSON.stringify({ error: "Domínio de e-mail não autorizado" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: before } = await adminClient.auth.admin.getUserById(userId);
      const { error: updErr } = await adminClient.auth.admin.updateUserById(userId, {
        email, email_confirm: true,
      });
      if (updErr) {
        return new Response(JSON.stringify({ error: updErr.message }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await adminClient.from("audit_log").insert({
        action: "admin_user_email_changed",
        actor_email: caller.email,
        details: { target_user_id: userId, old_email: before?.user?.email ?? null, new_email: email },
      }).then(() => undefined, () => undefined);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // DELETE user
    if (method === "DELETE") {
      const { userId } = await req.json();
      if (!userId) {
        return new Response(JSON.stringify({ error: "userId required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Prevent self-delete
      if (userId === caller.id) {
        return new Response(
          JSON.stringify({ error: "Não é possível excluir a si mesmo" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Remove role first
      await adminClient.from("user_roles").delete().eq("user_id", userId);

      const { error } = await adminClient.auth.admin.deleteUser(userId);
      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// deno-lint-ignore no-explicit-any
async function listAllAuthUsers(client: any): Promise<Array<{ id: string; email?: string; created_at: string; last_sign_in_at?: string | null; email_confirmed_at?: string | null }>> {
  const out: Array<{ id: string; email?: string; created_at: string; last_sign_in_at?: string | null; email_confirmed_at?: string | null }> = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const batch = data?.users || [];
    out.push(...batch);
    if (batch.length < 1000) break;
  }
  return out;
}
