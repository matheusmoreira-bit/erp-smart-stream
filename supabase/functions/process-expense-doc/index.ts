import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Static fallback aliases (used only if DB lookup fails)
const FALLBACK_COMPANY_NAMES: Record<string, string[]> = {
  SBO_ANAGAMING: ["ana gaming", "anagaming"],
  SBO_CACTUS: ["cactus", "instituto cactus"],
  SBO_INSTITUTO_ANA: ["instituto ana", "instituto cactus"],
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Configurable name-similarity threshold (Jaccard over meaningful tokens).
// Values >= threshold count as a match. Default 0.5.
const NAME_MATCH_THRESHOLD = Math.min(
  1,
  Math.max(0, Number(Deno.env.get("COMPANY_NAME_MATCH_THRESHOLD") || "0.5")),
);

// Legal-form suffixes / noise tokens stripped before comparison.
const STOP_TOKENS = new Set([
  "sa", "s/a", "ltda", "me", "epp", "eireli", "inc", "llc", "corp", "cia",
  "co", "company", "companhia", "group", "grupo", "holding", "holdings",
  "the", "de", "da", "do", "das", "dos", "e", "and", "of",
]);

function normalizeText(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/\b(s\.?\s*a\.?|s\.?\s*\/?\s*a\.?|ltda\.?|me|epp|eireli|inc\.?|llc|corp\.?|cia\.?)\b/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulTokens(s: string): string[] {
  return normalizeText(s)
    .split(" ")
    .filter((t) => t.length >= 3 && !STOP_TOKENS.has(t));
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function onlyDigits(s: string): string {
  return (s || "").replace(/\D+/g, "");
}

// Normalize a tax id for comparison. For CNPJ (14 digits), also expose the
// 8-digit "raiz" (root) so branch differences don't cause false negatives.
function normalizeTaxId(s: string): { full: string; root: string | null } {
  const d = onlyDigits(s);
  if (!d) return { full: "", root: null };
  // CNPJ raiz = first 8 digits
  if (d.length === 14) return { full: d, root: d.slice(0, 8) };
  return { full: d, root: null };
}

function taxIdsMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const na = normalizeTaxId(a);
  const nb = normalizeTaxId(b);
  if (!na.full || !nb.full) return false;
  if (na.full === nb.full) return true;
  // Match by CNPJ root (same headquarter, different branch)
  if (na.root && nb.root && na.root === nb.root) return true;
  // Fallback: one contains the other with substantial overlap (>=8 digits)
  const shorter = na.full.length <= nb.full.length ? na.full : nb.full;
  const longer = na.full.length > nb.full.length ? na.full : nb.full;
  if (shorter.length >= 8 && longer.endsWith(shorter)) return true;
  return false;
}

async function fetchCompanyContext(companyDB: string): Promise<{
  aliases: string[];
  taxIds: string[];
  displayName: string | null;
}> {
  const aliases = new Set<string>();
  const taxIds = new Set<string>();
  let displayName: string | null = null;

  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && companyDB) {
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/companies?company_db=eq.${encodeURIComponent(companyDB)}&select=display_name,legal_name,trade_name,foreign_name,tax_id`,
        {
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        },
      );
      if (r.ok) {
        const rows = (await r.json()) as Array<Record<string, string | null>>;
        for (const row of rows) {
          for (const field of ["display_name", "legal_name", "trade_name", "foreign_name"] as const) {
            const v = row[field];
            if (v) {
              const n = normalizeText(v);
              if (n) aliases.add(n);
              if (!displayName && field === "display_name") displayName = v;
            }
          }
          const digits = onlyDigits(row.tax_id || "");
          if (digits.length >= 8) taxIds.add(digits);
        }
      }
    } catch (e) {
      console.warn("companies lookup failed", e);
    }
  }

  // Merge fallback aliases
  for (const a of FALLBACK_COMPANY_NAMES[companyDB] || []) aliases.add(normalizeText(a));

  return { aliases: [...aliases].filter(Boolean), taxIds: [...taxIds], displayName };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const formData = await req.formData();
    const files = formData.getAll("files") as File[];
    const companyDB = formData.get("company_db") as string || "";

    if (!files || files.length === 0) {
      return new Response(JSON.stringify({ error: "Nenhum arquivo enviado" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    // Build content parts
    const contentParts: any[] = [];
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const isPdf = file.name.toLowerCase().endsWith(".pdf");
      const isImage = /\.(jpg|jpeg|png|webp|gif)$/i.test(file.name);

      if (isPdf || isImage) {
        // Encode in chunks to avoid stack overflow on large files
        let binaryString = "";
        const CHUNK = 8192;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          const chunk = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
          binaryString += String.fromCharCode.apply(null, Array.from(chunk));
        }
        const base64 = btoa(binaryString);
        const mimeType = isPdf ? "application/pdf" : file.type || "image/jpeg";
        contentParts.push({
          type: "image_url",
          image_url: { url: `data:${mimeType};base64,${base64}` },
        });
      } else {
        const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        contentParts.push({
          type: "text",
          text: `[Arquivo: ${file.name}]\n${text.substring(0, 15000)}`,
        });
      }
    }

    contentParts.push({
      type: "text",
      text: "Analise os documentos acima e extraia as informações conforme solicitado. Responda APENAS com o JSON, sem markdown ou explicações.",
    });

    const systemPrompt = `Você é um assistente especializado em processar documentos fiscais — tanto brasileiros (notas fiscais, recibos, boletos) quanto internacionais (commercial invoices, receipts em inglês/espanhol/etc.).
Analise os documentos enviados e extraia as seguintes informações em formato JSON:

{
  "supplier_name": "Nome do fornecedor/empresa emissora (quem VENDEU/prestou serviço)",
  "supplier_cnpj": "Identificação fiscal do fornecedor — CNPJ/CPF (BR), EIN (US), VAT-ID (UE/UK), RFC (MX), CUIT (AR), RUT (CL/UY), NIF/CIF (ES/PT), etc. Sem máscara/pontuação para BR; mantém o formato original para internacional.",
  "supplier_country": "ISO-3166 alpha-2 do país do fornecedor (ex.: 'BR', 'US', 'GB', 'DE'). 'BR' por padrão se claramente brasileiro; deduza de moeda/idioma/endereço para outros casos.",
  "supplier_match_confidence": 0.95,
  "supplier_email": "Email do fornecedor (emissor), se aparecer no documento. null caso contrário.",
  "supplier_phone1": "Telefone principal do fornecedor com código do país quando internacional (ex: '+1 555 000 0000', ou '(11) 0000-0000' para BR). null se ausente.",
  "supplier_phone2": "Telefone secundário do fornecedor, mesmo formato. null se ausente.",
  "supplier_address": {
    "street": "Logradouro/endereço linha 1 do fornecedor (sem número/bairro quando possível). null se ausente.",
    "building": "Número e/ou complemento (ou linha 2 do endereço internacional). null se ausente.",
    "block": "Bairro (BR) ou distrito/neighborhood (internacional). null se ausente.",
    "zip": "CEP/ZIP/Postal Code do fornecedor. Para BR: apenas dígitos (8). Para outros países: mantenha formato original (alfanumérico permitido, ex.: 'SW1A 1AA', '10115').",
    "city": "Cidade do fornecedor. null se ausente.",
    "state": "Estado/UF/província/região do fornecedor. Para BR: sigla 2 letras (UF). Para outros: nome ou sigla conforme aparece no documento.",
    "country": "ISO-3166 alpha-2 do endereço (mesma regra de supplier_country). 'BR' por padrão para endereços brasileiros."
  },
  "client_name": "Nome do cliente/destinatário (quem COMPROU/recebeu o serviço)",
  "client_cnpj": "CNPJ/Tax ID do cliente se disponível",
  "total_amount": 0.00,
  "currency": "ISO 4217 do documento — 'BRL', 'USD', 'EUR', 'GBP', etc. Use o que efetivamente aparece no documento (símbolo $, R$, €, £, ou texto explícito).",
  "document_date": "YYYY-MM-DD (data de emissão do documento)",
  "due_date": "YYYY-MM-DD (data de vencimento, se houver; caso não exista, usar document_date + 30 dias)",
  "document_number": "Número do documento/NF/Invoice #",
  "items": [
    {
      "description": "Descrição LITERAL do item/serviço, exatamente como está escrito no documento (sem resumir, sem reformular, sem traduzir)",
      "item_search_hint": "Termo curto (1-4 palavras) em PORTUGUÊS que representa o TIPO/CATEGORIA do item consumido, mesmo que o documento esteja em outro idioma. Exemplos: 'combustível', 'pedágio', 'refeição', 'hospedagem', 'táxi', 'estacionamento', 'material de escritório', 'software', 'consultoria'.",
      "quantity": 1,
      "unit_price": 0.00,
      "line_total": 0.00,
      "item_code_match": null
    }
  ],
  "remarks": "Observações relevantes sobre o documento",
  "cost_center_hint": "Sugestão de centro de custo baseado no tipo de despesa, somente se tiver alta certeza",
  "cost_center_confidence": 0.0,
  "project_hint": "Sugestão de projeto, somente se tiver alta certeza",
  "project_confidence": 0.0,
  "confidence": 0.95
}

Regras IMPORTANTES:
- Documentos podem estar em PORTUGUÊS, INGLÊS, ESPANHOL ou outros idiomas. Você deve interpretar todos.
- Termos comuns para o emissor: "Vendor", "Supplier", "Seller", "Bill From", "Emitente", "Proveedor". Para o destinatário: "Bill To", "Customer", "Client", "Sold To", "Destinatário", "Cliente".
- Termos para identificação fiscal por país: BR=CNPJ/CPF, US=EIN/SSN, GB=VAT/Company Number, EU=VAT-ID/USt-IdNr/TVA, MX=RFC, AR=CUIT, CL/UY=RUT, CO=NIT, PE/PY=RUC, ES=NIF/CIF, PT=NIF, AU=ABN, CA=BN.
- Extraia TODOS os itens listados no documento.
- CRÍTICO: O campo "description" deve conter o texto LITERAL do item como aparece no documento. NÃO resuma, NÃO reformule, NÃO traduza. Copie exatamente como está escrito.
- CRÍTICO: O campo "item_search_hint" deve ser uma INTERPRETAÇÃO sua em PORTUGUÊS do que foi consumido. Use de 1 a 4 palavras, no singular, sem marca/fornecedor.
- O campo "supplier_match_confidence" indica sua confiança no nome/identificação do fornecedor (0 a 1).
- NÃO invente dados. Se não conseguir identificar um campo com certeza, use null.
- Para "item_code_match": só preencha se tiver certeza absoluta do código SAP do item. Na dúvida, use null.
- O campo confidence indica sua confiança geral na extração (0 a 1).
- Se houver múltiplos documentos, retorne um array de objetos.
- Valores monetários devem ser números (não strings). Use ponto decimal.
- Datas no formato YYYY-MM-DD.
- Extraia o CLIENTE (destinatário) separadamente do FORNECEDOR (emitente).
- "document_date" é a data de emissão da nota/documento.
- "due_date" é a data de vencimento. Se não houver, calcule como document_date + 30 dias.
- IMPORTANTE: Os campos supplier_email, supplier_phone1, supplier_phone2, supplier_address, supplier_country devem se referir SEMPRE ao EMISSOR (fornecedor), nunca ao destinatário/cliente.
- Para supplier_address: extraia somente do bloco do EMITENTE.
- supplier_address.zip: BR = apenas 8 dígitos; internacional = formato original (pode ser alfanumérico).
- supplier_address.state: BR = sigla UF de 2 letras maiúsculas; internacional = nome ou sigla conforme aparece.
- supplier_country e supplier_address.country: SEMPRE em ISO-3166 alpha-2 (2 letras maiúsculas, ex.: 'BR', 'US', 'GB', 'DE', 'PT').`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: contentParts },
        ],
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Limite de requisições excedido, tente novamente em alguns segundos." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA esgotados." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("AI error:", aiResponse.status, errText);
      throw new Error("Erro ao processar documento com IA");
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "";

    let parsed;
    try {
      const cleaned = rawContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI response:", rawContent);
      return new Response(JSON.stringify({
        error: "Não foi possível interpretar o documento. Tente novamente.",
        raw: rawContent,
      }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Post-process: check company match and totals divergence
    const docs = Array.isArray(parsed) ? parsed : [parsed];
    const companyCtx = companyDB ? await fetchCompanyContext(companyDB) : null;

    for (const doc of docs) {
      // --- Company (recipient) match: normalized tax_id + name similarity ---
      if (companyCtx && (companyCtx.aliases.length || companyCtx.taxIds.length)) {
        const clientNorm = normalizeText(doc.client_name || "");
        const clientTokens = meaningfulTokens(doc.client_name || "");

        // 1) Strict tax-id match (full digits, CNPJ raiz, or partial >=8 digits)
        const taxIdMatch = companyCtx.taxIds.some((t) => taxIdsMatch(t, doc.client_cnpj || ""));

        // 2) Name similarity via Jaccard over meaningful tokens, plus substring safety net
        let bestScore = 0;
        for (const a of companyCtx.aliases) {
          if (!a) continue;
          if (clientNorm && (clientNorm.includes(a) || a.includes(clientNorm))) {
            bestScore = 1;
            break;
          }
          const score = jaccard(meaningfulTokens(a), clientTokens);
          if (score > bestScore) bestScore = score;
        }
        const nameMatch = bestScore >= NAME_MATCH_THRESHOLD;

        if (!taxIdMatch && !nameMatch && doc.client_name) {
          const expected = companyCtx.displayName ? ` (esperado: "${companyCtx.displayName}")` : "";
          doc.client_warning = `O destinatário do documento ("${doc.client_name}"${
            doc.client_cnpj ? ` — CNPJ ${doc.client_cnpj}` : ""
          }) não corresponde à empresa logada${expected}. Confirme antes de prosseguir.`;
          doc.client_match_score = Number(bestScore.toFixed(2));
          doc.client_match_threshold = NAME_MATCH_THRESHOLD;
        }
      }


      // --- Totals divergence: sum(items) vs total_amount ---
      const items = Array.isArray(doc.items) ? doc.items : [];
      if (items.length > 0 && typeof doc.total_amount === "number" && doc.total_amount > 0) {
        const sumItems = items.reduce((s: number, it: any) => {
          const lt = Number(it.line_total);
          if (Number.isFinite(lt) && lt !== 0) return s + lt;
          const qty = Number(it.quantity) || 0;
          const unit = Number(it.unit_price) || 0;
          return s + qty * unit;
        }, 0);
        const total = Number(doc.total_amount);
        const diff = Math.abs(sumItems - total);
        const tolerance = Math.max(0.02, total * 0.005); // 0.5% or 2 cents
        if (diff > tolerance) {
          const fmt = (n: number) =>
            n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          doc.totals_warning = `Divergência de valores: a soma das ${items.length} linha(s) é R$ ${fmt(
            sumItems,
          )}, mas o total do documento é R$ ${fmt(total)} (diferença R$ ${fmt(
            diff,
          )}). Revise os itens antes de criar a despesa.`;
          doc.totals_sum_items = Number(sumItems.toFixed(2));
          doc.totals_document = Number(total.toFixed(2));
        }
      }
    }

    return new Response(JSON.stringify({ result: Array.isArray(parsed) ? docs : docs[0] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("process-expense-doc error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
