import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders as baseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  authErrorResponse,
  requireUserOrSapSession,
} from "../_shared/auth.ts";
import {
  fetchMasterTaxPdf,
  masterTaxAuthHeader,
  type MasterTaxFileCredentials,
} from "../_shared/mastertax-files.ts";

const corsHeaders = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db, x-sap-auth-token",
};
const DEFAULT_BASE_URL = "https://api.mastertax.app";
const PDF_BUCKET = "nfse-pdfs";
const COMPANY_DB_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ACCESS_KEY_RE = /^\d{50}$/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeAccessKey(value: unknown): string {
  return String(value || "").replace(/\D/g, "");
}

function parseEmpresaIds(value: string): string[] {
  return value.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean);
}

async function loadCredentials(
  // Supabase JS changed its generic arity between the versions used by the
  // shared auth module and this function. Keep this boundary structural.
  // deno-lint-ignore no-explicit-any
  supabase: any,
  companyDb: string,
): Promise<{ credentials: MasterTaxFileCredentials; empresaIds: string[] } | null> {
  const { data, error } = await supabase
    .from("system_credentials")
    .select("company_db, credential_key, credential_value")
    .eq("system_name", "mastertax");
  if (error) throw error;

  const grouped = new Map<string, Record<string, string>>();
  const rows = (data || []) as Array<{
    company_db: string | null;
    credential_key: string;
    credential_value: string | null;
  }>;
  for (const row of rows) {
    const key = row.company_db || "_global";
    const values = grouped.get(key) || {};
    values[row.credential_key] = row.credential_value || "";
    grouped.set(key, values);
  }
  const values = grouped.get(companyDb) || grouped.get("_global");
  if (!values?.token || !values?.empresa_id) return null;
  return {
    credentials: {
      base_url: (values.base_url || DEFAULT_BASE_URL).trim().replace(/\/+$/, ""),
      token: values.token.trim(),
    },
    empresaIds: parseEmpresaIds(values.empresa_id),
  };
}

async function findMasterTaxId(
  credentials: MasterTaxFileCredentials,
  empresaIds: string[],
  accessKey: string,
): Promise<string | null> {
  for (const empresaId of empresaIds) {
    const params = new URLSearchParams({
      empresa_id: empresaId,
      chave: accessKey,
      tipo: "Prestador",
      pagina: "1",
      quantidade: "10",
    });
    const response = await fetch(`${credentials.base_url}/api/notas-servico?${params}`, {
      headers: {
        Authorization: masterTaxAuthHeader(credentials.token),
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text().catch(() => "");
    if (!response.ok) {
      throw new Error(`MasterTax notas-servico falhou [${response.status}]: ${text.slice(0, 200)}`);
    }
    let payload: unknown = null;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("MasterTax retornou JSON inválido em notas-servico.");
    }
    const body = payload as Record<string, unknown>;
    const retorno = (body.retorno || body) as Record<string, unknown>;
    const rows = Array.isArray(retorno.data)
      ? retorno.data
      : Array.isArray(retorno.notas)
        ? retorno.notas
        : Array.isArray(body.data)
          ? body.data
          : [];
    const match = rows.find((row) => {
      const record = row as Record<string, unknown>;
      return normalizeAccessKey(record.chave || record.chave_acesso || record.chaveAcesso) === accessKey;
    }) as Record<string, unknown> | undefined;
    if (match?.id != null && String(match.id).trim()) return String(match.id).trim();
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = await requireUserOrSapSession(req) as {
      id?: string;
      email: string | null;
      source?: "sap_session";
      companyDB?: string;
    };
    const body = await req.json().catch(() => ({}));
    const companyDb = String(body?.company_db || "").trim();
    const accessKey = normalizeAccessKey(body?.fiscal_doc_key);
    const invoiceDocEntry = Number(body?.invoice_doc_entry);

    if (!COMPANY_DB_RE.test(companyDb)) return json({ error: "company_db inválido" }, 400);
    const isSapSession = "source" in auth && auth.source === "sap_session";
    if (isSapSession && auth.companyDB !== companyDb) {
      return json({ error: "A sessão SAP não pertence à empresa informada." }, 403);
    }
    if (!ACCESS_KEY_RE.test(accessKey)) return json({ error: "Chave de acesso da NFS-e inválida" }, 400);
    if (!Number.isInteger(invoiceDocEntry) || invoiceDocEntry <= 0) {
      return json({ error: "invoice_doc_entry inválido" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    if (!isSapSession) {
      if (!auth.email) return json({ error: "Sessão sem e-mail." }, 401);
      // Regra única de acesso à empresa: admin entra em qualquer base;
      // os demais dependem da allowlist da empresa.
      let allowedAccess = false;
      if (auth.id) {
        const { data: isAdmin } = await supabase.rpc("has_role", {
          _user_id: auth.id,
          _role: "admin",
        });
        allowedAccess = isAdmin === true;
      }
      if (!allowedAccess) {
        const { data: allowed, error: accessError } = await supabase.rpc(
          "is_email_allowed_for_company",
          { _email: auth.email, _company_db: companyDb },
        );
        if (accessError) return json({ error: "Falha ao validar acesso à empresa." }, 500);
        allowedAccess = allowed === true;
      }
      if (!allowedAccess) return json({ error: "Usuário sem acesso a esta empresa." }, 403);
    }


    const config = await loadCredentials(supabase, companyDb);
    if (!config) return json({ error: "Credenciais MasterTax ausentes para esta empresa" }, 400);

    const masterTaxId = await findMasterTaxId(config.credentials, config.empresaIds, accessKey);
    if (!masterTaxId) {
      return json({
        error: "NFS-e emitida ainda não foi capturada pela MasterTax.",
        code: "MASTER_TAX_NFSE_NOT_FOUND",
      }, 404);
    }

    const pdf = await fetchMasterTaxPdf(config.credentials, masterTaxId);
    if ("error" in pdf) {
      return json({ error: `Falha ao baixar DANFSe da MasterTax: ${pdf.error}` }, 502);
    }

    const storagePath = `${companyDb}/${invoiceDocEntry}.pdf`;
    const { error: uploadError } = await supabase.storage.from(PDF_BUCKET).upload(
      storagePath,
      pdf.bytes,
      { contentType: pdf.contentType, upsert: true },
    );
    if (uploadError) return json({ error: `Falha ao armazenar DANFSe: ${uploadError.message}` }, 500);

    const { data: signed, error: signedError } = await supabase.storage
      .from(PDF_BUCKET)
      .createSignedUrl(storagePath, 300);
    if (signedError || !signed?.signedUrl) {
      return json({ error: `Falha ao abrir DANFSe: ${signedError?.message || "URL ausente"}` }, 500);
    }

    return json({
      ok: true,
      url: signed.signedUrl,
      path: storagePath,
      mastertax_id: masterTaxId,
    });
  } catch (error) {
    const authResponse = authErrorResponse(error, corsHeaders);
    if (authResponse) return authResponse;
    console.error("sales-nfse-mastertax-file error", error);
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});
