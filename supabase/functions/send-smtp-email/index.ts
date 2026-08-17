// Send email via SMTP (Gmail) — generic endpoint used by notification pipes
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import {
  authErrorResponse,
  requireServiceRoleOrUserOrSapSession,
} from "../_shared/auth.ts";
import { corsFor, rejectForeignOrigin } from "../_shared/cors-allowlist.ts";

const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 465;
const SMTP_USER = "system@anagaming.com.br";

// Total cap for attachment payload after base64 (~ Gmail allows ~25MB).
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_SINGLE_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_RECIPIENTS = 20;
const USER_RATE_LIMIT_PER_MINUTE = 20;
const DEFAULT_USER_RECIPIENT_DOMAINS = [
  "cactuscorporation.com",
  "anagaming.com.br",
  "cactusgaming.net",
  "institutoconectacactus.org.br",
  "opengaming.com.br",
  "banana.games",
  "lotusblanca.net",
];
const rateWindows = new Map<string, { startedAt: number; count: number }>();

interface AttachmentInput {
  url?: string;
  filename?: string;
  name?: string;
  contentType?: string;
  content?: string; // base64 if no URL
}

function csvEnv(name: string): string[] {
  return (Deno.env.get(name) || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeRecipients(value: unknown): string[] {
  const input = Array.isArray(value) ? value : value ? [value] : [];
  const unique = new Set<string>();
  for (const item of input) {
    const email = String(item || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error(`Destinatário inválido: ${email || "vazio"}`);
    }
    unique.add(email);
  }
  return Array.from(unique);
}

function assertUserRecipientDomains(recipients: string[]) {
  const allowed = new Set([
    ...DEFAULT_USER_RECIPIENT_DOMAINS,
    ...csvEnv("SMTP_USER_ALLOWED_RECIPIENT_DOMAINS"),
  ]);
  const denied = recipients.find((email) => !allowed.has(email.split("@")[1] || ""));
  if (denied) throw new Error(`Domínio de destinatário não permitido: ${denied}`);
}

function enforceUserRateLimit(identity: string) {
  const now = Date.now();
  const current = rateWindows.get(identity);
  if (!current || now - current.startedAt >= 60_000) {
    rateWindows.set(identity, { startedAt: now, count: 1 });
    return;
  }
  current.count += 1;
  if (current.count > USER_RATE_LIMIT_PER_MINUTE) {
    throw new Error("Limite de envios por minuto excedido");
  }
  if (rateWindows.size > 1_000) rateWindows.clear();
}

function isAllowedAttachmentUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    const allowedOrigins = new Set(csvEnv("SMTP_ATTACHMENT_ALLOWED_ORIGINS"));
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (supabaseUrl) allowedOrigins.add(new URL(supabaseUrl).origin.toLowerCase());
    return allowedOrigins.has(url.origin.toLowerCase());
  } catch {
    return false;
  }
}

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
    if (!isAllowedAttachmentUrl(att.url)) {
      console.warn("attachment origin rejected", new URL(att.url).origin);
      return null;
    }
    const res = await fetch(att.url);
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
  const foreignOrigin = rejectForeignOrigin(req);
  if (foreignOrigin) return foreignOrigin;
  const corsHeaders = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let caller: Awaited<ReturnType<typeof requireServiceRoleOrUserOrSapSession>>;
  try {
    caller = await requireServiceRoleOrUserOrSapSession(req);
  } catch (error) {
    return authErrorResponse(error, corsHeaders) ?? new Response(
      JSON.stringify({ error: "Falha ao autenticar" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if ((Deno.env.get("INTEGRATIONS_MODE") || "enabled").toLowerCase() === "disabled") {
    return new Response(JSON.stringify({ error: "Integrações externas desabilitadas neste ambiente" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { to, cc, bcc, subject, html, text, attachments, replyTo } = await req.json();
    if (!to || !subject || (!html && !text)) {
      return new Response(JSON.stringify({ error: "to, subject and html/text required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const recipients = normalizeRecipients(to);
    const ccRecipients = normalizeRecipients(cc);
    const bccRecipients = normalizeRecipients(bcc);
    const allRecipients = [...recipients, ...ccRecipients, ...bccRecipients];
    if (allRecipients.length === 0 || allRecipients.length > MAX_RECIPIENTS) {
      return new Response(JSON.stringify({ error: `Informe entre 1 e ${MAX_RECIPIENTS} destinatários` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (caller.source !== "service_role") {
      enforceUserRateLimit(caller.email || caller.id);
      assertUserRecipientDomains(allRecipients);
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
    if (ccRecipients.length) sendOpts.cc = ccRecipients;
    if (bccRecipients.length) sendOpts.bcc = bccRecipients;
    if (replyTo) sendOpts.replyTo = replyTo;
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
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
