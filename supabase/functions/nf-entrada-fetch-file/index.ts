// Edge function: nf-entrada-fetch-file
// Baixa o XML ou PDF de uma NF da Master Tax sob demanda, faz upload no
// bucket `nf-entrada-files` e devolve uma signed URL.
// Usa o `chave_acesso` salvo (que é o id retornado pelo MasterTax) e tenta
// múltiplos endpoints conhecidos. Em caso de sucesso, persiste o caminho em
// `xml_storage_path` / `pdf_storage_path` para evitar download repetido.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

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
  // Group by company_db
  const grouped = new Map<string, Record<string, string>>();
  for (const r of rows) {
    const key = r.company_db || "_global";
    const bucket = grouped.get(key) || {};
    bucket[r.credential_key] = r.credential_value ?? "";
    grouped.set(key, bucket);
  }
  // Try exact match, then global, then any
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

const XML_PATHS = (id: string) => [
  `/api/notas-servico/${encodeURIComponent(id)}/xml`,
  `/api/notas-servico/${encodeURIComponent(id)}/xml-nfse`,
  `/api/notas-servico/${encodeURIComponent(id)}/arquivo-xml`,
  `/api/notas-servico/${encodeURIComponent(id)}/download-xml`,
  `/api/notas-servico/xml/${encodeURIComponent(id)}`,
];
const PDF_PATHS = (id: string) => [
  `/api/notas-servico/${encodeURIComponent(id)}/pdf`,
  `/api/notas-servico/${encodeURIComponent(id)}/pdf-nfse`,
  `/api/notas-servico/${encodeURIComponent(id)}/danfse`,
  `/api/notas-servico/${encodeURIComponent(id)}/arquivo-pdf`,
  `/api/notas-servico/${encodeURIComponent(id)}/download-pdf`,
  `/api/notas-servico/pdf/${encodeURIComponent(id)}`,
];

function extractCandidateIds(raw: unknown, chaveAcesso: string): string[] {
  const ids = new Set<string>();
  if (chaveAcesso) ids.add(chaveAcesso);
  const r = raw as Record<string, unknown> | null | undefined;
  if (r && typeof r === "object") {
    for (const k of ["id", "id_nota", "idNota", "nota_id", "notaId", "codigo", "codigo_verificacao"]) {
      const v = r[k];
      if (v != null && (typeof v === "string" || typeof v === "number")) {
        const s = String(v).trim();
        if (s) ids.add(s);
      }
    }
  }
  return Array.from(ids);
}

async function downloadFromMastertax(
  creds: MasterTaxCreds, paths: string[], expectContains: string,
): Promise<{ bytes: Uint8Array; contentType: string } | { error: string }> {
  const errors: string[] = [];
  for (const p of paths) {
    const url = `${creds.base_url}${p}`;
    try {
      const r = await fetch(url, {
        headers: { Authorization: authHeader(creds.token), Accept: "*/*" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) {
        errors.push(`${p} → HTTP ${r.status}`);
        continue;
      }
      const ct = r.headers.get("content-type") || "";
      const buf = new Uint8Array(await r.arrayBuffer());
      // Algumas APIs devolvem JSON com base64 dentro
      if (ct.includes("application/json")) {
        try {
          const j = JSON.parse(new TextDecoder().decode(buf));
          const b64 = j?.arquivo || j?.base64 || j?.xml || j?.pdf || j?.conteudo || j?.data;
          if (typeof b64 === "string" && b64.length > 100) {
            const bin = atob(b64.replace(/\s+/g, ""));
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return { bytes, contentType: expectContains === "xml" ? "application/xml" : "application/pdf" };
          }
        } catch { /* ignore */ }
        errors.push(`${p} → JSON sem campo de arquivo reconhecível`);
        continue;
      }
      if (buf.byteLength < 100) {
        errors.push(`${p} → resposta vazia (${buf.byteLength}b)`);
        continue;
      }
      return { bytes: buf, contentType: ct || (expectContains === "xml" ? "application/xml" : "application/pdf") };
    } catch (e) {
      errors.push(`${p} → ${(e as Error).message}`);
    }
  }
  return { error: errors.join(" | ") };
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

    const candidates = extractCandidateIds(row.raw_mastertax, row.chave_acesso);
    const buildPaths = kind === "xml" ? XML_PATHS : PDF_PATHS;
    const paths = candidates.flatMap((c) => buildPaths(c));
    const dl = await downloadFromMastertax(creds, paths, kind);
    if ("error" in dl) {
      const allNotFound = /HTTP 404/.test(dl.error) && !/HTTP (?!404)\d{3}/.test(dl.error);
      return new Response(
        JSON.stringify({
          error: allNotFound
            ? `${kind.toUpperCase()} indisponível no MasterTax para esta NF.`
            : `Falha ao baixar ${kind.toUpperCase()} (verifique credenciais MasterTax).`,
          code: allNotFound ? "FILE_NOT_FOUND" : "FETCH_FAILED",
          detail: dl.error,
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
