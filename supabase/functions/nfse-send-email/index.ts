// Envio da NFS-e por e-mail (remetente configurável por empresa)
// Ações: resolve | send | import-recipients
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { parse as parseXml } from "https://deno.land/x/xml@2.1.3/mod.ts";
import { notifySalesMilestone } from "../_shared/sales-notify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "nfse-pdfs";
const XML_BUCKET = "nfse-xmls";
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;


const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalizeEmails(input: unknown): string[] {
  const raw: string[] = Array.isArray(input)
    ? input.map(String)
    : typeof input === "string"
      ? input.split(/[;,\s]+/)
      : [];
  const out: string[] = [];
  for (const item of raw) {
    const email = item.trim().toLowerCase();
    if (EMAIL_RE.test(email) && !out.includes(email)) out.push(email);
  }
  return out.slice(0, 50);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asArray(value: any): any[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function textOf(node: any): string {
  if (node === undefined || node === null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  return String(node["#text"] ?? "");
}

interface RecipientRule {
  company_db: string;
  project_code: string;
  brand: string | null;
  to_emails: string[];
  cc_emails: string[];
}

/**
 * XML esperado (tags e atributos são aceitos em pt-BR ou en):
 * <destinatarios>
 *   <empresa db="SBO_CACTUS">
 *     <projeto codigo="DONALD BET" marca="Donald">
 *       <para>cliente@x.com</para>
 *       <copia>financeiro@y.com</copia>
 *     </projeto>
 *   </empresa>
 * </destinatarios>
 */
function parseRecipientsXml(xml: string): RecipientRule[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = parseXml(xml) as any;
  const root = doc?.destinatarios ?? doc?.recipients ?? doc?.root ?? doc;
  const rules: RecipientRule[] = [];

  for (const empresa of asArray(root?.empresa ?? root?.company)) {
    const companyDb = String(empresa?.["@db"] ?? empresa?.["@company_db"] ?? empresa?.["@codigo"] ?? "").trim();
    if (!companyDb) continue;
    for (const projeto of asArray(empresa?.projeto ?? empresa?.project)) {
      const projectCode = String(projeto?.["@codigo"] ?? projeto?.["@code"] ?? "").trim();
      const brandRaw = String(projeto?.["@marca"] ?? projeto?.["@brand"] ?? "").trim();
      const to = normalizeEmails(
        asArray(projeto?.para ?? projeto?.to).map(textOf).join(",")
      );
      const cc = normalizeEmails(
        asArray(projeto?.copia ?? projeto?.cc).map(textOf).join(",")
      );
      if (to.length === 0 && cc.length === 0) continue;
      rules.push({
        company_db: companyDb,
        project_code: projectCode,
        brand: brandRaw || null,
        to_emails: to,
        cc_emails: cc,
      });
    }
  }
  return rules;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  try {
    // ── Autenticação: exige JWT de usuário real ─────────────────────────
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "unauthorized" }, 401);
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
    const actorEmail = (userData.user.email || "").toLowerCase();
    const { data: isAdmin } = await admin.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "admin",
    });

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "send");
    const companyDb = String(body?.company_db || "").trim();
    if (!companyDb) return json({ error: "company_db obrigatório" }, 400);

    // ── Importação do XML de destinatários (somente admin) ──────────────
    if (action === "import-recipients") {
      if (!isAdmin) return json({ error: "forbidden" }, 403);
      const xml = String(body?.xml || "");
      if (!xml.trim()) return json({ error: "xml obrigatório" }, 400);
      let rules: RecipientRule[];
      try {
        rules = parseRecipientsXml(xml);
      } catch (e) {
        return json({ error: `XML inválido: ${(e as Error).message}` }, 400);
      }
      if (rules.length === 0) return json({ error: "Nenhum destinatário encontrado no XML" }, 400);
      const { error } = await admin.from("nfse_email_recipients").upsert(
        rules.map((r) => ({ ...r, source: "xml", is_active: true })),
        { onConflict: "company_db,customer_code,project_code" },
      );
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, imported: rules.length, rules });
    }

    // ── Resolve destinatários para uma nota ─────────────────────────────
    // Regra: casamento por (cliente + marca/projeto). Quando a emissão é
    // unificada, usa a UNIÃO dos destinatários de todas as marcas do cliente.
    const projectCode = String(body?.project_code || "").trim();
    const customerCode = String(body?.customer_code || "").trim();
    const splitMode = body?.split_mode === "per_brand" ? "per_brand" : "unified";

    const { data: rules } = await admin
      .from("nfse_email_recipients")
      .select("customer_code, project_code, brand, to_emails, cc_emails")
      .eq("company_db", companyDb)
      .eq("is_active", true);

    const all = rules || [];
    const eq = (a: unknown, b: string) => String(a || "").trim().toLowerCase() === b.toLowerCase();
    const customerRules = customerCode ? all.filter((r) => eq(r.customer_code, customerCode)) : [];

    const exact =
      (projectCode
        ? customerRules.find((r) => eq(r.project_code, projectCode)) ||
          all.find((r) => eq(r.project_code, projectCode) && !r.customer_code)
        : null) || null;

    const union = (rows: typeof all) => ({
      to: normalizeEmails(rows.flatMap((r) => r.to_emails || [])),
      cc: normalizeEmails(rows.flatMap((r) => r.cc_emails || [])),
    });

    const fallback = all.find((r) => !r.project_code && !r.customer_code) || null;

    let matched: { to_emails: string[]; cc_emails: string[] } | null = null;
    let matchedLabel: string | null = null;
    if (splitMode === "per_brand" && exact) {
      matched = { to_emails: exact.to_emails || [], cc_emails: exact.cc_emails || [] };
      matchedLabel = exact.brand || projectCode;
    } else if (splitMode === "unified" && customerRules.length > 0) {
      const u = union(customerRules);
      matched = { to_emails: u.to, cc_emails: u.cc };
      matchedLabel = `${customerCode} (todas as marcas)`;
    } else if (exact) {
      matched = { to_emails: exact.to_emails || [], cc_emails: exact.cc_emails || [] };
      matchedLabel = exact.brand || projectCode;
    } else if (fallback) {
      matched = { to_emails: fallback.to_emails || [], cc_emails: fallback.cc_emails || [] };
      matchedLabel = "(padrão da empresa)";
    }

    const { data: settings } = await admin
      .from("nfse_email_settings")
      .select("*")
      .eq("company_db", companyDb)
      .eq("is_active", true)
      .maybeSingle();

    if (action === "resolve") {
      return json({
        ok: true,
        matched_project: matchedLabel,
        to: matched?.to_emails || [],
        cc: matched?.cc_emails || [],
        sender: settings
          ? { from_name: settings.from_name, from_email: settings.from_email, configured: true }
          : { configured: false },
      });
    }

    if (action !== "send") return json({ error: "ação inválida" }, 400);

    // ── Envio ───────────────────────────────────────────────────────────
    if (!settings) {
      return json({ error: "Remetente de e-mail não configurado para esta empresa." }, 400);
    }
    const password = Deno.env.get(settings.smtp_password_secret);
    if (!password) {
      return json(
        { error: `Senha SMTP não encontrada (segredo "${settings.smtp_password_secret}").` },
        400,
      );
    }

    const to = normalizeEmails(body?.to ?? matched?.to_emails ?? []);
    const cc = normalizeEmails(body?.cc ?? matched?.cc_emails ?? []);
    if (to.length === 0) {
      return json({ error: "Nenhum destinatário definido para esta empresa/projeto." }, 400);
    }

    const nfseNumber = body?.nfse_number ? String(body.nfse_number) : null;
    const invoiceDocEntry = Number.isFinite(Number(body?.invoice_doc_entry))
      ? Number(body.invoice_doc_entry)
      : null;
    const expenseId = typeof body?.expense_id === "string" ? body.expense_id : null;
    const customerName = String(body?.customer_name || "").trim();
    const attachmentPath = String(body?.attachment_path || "").trim();
    const attachmentXmlPath = String(body?.attachment_xml_path || "").trim();


    const subject =
      String(body?.subject || "").trim() ||
      `NFS-e ${nfseNumber ? `nº ${nfseNumber} ` : ""}- ${settings.from_name}`;
    const message =
      String(body?.message || "").trim() ||
      `Segue em anexo a nota fiscal de serviço${nfseNumber ? ` nº ${nfseNumber}` : ""}.`;

    // Anexo (PDF) a partir do bucket privado
    const attachments: Array<{ filename: string; contentType: string; encoding: "base64"; content: string }> = [];
    if (attachmentPath) {
      if (attachmentPath.includes("..")) return json({ error: "caminho de anexo inválido" }, 400);
      const { data: file, error: dlErr } = await admin.storage.from(BUCKET).download(attachmentPath);
      if (dlErr || !file) return json({ error: `Falha ao ler o PDF da nota: ${dlErr?.message}` }, 400);
      const buf = new Uint8Array(await file.arrayBuffer());
      if (buf.byteLength > MAX_ATTACHMENT_BYTES) return json({ error: "PDF acima do limite de 15MB" }, 400);
      attachments.push({
        filename: `NFSe-${nfseNumber || invoiceDocEntry || "documento"}.pdf`,
        contentType: "application/pdf",
        encoding: "base64",
        content: bytesToBase64(buf),
      });
    }
    if (attachmentXmlPath) {
      if (attachmentXmlPath.includes("..")) return json({ error: "caminho de anexo inválido" }, 400);
      const { data: file, error: dlErr } = await admin.storage.from(XML_BUCKET).download(attachmentXmlPath);
      if (dlErr || !file) return json({ error: `Falha ao ler o XML da nota: ${dlErr?.message}` }, 400);
      const buf = new Uint8Array(await file.arrayBuffer());
      if (buf.byteLength > MAX_ATTACHMENT_BYTES) return json({ error: "XML acima do limite de 15MB" }, 400);
      attachments.push({
        filename: `NFSe-${nfseNumber || invoiceDocEntry || "documento"}.xml`,
        contentType: "application/xml",
        encoding: "base64",
        content: bytesToBase64(buf),
      });
    }


    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111">
      <p>Olá${customerName ? ` ${esc(customerName)}` : ""},</p>
      <p>${esc(message).replace(/\n/g, "<br/>")}</p>
      ${nfseNumber ? `<p><strong>NFS-e:</strong> ${esc(nfseNumber)}</p>` : ""}
      <p style="color:#666;font-size:12px;margin-top:24px">${esc(settings.from_name)}</p>
    </div>`;

    let status = "sent";
    let errorMessage: string | null = null;
    try {
      const client = new SMTPClient({
        connection: {
          hostname: settings.smtp_host,
          port: settings.smtp_port,
          tls: settings.smtp_port === 465,
          auth: { username: settings.smtp_user, password },
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const opts: Record<string, any> = {
        from: `${settings.from_name} <${settings.from_email}>`,
        to,
        subject,
        content: message,
        html,
      };
      if (cc.length > 0) opts.cc = cc;
      if (settings.reply_to) opts.replyTo = settings.reply_to;
      if (attachments.length > 0) opts.attachments = attachments;
      await client.send(opts);
      await client.close();
    } catch (e) {
      status = "failed";
      errorMessage = e instanceof Error ? e.message : String(e);
    }

    await admin.from("nfse_email_log").insert({
      company_db: companyDb,
      expense_id: expenseId,
      invoice_doc_entry: invoiceDocEntry,
      nfse_number: nfseNumber,
      project_code: projectCode || null,
      to_emails: to,
      cc_emails: cc,
      subject,
      attachment_path: attachmentPath || null,
      status,
      error_message: errorMessage,
      sent_by: actorEmail,
    });

    if (status === "failed") return json({ error: errorMessage }, 502);

    await notifySalesMilestone(admin, {
      milestone: "nfse_emailed",
      companyDb: companyDb,
      refId: `${companyDb}:${invoiceDocEntry ?? nfseNumber ?? expenseId ?? ""}`,
      link: "/vendas/nfse",
      summary: "A NFS-e foi enviada por e-mail ao cliente.",
      details: [
        { label: "Cliente", value: customerName },
        { label: "NFS-e", value: nfseNumber },
        { label: "Destinatários", value: to.join(", ") },
        { label: "Empresa", value: companyDb },
      ],
    });

    return json({ ok: true, to, cc, attachments: attachments.length });
  } catch (e) {
    console.error("nfse-send-email error:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
