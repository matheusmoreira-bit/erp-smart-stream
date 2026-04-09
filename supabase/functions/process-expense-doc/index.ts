import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const COMPANY_NAMES: Record<string, string[]> = {
  SBO_ANAGAMING: ["ana gaming", "anagaming"],
  SBO_CACTUS: ["cactus", "instituto cactus"],
  SBO_INSTITUTO_ANA: ["instituto ana", "instituto cactus"],
};

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

    const systemPrompt = `Você é um assistente especializado em processar documentos fiscais brasileiros (notas fiscais, recibos, boletos, etc.).
Analise os documentos enviados e extraia as seguintes informações em formato JSON:

{
  "supplier_name": "Nome do fornecedor/empresa emissora (quem VENDEU/prestou serviço)",
  "supplier_cnpj": "CNPJ do fornecedor se disponível",
  "supplier_match_confidence": 0.95,
  "client_name": "Nome do cliente/destinatário (quem COMPROU/recebeu o serviço)",
  "client_cnpj": "CNPJ do cliente se disponível",
  "total_amount": 0.00,
  "currency": "BRL",
  "document_date": "YYYY-MM-DD (data de emissão do documento)",
  "due_date": "YYYY-MM-DD (data de vencimento, se houver; caso não exista, usar document_date + 30 dias)",
  "document_number": "Número do documento/NF",
  "items": [
    {
      "description": "Descrição do item/serviço",
      "quantity": 1,
      "unit_price": 0.00,
      "line_total": 0.00,
      "item_code_match": null
    }
  ],
  "remarks": "Observações relevantes sobre o documento",
  "cost_center_hint": "Sugestão de centro de custo baseado no tipo de despesa",
  "confidence": 0.95
}

Regras IMPORTANTES:
- Extraia TODOS os itens listados no documento
- O campo "supplier_match_confidence" indica sua confiança de que o nome/CNPJ do fornecedor está correto (0 a 1). Se não tiver certeza, use um valor baixo.
- NÃO invente dados. Se não conseguir identificar um campo com certeza, use null.
- Para "item_code_match": só preencha se tiver certeza absoluta do código SAP do item. Na dúvida, use null.
- O campo confidence indica sua confiança geral na extração (0 a 1)
- Se houver múltiplos documentos, retorne um array de objetos
- Valores monetários devem ser números (não strings)
- Datas no formato YYYY-MM-DD
- Extraia o CLIENTE (destinatário) separadamente do FORNECEDOR (emitente)
- "document_date" é a data de emissão da nota/documento
- "due_date" é a data de vencimento. Se não houver, calcule como document_date + 30 dias.`;

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

    // Post-process: check if document client matches logged company
    const docs = Array.isArray(parsed) ? parsed : [parsed];
    for (const doc of docs) {
      if (companyDB && doc.client_name) {
        const clientLower = doc.client_name.toLowerCase();
        const companyAliases = COMPANY_NAMES[companyDB] || [];
        const matches = companyAliases.some((alias) => clientLower.includes(alias));
        if (!matches) {
          doc.client_warning = `O destinatário do documento ("${doc.client_name}") não corresponde à empresa logada. O documento pode não pertencer a esta empresa.`;
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
