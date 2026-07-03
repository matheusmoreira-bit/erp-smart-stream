// Edge function: nf-entrada-fetch-file
// Baixa o XML ou PDF (DANFSE) de uma NF de serviço da Master Tax sob demanda,
// faz upload no bucket `nf-entrada-files` e devolve uma signed URL.
//
// MasterTax (endpoints validados):
//   GET /api/notas-servico/xml/{id}     → JSON { retorno: { xml: "<xml…>" } }
//   GET /api/notas-servico/danfse/{id}  → application/zip contendo o PDF do DANFSE
//
// `{id}` é o UUID interno retornado pelo MasterTax (campo `id` no listing),
// não a chave de acesso. Ele fica em `raw_mastertax.id`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { unzip } from "https://esm.sh/fflate@0.8.2";

const DEFAULT_BASE_URL = "https://api.mastertax.app";

interface MasterTaxCreds {
  base_url: string;
  token: string;
}

async function loadCredsForCompany(
  supabase: ReturnType<typeof createClient>,
  companyDb: string | null,
): Promise<MasterTaxCreds | null> {
  const { data } = await supabase
    .from("system_credentials")
    .select("company_db, credential_key, credential_value")
    .eq("system_name", "mastertax");
  const rows = (data || []) as Array<{ company_db: string | null; credential_key: string; credential_value: string }>;
  const grouped = new Map<string, Record<string, string>>();
  for (const r of rows) {
    const key = r.company_db || "_global";
    const bucket = grouped.get(key) || {};
    bucket[r.credential_key] = r.credential_value ?? "";
    grouped.set(key, bucket);
  }
  const tryKeys = [companyDb || "", "_global", ...Array.from(grouped.keys())];
  for (const k of tryKeys) {
    const kv = grouped.get(k);
    if (!kv) continue;
    const token = (kv.token || "").trim();
    if (!token) continue;
    const baseRaw = (kv.base_url || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
    return { base_url: baseRaw || DEFAULT_BASE_URL, token };
  }
  return null;
}

function authHeader(token: string): string {
  return token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;
}

function extractInternalId(raw: unknown, fallback: string): string | null {
  const r = raw as Record<string, unknown> | null | undefined;
  if (r && typeof r === "object") {
    const v = r.id;
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  // fallback (may still work if the caller passed the correct id)
  return fallback || null;
}

async function unzipToPdf(bytes: Uint8Array): Promise<Uint8Array | null> {
  return await new Promise((resolve) => {
    unzip(bytes, (err, files) => {
      if (err || !files) return resolve(null);
      const entries = Object.entries(files);
      // Prefer .pdf; else first non-empty file
      let pick = entries.find(([n]) => n.toLowerCase().endsWith(".pdf"));
      if (!pick) pick = entries.find(([, b]) => b && b.byteLength > 0);
      resolve(pick ? pick[1] : null);
    });
  });
}

async function fetchXml(creds: MasterTaxCreds, id: string): Promise<{ bytes: Uint8Array; contentType: string } | { error: string }> {
  const url = `${creds.base_url}/api/notas-servico/xml/${encodeURIComponent(id)}`;
  const r = await fetch(url, {
    headers: { Authorization: authHeader(creds.token), Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await r.text();
  if (!r.ok) return { error: `HTTP ${r.status}: ${text.slice(0, 200)}` };
  try {
    const j = JSON.parse(text);
    const xml = j?.retorno?.xml ?? j?.retorno?.arquivo ?? j?.xml;
    if (typeof xml === "string" && xml.trim().length > 0) {
      const body = xml.trim().startsWith("<") ? xml : atob(xml.replace(/\s+/g, ""));
      return { bytes: new TextEncoder().encode(body), contentType: "application/xml" };
    }
    return { error: "JSON sem campo `retorno.xml`" };
  } catch (e) {
    return { error: `JSON inválido: ${(e as Error).message}` };
  }
}

async function fetchPdf(creds: MasterTaxCreds, id: string): Promise<{ bytes: Uint8Array; contentType: string } | { error: string }> {
  const url = `${creds.base_url}/api/notas-servico/danfse/${encodeURIComponent(id)}`;
  const r = await fetch(url, {
    headers: { Authorization: authHeader(creds.token), Accept: "*/*" },
    signal: AbortSignal.timeout(45_000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    return { error: `HTTP ${r.status}: ${t.slice(0, 200)}` };
  }
  const ct = (r.headers.get("content-type") || "").toLowerCase();
  const buf = new Uint8Array(await r.arrayBuffer());
  // MasterTax devolve ZIP com o PDF dentro
  if (ct.includes("zip") || (buf[0] === 0x50 && buf[1] === 0x4b)) {
    const pdf = await unzipToPdf(buf);
    if (!pdf) return { error: "Não foi possível extrair o PDF do ZIP DANFSE" };
    return { bytes: pdf, contentType: "application/pdf" };
  }
  if (ct.includes("pdf") || (buf[0] === 0x25 && buf[1] === 0x50)) {
    return { bytes: buf, contentType: "application/pdf" };
  }
  return { error: `Formato inesperado (${ct || "sem content-type"})` };
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
    const kind = String(body?.kind || "").toLowerCase();
    if (!importId || (kind !== "xml" && kind !== "pdf")) {
      return new Response(JSON.stringify({ error: "import_id e kind ('xml'|'pdf') obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: row } = await supabase
      .from("nf_entrada_imports")
      .select("id, chave_acesso, sap_company_db, xml_storage_path, pdf_storage_path, raw_mastertax")
      .eq("id", importId).maybeSingle();
    if (!row) {
      return new Response(JSON.stringify({ error: "NF não encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const existingPath = kind === "xml" ? row.xml_storage_path : row.pdf_storage_path;
    if (existingPath) {
      const { data: signed, error: signErr } = await supabase.storage
        .from("nf-entrada-files").createSignedUrl(existingPath, 60 * 10);
      if (!signErr && signed?.signedUrl) {
        return new Response(JSON.stringify({ url: signed.signedUrl, cached: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const creds = await loadCredsForCompany(supabase, row.sap_company_db);
    if (!creds) {
      return new Response(JSON.stringify({ error: "Credenciais MasterTax ausentes para a empresa" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const mtId = extractInternalId(row.raw_mastertax, row.chave_acesso);
    if (!mtId) {
      return new Response(JSON.stringify({ error: "ID interno MasterTax ausente nesta NF" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const dl = kind === "xml" ? await fetchXml(creds, mtId) : await fetchPdf(creds, mtId);
    if ("error" in dl) {
      const notFound = /HTTP 404/.test(dl.error);
      return new Response(
        JSON.stringify({
          error: notFound
            ? `${kind.toUpperCase()} indisponível no MasterTax para esta NF.`
            : `Falha ao baixar ${kind.toUpperCase()}: ${dl.error}`,
          code: notFound ? "FILE_NOT_FOUND" : "FETCH_FAILED",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const ext = kind === "xml" ? "xml" : "pdf";
    const storagePath = `${ext}/${row.chave_acesso}.${ext}`;
    const { error: upErr } = await supabase.storage.from("nf-entrada-files").upload(
      storagePath, dl.bytes,
      { contentType: dl.contentType, upsert: true },
    );
    if (upErr) {
      return new Response(JSON.stringify({ error: `Upload falhou: ${upErr.message}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("nf_entrada_imports")
      .update(kind === "xml" ? { xml_storage_path: storagePath } : { pdf_storage_path: storagePath })
      .eq("id", row.id);

    const { data: signed, error: signErr } = await supabase.storage
      .from("nf-entrada-files").createSignedUrl(storagePath, 60 * 10);
    if (signErr || !signed?.signedUrl) {
      return new Response(JSON.stringify({ error: `Não foi possível gerar signed URL: ${signErr?.message}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ url: signed.signedUrl, cached: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
