// Send email via SMTP (Gmail) — generic endpoint used by notification pipes
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { requireSchedulerAdminOrUserSession } from "../_shared/automation-auth.ts";
import { blockIfIntegrationsDisabled } from "../_shared/integrations-mode.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 465;
const SMTP_USER = "system@anagaming.com.br";

// Total cap for attachment payload after base64 (~ Gmail allows ~25MB).
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_SINGLE_ATTACHMENT_BYTES = 15 * 1024 * 1024;

const DEFAULT_ALLOWED_EMAIL_DOMAINS = [
  "anagaming.com.br",
  "cactuscorporation.com",
  "cactusgaming.com.br",
  "cactusproviders.com.br",
  "opengaming.com.br",
];

interface AttachmentInput {
  url?: string;
  filename?: string;
  name?: string;
  contentType?: string;
  content?: string; // base64 if no URL
}

class RequestValidationError extends Error {}

function guessContentType(name: string, fallback?: string): string {
  if (fallback) return fallback;
  const ext = name.toLowerCase().split(".").pop() || "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    heic: "image/heic",
    xml: "application/xml",
    txt: "text/plain",
    csv: "text/csv",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return map[ext] || "application/octet-stream";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Gmail/denomailer quebra o encoded-word RFC 2047 quando o assunto tem acentos
 * e ultrapassa 75 chars: o header vaza para o corpo e o e-mail chega como MIME cru.
 * Mantemos o assunto em ASCII puro (sem acentos) e curto — assim nenhum
 * encoded-word é gerado e o cabeçalho nunca é dobrado incorretamente.
 */
function sanitizeSubject(raw: unknown): string {
  const s = String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2026]/g, "...")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return (s.length > 120 ? `${s.slice(0, 117)}...` : s) || "Notificacao ERP Flow";
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h1|h2|h3)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function uniqueStrings(value: unknown): string[] {
  const arr = Array.isArray(value) ? value : value ? [value] : [];
  return Array.from(new Set(arr.map((v) => String(v || "").trim()).filter(Boolean)));
}

function allowedEmailDomains(): string[] {
  const raw = Deno.env.get("SMTP_ALLOWED_DOMAINS");
  const domains = raw
    ? raw.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean)
    : DEFAULT_ALLOWED_EMAIL_DOMAINS;
  return Array.from(new Set(domains));
}

function assertSafeEmailList(label: string, value: unknown): string[] {
  const domains = allowedEmailDomains();
  const emails = uniqueStrings(value);
  const invalid = emails.filter((email) => {
    if (/[\r\n]/.test(email)) return true;
    const match = email.toLowerCase().match(/^[^@\s<>]+@([^@\s<>]+)$/);
    if (!match) return true;
    const domain = match[1];
    return !domains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
  });
  if (invalid.length > 0) {
    throw new RequestValidationError(`${label} contém destinatário não permitido: ${invalid.join(", ")}`);
  }
  return emails;
}

function sanitizeHeaderEmail(value: unknown): string | undefined {
  const email = String(value || "").trim();
  if (!email) return undefined;
  if (/[\r\n]/.test(email)) throw new RequestValidationError("replyTo inválido");
  return assertSafeEmailList("replyTo", email)[0];
}

function allowedAttachmentHosts(): Set<string> {
  const hosts = new Set<string>();
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  try {
    if (supabaseUrl) hosts.add(new URL(supabaseUrl).hostname.toLowerCase());
  } catch { /* ignore */ }
  for (const raw of (Deno.env.get("SMTP_ATTACHMENT_ALLOWED_HOSTS") || "").split(",")) {
    const h = raw.trim().toLowerCase();
    if (h) hosts.add(h);
  }
  return hosts;
}

function assertSafeAttachmentUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RequestValidationError("URL de anexo inválida");
  }
  const allowedHosts = allowedAttachmentHosts();
  const hostname = url.hostname.toLowerCase();
  if (!allowedHosts.has(hostname)) {
    throw new RequestValidationError(`Host de anexo não permitido: ${hostname}`);
  }
  if (url.protocol !== "https:" && hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new RequestValidationError("URL de anexo deve usar HTTPS");
  }
  if (!url.pathname.includes("/storage/v1/object/")) {
    throw new RequestValidationError("URL de anexo deve apontar para storage Supabase");
  }
  return url;
}

async function downloadAttachment(att: AttachmentInput): Promise<
  { filename: string; contentType: string; encoding: "base64"; content: string } | null
> {
  const rawName = att.filename || att.name || (att.url ? att.url.split("/").pop()?.split("?")[0] : null) || "anexo";
  const filename = rawName.replace(/[\r\n"]/g, "_");
  try {
    if (att.content && !att.url) {
      const size = Math.floor((att.content.length * 3) / 4);
      if (size > MAX_SINGLE_ATTACHMENT_BYTES) return null;
      return {
        filename,
        contentType: guessContentType(filename, att.contentType),
        encoding: "base64",
        content: att.content,
      };
    }
    if (!att.url) return null;
    const url = assertSafeAttachmentUrl(att.url);
    const res = await fetch(url, { redirect: "error" });
    if (!res.ok) {
      console.warn("attachment fetch failed", att.url, res.status);
      return null;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_SINGLE_ATTACHMENT_BYTES) {
      console.warn("attachment too large, skipping", filename, buf.byteLength);
      return null;
    }
    const contentType = guessContentType(filename, att.contentType || res.headers.get("content-type") || undefined);
    return { filename, contentType, encoding: "base64", content: bytesToBase64(buf) };
  } catch (e) {
    console.warn("attachment error", filename, e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const disabled = blockIfIntegrationsDisabled(corsHeaders);
  if (disabled) return disabled;

  const auth = await requireSchedulerAdminOrUserSession(req, corsHeaders);
  if (!auth.ok) return auth.response;

  try {
    const { to, cc, bcc, subject, html, text, attachments, replyTo } = await req.json();
    if (!to || !subject || (!html && !text)) {
      return new Response(JSON.stringify({ error: "to, subject and html/text required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const recipients = assertSafeEmailList("to", to);
    const ccRecipients = cc ? assertSafeEmailList("cc", cc) : [];
    const bccRecipients = bcc ? assertSafeEmailList("bcc", bcc) : [];
    const safeReplyTo = sanitizeHeaderEmail(replyTo);
    if (Array.isArray(attachments)) {
      for (const att of attachments) {
        if (att?.url) assertSafeAttachmentUrl(att.url);
      }
    }

    const password = Deno.env.get("SMTP_PASSWORD");
    if (!password) {
      return new Response(JSON.stringify({ error: "SMTP_PASSWORD not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Download attachments (best-effort, never fail the whole send)
    const resolvedAttachments: Array<{ filename: string; contentType: string; encoding: "base64"; content: string }> = [];
    let totalSize = 0;
    if (Array.isArray(attachments)) {
      for (const att of attachments) {
        const r = await downloadAttachment(att);
        if (!r) continue;
        const size = Math.floor((r.content.length * 3) / 4);
        if (totalSize + size > MAX_TOTAL_ATTACHMENT_BYTES) {
          console.warn("attachment cap reached, dropping", r.filename);
          break;
        }
        totalSize += size;
        resolvedAttachments.push(r);
      }
    }

    const client = new SMTPClient({
      connection: {
        hostname: SMTP_HOST,
        port: SMTP_PORT,
        tls: true,
        auth: { username: SMTP_USER, password },
      },
    });

    const sendOpts: Record<string, unknown> = {
      from: `Sistema Ana Gaming <${SMTP_USER}>`,
      to: recipients,
      subject: sanitizeSubject(subject),
      content: text || (html ? htmlToText(html) : sanitizeSubject(subject)),

      html: html || undefined,
    };
    if (ccRecipients.length > 0) sendOpts.cc = ccRecipients;
    if (bccRecipients.length > 0) sendOpts.bcc = bccRecipients;
    if (safeReplyTo) sendOpts.replyTo = safeReplyTo;
    if (resolvedAttachments.length > 0) sendOpts.attachments = resolvedAttachments;

    await client.send(sendOpts as any);
    await client.close();

    return new Response(
      JSON.stringify({
        ok: true,
        sent: recipients.length,
        attachments: resolvedAttachments.length,
        attachmentsBytes: totalSize,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("send-smtp-email error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: e instanceof RequestValidationError ? 400 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
