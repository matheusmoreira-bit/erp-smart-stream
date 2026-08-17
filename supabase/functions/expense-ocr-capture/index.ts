import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

/**
 * OCR de captura rápida (mobile): recebe a foto de uma nota/boleto e
 * devolve os campos mínimos para pré-preencher o lançamento
 * (fornecedor, CNPJ, valor, emissão e vencimento).
 *
 * A extração fina (itens, rateio, CC) continua no fluxo existente do
 * CreateExpenseModal — aqui o objetivo é apenas adiantar o cabeçalho.
 */

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.6-flash";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // ~8MB de imagem (base64 já decodificado)

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"]);

function approxBytesFromBase64(b64: string): number {
  return Math.floor((b64.length * 3) / 4);
}

function parseDataUrl(input: string): { mime: string; base64: string } | null {
  const m = /^data:([^;,]+);base64,(.+)$/s.exec((input || "").trim());
  if (!m) return null;
  return { mime: m[1].toLowerCase(), base64: m[2] };
}

function normalizeAmount(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[^\d.,-]/g, "").trim();
  if (!s) return null;
  // pt-BR: 1.234,56 → 1234.56 ; en: 1,234.56 → 1234.56
  const normalized = s.lastIndexOf(",") > s.lastIndexOf(".")
    ? s.replace(/\./g, "").replace(",", ".")
    : s.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function normalizeDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return s;
  m = /^(\d{2})[/.-](\d{2})[/.-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Exige sessão autenticada (o gateway key nunca vai ao cliente).
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }

  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return json({ error: "missing_ai_key" }, 500);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const image = typeof body?.image === "string" ? body.image : "";
  const parsed = parseDataUrl(image);
  if (!parsed) return json({ error: "image_required", message: "Envie a imagem como data URL base64." }, 400);
  if (!ALLOWED_MIME.has(parsed.mime)) {
    return json({ error: "unsupported_mime", message: `Formato não suportado: ${parsed.mime}` }, 400);
  }
  if (approxBytesFromBase64(parsed.base64) > MAX_IMAGE_BYTES) {
    return json({ error: "image_too_large", message: "Imagem maior que 8MB. Reduza a resolução." }, 400);
  }

  const instruction = [
    "Você extrai dados de documentos fiscais brasileiros (NF-e, NFS-e, boleto, recibo, cupom).",
    "Responda APENAS com um objeto JSON, sem markdown, com as chaves:",
    "supplier_name (razão social do EMITENTE/prestador), supplier_tax_id (CNPJ/CPF só dígitos),",
    "doc_number (número do documento), amount (valor total a pagar, número),",
    "currency (código ISO, padrão BRL), doc_date (emissão, AAAA-MM-DD),",
    "due_date (vencimento, AAAA-MM-DD), description (resumo curto do serviço/produto),",
    "confidence (0 a 1).",
    "Use null quando o campo não estiver legível. Nunca invente valores.",
    "Se houver várias parcelas, use o vencimento mais próximo e o valor total do documento.",
  ].join(" ");

  let aiRes: Response;
  try {
    aiRes = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: instruction },
          {
            role: "user",
            content: [
              { type: "text", text: "Extraia os campos deste documento." },
              { type: "image_url", image_url: { url: image } },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
    });
  } catch (e) {
    console.error("[expense-ocr-capture] gateway fetch failed", e);
    return json({ error: "ai_unavailable" }, 502);
  }

  if (aiRes.status === 429) return json({ error: "rate_limited", message: "Muitas leituras seguidas. Tente novamente em instantes." }, 429);
  if (aiRes.status === 402) return json({ error: "credits_exhausted", message: "Créditos de IA esgotados no workspace." }, 402);
  if (!aiRes.ok) {
    const detail = await aiRes.text().catch(() => "");
    console.error("[expense-ocr-capture] gateway error", aiRes.status, detail.slice(0, 500));
    return json({ error: "ai_error", status: aiRes.status }, 502);
  }

  const payload = await aiRes.json().catch(() => null);
  const raw = payload?.choices?.[0]?.message?.content ?? "";
  let extracted: any = {};
  try {
    extracted = typeof raw === "string" ? JSON.parse(raw) : raw ?? {};
  } catch {
    const m = /\{[\s\S]*\}/.exec(String(raw));
    if (m) { try { extracted = JSON.parse(m[0]); } catch { extracted = {}; } }
  }

  const result = {
    supplier_name: typeof extracted?.supplier_name === "string" ? extracted.supplier_name.trim() || null : null,
    supplier_tax_id: typeof extracted?.supplier_tax_id === "string"
      ? extracted.supplier_tax_id.replace(/\D+/g, "") || null
      : null,
    doc_number: extracted?.doc_number != null ? String(extracted.doc_number).trim() || null : null,
    amount: normalizeAmount(extracted?.amount),
    currency: typeof extracted?.currency === "string" && /^[A-Za-z]{3}$/.test(extracted.currency)
      ? extracted.currency.toUpperCase()
      : "BRL",
    doc_date: normalizeDate(extracted?.doc_date),
    due_date: normalizeDate(extracted?.due_date),
    description: typeof extracted?.description === "string" ? extracted.description.trim().slice(0, 240) || null : null,
    confidence: typeof extracted?.confidence === "number" ? Math.max(0, Math.min(1, extracted.confidence)) : null,
  };

  return json({ ok: true, data: result });
});
