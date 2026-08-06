// Envia por e-mail as credenciais provisórias de um usuário recém-criado.
// Governança: respeita a configuração de canais (evento `user_credentials`).
// Se o canal de e-mail estiver desativado (global ou por empresa), nada é enviado.
// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { requireAdminOrSapAdmin, authErrorResponse } from "../_shared/auth.ts";
import { getChannelSettings } from "../_shared/notification-channels.ts";
import { rejectForeignOrigin } from "../_shared/cors-allowlist.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-company-db",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EVENT_KEY = "user_credentials";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function appUrl(): string {
  return (Deno.env.get("APP_PUBLIC_URL") || "https://erp-flow.cactuscorporation.com").replace(/\/+$/, "");
}

function buildHtml(opts: {
  userName: string;
  userCode: string;
  password: string;
  companies: string[];
}) {
  const url = appUrl();
  const rows: [string, string][] = [
    ["Usuário", opts.userCode],
    ["Senha provisória", opts.password],
  ];
  if (opts.companies.length) rows.push(["Empresas", opts.companies.join(", ")]);

  const tableRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:8px 16px 8px 0;color:#64748b;font-size:13px">${esc(label)}</td>` +
        `<td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:600;font-family:monospace">${esc(value)}</td></tr>`,
    )
    .join("");

  return `<div style="font-family:Arial,Helvetica,sans-serif;background:#ffffff;padding:24px;color:#0f172a">
    <h2 style="margin:0 0 8px;font-size:18px">Seu acesso ao ERP Flow foi criado</h2>
    <p style="margin:0 0 16px;font-size:14px;color:#334155">
      Olá ${esc(opts.userName || opts.userCode)}, seu usuário já está disponível. Use as credenciais provisórias abaixo para o primeiro acesso.
    </p>
    <table style="border-collapse:collapse;margin-bottom:16px;background:#f8fafc;border-radius:8px;padding:8px">${tableRows}</table>
    <p style="font-size:13px;margin:0 0 16px">
      <a href="${esc(url)}" style="background:#0ea5e9;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block;font-weight:600">Acessar o ERP Flow</a>
    </p>
    <p style="font-size:13px;color:#334155;margin:0 0 8px">
      Por segurança, altere a senha no primeiro acesso e não compartilhe estas credenciais com ninguém.
    </p>
    <p style="margin-top:24px;font-size:12px;color:#94a3b8">Mensagem automática do ERP Flow.</p>
  </div>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const foreign = rejectForeignOrigin(req);
  if (foreign) return foreign;

  try {
    await requireAdminOrSapAdmin(req);

    const body = await req.json().catch(() => ({}));
    const email = String(body?.email ?? "").trim().toLowerCase();
    const userCode = String(body?.userCode ?? "").trim();
    const userName = String(body?.userName ?? "").trim();
    const password = String(body?.password ?? "");
    const companyDb = body?.companyDb ? String(body.companyDb).trim() : null;
    const companies: string[] = Array.isArray(body?.companies)
      ? body.companies.map((c: unknown) => String(c ?? "").trim()).filter(Boolean).slice(0, 30)
      : [];

    if (!isEmail(email)) return json({ sent: false, reason: "invalid_email" }, 400);
    if (!userCode || !password) return json({ sent: false, reason: "missing_fields" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const channels = await getChannelSettings(admin, companyDb, EVENT_KEY);
    if (!channels.email) {
      return json({ sent: false, reason: "disabled_by_settings" });
    }

    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const res = await fetch(`${url}/functions/v1/send-smtp-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key! },
      body: JSON.stringify({
        to: [email],
        subject: "[ERP Flow] Seu acesso foi criado",
        html: buildHtml({ userName, userCode, password, companies }),
      }),
    });

    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      console.error(`[user-credentials-email] envio falhou [${res.status}]: ${detail}`);
      return json({ sent: false, reason: "send_failed", status: res.status, details: detail }, 502);
    }

    // Trilha de auditoria (sem gravar a senha).
    await admin.from("audit_log").insert({
      action: "user_credentials_email_sent",
      entity_type: "sap_user",
      entity_id: userCode,
      company_db: companyDb,
      details: { email, companies },
    }).then(
      () => undefined,
      (e: unknown) => console.warn("[user-credentials-email] audit log falhou:", e instanceof Error ? e.message : String(e)),
    );

    return json({ sent: true });
  } catch (err) {
    const authRes = authErrorResponse(err, corsHeaders);
    if (authRes) return authRes;
    console.error("[user-credentials-email] erro:", err instanceof Error ? err.message : String(err));
    return json({ sent: false, reason: "unexpected_error" }, 500);
  }
});
