// Send email via SMTP (Gmail) — generic endpoint used by notification pipes
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

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

interface AttachmentInput {
  url?: string;
  filename?: string;
  name?: string;
  contentType?: string;
  content?: string; // base64 if no URL
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
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { to, cc, bcc, subject, html, text, attachments, replyTo } = await req.json();
    if (!to || !subject || (!html && !text)) {
      return new Response(JSON.stringify({ error: "to, subject and html/text required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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

    const recipients = Array.isArray(to) ? to : [to];
    const sendOpts: Record<string, unknown> = {
      from: `Sistema Ana Gaming <${SMTP_USER}>`,
      to: recipients,
      subject,
      content: text || subject,
      html: html || undefined,
    };
    if (cc) sendOpts.cc = Array.isArray(cc) ? cc : [cc];
    if (bcc) sendOpts.bcc = Array.isArray(bcc) ? bcc : [bcc];
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
