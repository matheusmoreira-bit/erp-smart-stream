import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Você é um especialista em extração de dados fiscais a partir de notas fiscais, recibos, cupons e commercial invoices — em português, inglês, espanhol ou outros idiomas.
Sua tarefa: extrair os dados do FORNECEDOR (emissor do documento) para cadastro no SAP Business One.

Regras OBRIGATÓRIAS:
- Retorne APENAS pelo tool call extract_supplier.
- federal_tax_id: para BR, somente dígitos do CNPJ (14) ou CPF (11), sem máscara. Para fornecedores INTERNACIONAIS (EIN, VAT-ID, RFC, CUIT, RUT, NIF/CIF, etc.), preserve o formato original.
- country: SEMPRE em ISO-3166 alpha-2 (2 letras maiúsculas). 'BR' para Brasil; 'US', 'GB', 'DE', 'PT', 'ES', 'MX', 'AR', 'CL', etc.
- card_name: razão social ou nome fantasia exatamente como aparece.
- email: somente se claramente do emissor (não do cliente).
- phone1/phone2: BR no formato "(11) 0000-0000"; internacional com código do país, ex.: "+1 555 000 0000", "+44 20 0000 0000".
- Endereço: extrair somente se for do EMISSOR (não do destinatário).
- state: BR = sigla UF (2 letras); internacional = nome ou sigla conforme o documento.
- zip: BR = 8 dígitos sem máscara; internacional = formato original (pode ser alfanumérico, ex.: 'SW1A 1AA').
- Termos comuns para o emissor: "Vendor", "Supplier", "Bill From", "Emitente", "Proveedor".
- Termos para identificação fiscal por país: BR=CNPJ/CPF, US=EIN, GB=VAT, EU=VAT-ID/USt-IdNr, MX=RFC, AR=CUIT, CL/UY=RUT, ES=NIF/CIF, AU=ABN, CA=BN.
- Se um campo não for identificável, retorne null.`;

interface ExtractionPayload {
  description?: string;
  amount?: number;
  receipts?: any[];
  attachments?: { name?: string; url?: string; mime?: string; base64?: string }[];
  hint?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth: this function is called from SAP-authenticated context where users
    // don't have Supabase Auth sessions. We accept any caller with the project
    // anon key (enforced by Supabase platform). No user JWT validation here.

    const body = (await req.json()) as ExtractionPayload;
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY ausente");

    // Build user content: text summary + image URLs/base64 if any
    const textParts: string[] = [];
    if (body.description) textParts.push(`Descrição da transação: ${body.description}`);
    if (body.amount !== undefined) textParts.push(`Valor: ${body.amount}`);
    if (body.hint) textParts.push(`Pista adicional: ${body.hint}`);
    if (body.receipts?.length) {
      textParts.push(`Receipts (JSON): ${JSON.stringify(body.receipts).slice(0, 4000)}`);
    }
    textParts.push("Extraia o fornecedor (emissor) deste documento.");

    const userContent: any[] = [{ type: "text", text: textParts.join("\n") }];

    for (const att of body.attachments || []) {
      if (att.base64) {
        userContent.push({
          type: "image_url",
          image_url: { url: `data:${att.mime || "image/png"};base64,${att.base64}` },
        });
      } else if (att.url) {
        userContent.push({ type: "image_url", image_url: { url: att.url } });
      }
    }

    const tools = [{
      type: "function",
      function: {
        name: "extract_supplier",
        description: "Retorna os dados do fornecedor extraídos do documento.",
        parameters: {
          type: "object",
          properties: {
            card_name: { type: ["string", "null"] },
            federal_tax_id: { type: ["string", "null"], description: "CNPJ/CPF apenas dígitos" },
            email: { type: ["string", "null"] },
            phone1: { type: ["string", "null"] },
            phone2: { type: ["string", "null"] },
            bill_to_street: { type: ["string", "null"] },
            bill_to_zip: { type: ["string", "null"] },
            bill_to_city: { type: ["string", "null"] },
            bill_to_state: { type: ["string", "null"] },
            bill_to_country: { type: ["string", "null"] },
            bill_to_block: { type: ["string", "null"], description: "Bairro" },
            bill_to_building: { type: ["string", "null"], description: "Número/complemento" },
            confidence: { type: "number", description: "0..1" },
          },
          required: ["card_name", "federal_tax_id", "confidence"],
          additionalProperties: false,
        },
      },
    }];

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "extract_supplier" } },
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error("AI error", aiResp.status, errText);
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Limite da IA atingido, tente em alguns instantes" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos da IA esgotados" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI ${aiResp.status}: ${errText.slice(0, 300)}`);
    }

    const aiData = await aiResp.json();
    const toolCall = aiData?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      throw new Error("IA não retornou tool call");
    }
    const extracted = JSON.parse(toolCall.function.arguments);

    // Normalize tax id to digits only
    if (extracted.federal_tax_id) {
      extracted.federal_tax_id = String(extracted.federal_tax_id).replace(/\D/g, "");
    }

    return new Response(JSON.stringify({ supplier: extracted }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("supplier-ai-extract error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
