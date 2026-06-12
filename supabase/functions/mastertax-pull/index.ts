// Edge function: mastertax-pull
// Busca NFs novas na Master Tax, baixa XML + PDF, faz upsert idempotente
// em public.nf_entrada_imports e cria expense em rascunho.
//
// IMPORTANTE: o cliente Master Tax abaixo é um STUB.
// Quando você fornecer base URL, método de auth e formato real da resposta,
// substitua a função `fetchMasterTaxInvoices` pela chamada real.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

interface MasterTaxInvoice {
  chave_acesso: string;
  numero_nf: string;
  serie: string;
  cnpj_fornecedor: string;
  nome_fornecedor: string;
  data_emissao: string;
  valor_total: number;
  condicao_pagamento?: string;
  itens: Array<Record<string, unknown>>;
  impostos: Record<string, unknown>;
  xml_base64?: string;
  pdf_url?: string;
  raw?: Record<string, unknown>;
}

async function fetchMasterTaxInvoices(_sinceIso: string): Promise<MasterTaxInvoice[]> {
  const baseUrl = Deno.env.get("MASTERTAX_BASE_URL");
  const token = Deno.env.get("MASTERTAX_TOKEN");
  if (!baseUrl || !token) {
    console.warn("[mastertax-pull] MASTERTAX_BASE_URL/MASTERTAX_TOKEN não configurados — retornando lista vazia.");
    return [];
  }
  // TODO: implementar chamada real conforme contrato da Master Tax
  // const r = await fetch(`${baseUrl}/invoices?since=${encodeURIComponent(sinceIso)}`, {
  //   headers: { Authorization: `Bearer ${token}` },
  // });
  // const data = await r.json();
  // return (data.items || []) as MasterTaxInvoice[];
  return [];
}

async function downloadPdf(url: string): Promise<Uint8Array | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return new Uint8Array(await r.arrayBuffer());
  } catch (e) {
    console.error("[mastertax-pull] download PDF falhou:", (e as Error).message);
    return null;
  }
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const result = { fetched: 0, upserted: 0, skipped: 0, errors: 0 };

  try {
    const { data: stateRow } = await supabase
      .from("nf_entrada_settings")
      .select("value")
      .eq("company_db", "_global")
      .eq("key", "last_pull_iso")
      .maybeSingle();
    const sinceIso = (stateRow?.value as { iso?: string })?.iso ||
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const invoices = await fetchMasterTaxInvoices(sinceIso);
    result.fetched = invoices.length;

    for (const inv of invoices) {
      try {
        const { data: existing } = await supabase
          .from("nf_entrada_imports")
          .select("id, status")
          .eq("chave_acesso", inv.chave_acesso)
          .maybeSingle();

        if (existing) {
          result.skipped++;
          continue;
        }

        let xmlPath: string | null = null;
        let pdfPath: string | null = null;

        if (inv.xml_base64) {
          xmlPath = `xml/${inv.chave_acesso}.xml`;
          await supabase.storage.from("nf-entrada-files").upload(
            xmlPath,
            decodeBase64(inv.xml_base64),
            { contentType: "application/xml", upsert: true },
          );
        }
        if (inv.pdf_url) {
          const pdfBytes = await downloadPdf(inv.pdf_url);
          if (pdfBytes) {
            pdfPath = `pdf/${inv.chave_acesso}.pdf`;
            await supabase.storage.from("nf-entrada-files").upload(
              pdfPath,
              pdfBytes,
              { contentType: "application/pdf", upsert: true },
            );
          }
        }

        const { data: inserted, error: insErr } = await supabase
          .from("nf_entrada_imports")
          .insert({
            chave_acesso: inv.chave_acesso,
            numero_nf: inv.numero_nf,
            serie: inv.serie,
            cnpj_fornecedor: inv.cnpj_fornecedor,
            nome_fornecedor: inv.nome_fornecedor,
            data_emissao: inv.data_emissao,
            valor_total: inv.valor_total,
            condicao_pagamento: inv.condicao_pagamento,
            itens: inv.itens,
            impostos: inv.impostos,
            raw_mastertax: inv.raw ?? null,
            xml_storage_path: xmlPath,
            pdf_storage_path: pdfPath,
            status: "awaiting_erpflow_approval",
          })
          .select()
          .single();

        if (insErr) throw insErr;

        await supabase.from("nf_entrada_logs").insert({
          import_id: inserted.id,
          step: "mastertax_pull",
          status_to: "awaiting_erpflow_approval",
          message: "NF importada da Master Tax",
          payload: { chave_acesso: inv.chave_acesso },
          actor: "mastertax-pull",
        });

        result.upserted++;
      } catch (e) {
        console.error("[mastertax-pull] erro item:", (e as Error).message);
        result.errors++;
      }
    }

    await supabase.from("nf_entrada_settings").upsert(
      { company_db: "_global", key: "last_pull_iso", value: { iso: new Date().toISOString() } },
      { onConflict: "company_db,key" },
    );

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[mastertax-pull] falha geral:", (e as Error).message);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message, ...result }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
