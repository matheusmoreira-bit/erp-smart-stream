// Edge function: nf-entrada-rematch
// Reexecuta o matching contra Pedidos de Compra (PO) e Esboços de PO no SAP B1
// para uma NF Entrada específica, sem gerar duplicatas.
//
// Critérios (iguais ao mastertax-pull):
//   - Localiza CardCode pelo CNPJ (FederalTaxID) e, em fallback, pelo nome
//   - Busca PO aberto com mesmo CardCode e DocTotal (valor_total) exato
//   - Em fallback, busca Esboço (Drafts oPurchaseOrders) com mesmo CardCode e DocTotal
// Se encontra, atualiza a NF com status=awaiting_sap e os campos sap_matched_*.
// Se não encontra, registra log e devolve { matched: false }.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

function buildSapBaseUrl(raw: string): string {
  let url = (raw || "").replace(/\/+$/, "");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

async function sapLogin(baseUrl: string, companyDB: string, u: string, p: string): Promise<string> {
  const r = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ UserName: u, Password: p, CompanyDB: companyDB }),
  });
  if (!r.ok) throw new Error(`Login SAP falhou ${r.status}`);
  await r.json();
  const sc = r.headers.get("set-cookie") || "";
  const sess = sc.match(/B1SESSION=([^;]+)/)?.[1];
  const route = sc.match(/ROUTEID=([^;]+)/)?.[1];
  if (!sess) throw new Error("B1SESSION ausente");
  return `B1SESSION=${sess}${route ? `; ROUTEID=${route}` : ""}`;
}

const escapeOData = (s: string) => (s || "").replace(/'/g, "''");

async function findSapSupplierCardCode(
  baseUrl: string, cookie: string, cnpj: string, nome: string,
): Promise<string | null> {
  const digits = (cnpj || "").replace(/\D/g, "");
  if (digits) {
    const r = await fetch(
      `${baseUrl}/BusinessPartners?$filter=CardType eq 'cSupplier' and FederalTaxID eq '${digits}'&$select=CardCode&$top=1`,
      { headers: { Cookie: cookie } },
    );
    if (r.ok) {
      const cc = (await r.json())?.value?.[0]?.CardCode;
      if (cc) return String(cc);
    }
  }
  const n = (nome || "").trim();
  if (n.length >= 4) {
    const r = await fetch(
      `${baseUrl}/BusinessPartners?$filter=CardType eq 'cSupplier' and contains(CardName,'${escapeOData(n)}')&$select=CardCode&$top=1`,
      { headers: { Cookie: cookie } },
    );
    if (r.ok) {
      const cc = (await r.json())?.value?.[0]?.CardCode;
      if (cc) return String(cc);
    }
  }
  return null;
}

async function findExistingPo(
  baseUrl: string, cookie: string, cardCode: string, valor: number,
): Promise<{ docEntry: string; isDraft: boolean } | null> {
  const v = Number(valor).toFixed(2);
  const poUrl = `${baseUrl}/PurchaseOrders?$filter=CardCode eq '${escapeOData(cardCode)}' and DocumentStatus eq 'bost_Open' and DocTotal eq ${v}&$select=DocEntry&$top=1`;
  const poR = await fetch(poUrl, { headers: { Cookie: cookie } });
  if (poR.ok) {
    const de = (await poR.json())?.value?.[0]?.DocEntry;
    if (de != null) return { docEntry: String(de), isDraft: false };
  }
  const drUrl = `${baseUrl}/Drafts?$filter=DocObjectCode eq 'oPurchaseOrders' and CardCode eq '${escapeOData(cardCode)}' and DocTotal eq ${v}&$select=DocEntry&$top=1`;
  const drR = await fetch(drUrl, { headers: { Cookie: cookie } });
  if (drR.ok) {
    const de = (await drR.json())?.value?.[0]?.DocEntry;
    if (de != null) return { docEntry: String(de), isDraft: true };
  }
  return null;
}

async function loadSapCreds(
  supabase: ReturnType<typeof createClient>,
  companyDb: string,
): Promise<{ baseUrl: string; companyDB: string; username: string; password: string } | null> {
  const { data } = await supabase
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "sap")
    .eq("company_db", companyDb);
  const kv: Record<string, string> = {};
  for (const r of (data || []) as Array<{ credential_key: string; credential_value: string }>) {
    kv[r.credential_key] = r.credential_value ?? "";
  }
  if (!kv.service_layer_url || !kv.username || !kv.password) return null;
  return {
    baseUrl: buildSapBaseUrl(kv.service_layer_url),
    companyDB: kv.company_db || companyDb,
    username: kv.username,
    password: kv.password,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const importId = String(body?.import_id || "");
    if (!importId) {
      return new Response(JSON.stringify({ error: "import_id obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: row, error: rowErr } = await supabase
      .from("nf_entrada_imports")
      .select("id, cnpj_fornecedor, nome_fornecedor, valor_total, sap_company_db, status, sap_invoice_draft_id")
      .eq("id", importId)
      .maybeSingle();
    if (rowErr || !row) {
      return new Response(JSON.stringify({ error: "NF não encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Evita rematch quando já existe esboço de NF de entrada criado pela integração
    if (row.sap_invoice_draft_id) {
      return new Response(JSON.stringify({
        matched: false,
        skipped: "NF já possui esboço de NF de entrada no SAP — rematch ignorado para evitar duplicata.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const companyDb = row.sap_company_db;
    if (!companyDb) {
      return new Response(JSON.stringify({ error: "sap_company_db ausente" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sap = await loadSapCreds(supabase, companyDb);
    if (!sap) {
      return new Response(JSON.stringify({ error: "Credenciais SAP ausentes" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cookie = await sapLogin(sap.baseUrl, sap.companyDB, sap.username, sap.password);
    try {
      const cardCode = await findSapSupplierCardCode(
        sap.baseUrl, cookie, row.cnpj_fornecedor || "", row.nome_fornecedor || "",
      );
      if (!cardCode) {
        await supabase.from("nf_entrada_logs").insert({
          import_id: row.id, step: "rematch_existing_po", actor: "nf-entrada-rematch",
          message: "Fornecedor não localizado no SAP (CNPJ/Nome).",
        });
        return new Response(JSON.stringify({ matched: false, reason: "fornecedor não localizado" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const match = await findExistingPo(sap.baseUrl, cookie, cardCode, Number(row.valor_total || 0));
      if (!match) {
        await supabase.from("nf_entrada_logs").insert({
          import_id: row.id, step: "rematch_existing_po", actor: "nf-entrada-rematch",
          message: `Nenhum PC/esboço aberto encontrado para CardCode ${cardCode} no valor ${Number(row.valor_total || 0).toFixed(2)}.`,
        });
        return new Response(JSON.stringify({ matched: false, cardCode, reason: "PC não localizado" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabase.from("nf_entrada_imports").update({
        status: "awaiting_sap",
        sap_company_db: companyDb,
        sap_matched_card_code: cardCode,
        sap_matched_po_doc_entry: match.docEntry,
        sap_matched_po_is_draft: match.isDraft,
        sap_po_draft_id: match.docEntry,
        sap_match_reason: `cnpj+valor (${match.isDraft ? "draft" : "PO"}) [rematch manual]`,
      }).eq("id", row.id);

      await supabase.from("nf_entrada_logs").insert({
        import_id: row.id,
        step: "rematch_existing_po",
        status_to: "awaiting_sap",
        actor: "nf-entrada-rematch",
        message: `Vínculo refeito: PC ${match.isDraft ? "esboço" : "efetivo"} DocEntry ${match.docEntry}, CardCode ${cardCode}.`,
      });

      return new Response(JSON.stringify({
        matched: true, cardCode, docEntry: match.docEntry, isDraft: match.isDraft,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } finally {
      await fetch(`${sap.baseUrl}/Logout`, { method: "POST", headers: { Cookie: cookie } }).catch(() => {});
    }
  } catch (e) {
    console.error("[nf-entrada-rematch]", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
