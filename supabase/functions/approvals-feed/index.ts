// Feed único da tela de Aprovações.
//
// Antes, a tela montava o estado com 4+ round-trips pesados:
//   1) expense-read (compras) — varredura em ondas + itens + anexos
//   2) expense-read (vendas)  — idem
//   3) approval_rules (centenas) + approval_rule_levels (milhares)
//   4) aprovações do ERP (SAP/HANA)
//
// Esta função devolve TUDO que a listagem precisa em UMA chamada e já
// resolvida no servidor: pendentes da empresa (compras + vendas) com itens,
// anexos e os aprovadores do nível atual de cada documento — sem trazer a
// matriz inteira para o navegador.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { validateSapSession, requireUser, AuthError } from "../_shared/auth.ts";
import {
  canViewAllDocuments,
  identityMatches,
  personMatches,
  resolveDirectorateBranch,
  costCenterInBranch,
} from "../_shared/permission-groups.ts";
import { resolveCallerAliases } from "../_shared/user-aliases.ts";
import { corsFor, rejectForeignOrigin } from "../_shared/cors-allowlist.ts";

const PENDING = "pendente_aprovacao";

function json(status: number, body: unknown, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function service(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

interface Caller {
  identity: string | null;
  privileged: boolean;
  directorateBranch: string | null;
  aliases: Set<string>;
}

const CALLER_TTL_MS = 300_000;
const callerCache = new Map<string, { expiresAt: number; value: Caller }>();

function callerCacheKey(req: Request): string {
  return [
    req.headers.get("authorization") || "",
    req.headers.get("x-sap-session") || "",
    req.headers.get("x-sap-user") || "",
    req.headers.get("x-company-db") || "",
  ].join("|");
}

async function identifyCaller(req: Request, admin: SupabaseClient): Promise<Caller> {
  let identity: string | null = null;
  let email: string | null = null;
  let userName: string | null = null;
  let id: string | undefined;
  let privileged = false;

  const [cloudUser, sap] = await Promise.all([
    requireUser(req).catch((e) => {
      if (!(e instanceof AuthError)) throw e;
      return null;
    }),
    validateSapSession(req),
  ]);

  if (cloudUser) {
    email = cloudUser.email || null;
    identity = cloudUser.email || null;
    id = cloudUser.id;
  }
  if (sap) {
    userName = sap.userName;
    if (!identity) identity = sap.userName;
    if (sap.userName.toLowerCase() === "manager") privileged = true;
  }

  // Todas as consultas de identidade/permissão em UMA rodada paralela.
  // (Antes eram até 5 idas sequenciais ao banco — ~1,3 s só de autenticação.)
  const [adminRole, sapAdmin, viewAll, branch, aliases] = await Promise.all([
    cloudUser
      ? admin.rpc("has_role", { _user_id: cloudUser.id, _role: "admin" }).then(({ data }) => data === true).catch(() => false)
      : Promise.resolve(false),
    sap
      ? admin
          .rpc("is_sap_user_admin", { _sap_username: sap.userName.toLowerCase() })
          .then(({ data }) => data === true)
          .catch(() => false)
      : Promise.resolve(false),
    identity || email || userName
      ? canViewAllDocuments(admin, [identity, email, userName]).catch(() => false)
      : Promise.resolve(false),
    identity || email || userName
      ? resolveDirectorateBranch(admin, [identity, email, userName]).catch(() => null)
      : Promise.resolve(null),
    resolveCallerAliases(admin, {
      id,
      email: email ?? undefined,
      userName: userName ?? identity ?? undefined,
    }),
  ]);

  privileged = privileged || adminRole || sapAdmin || viewAll;
  const directorateBranch = privileged ? null : branch;

  return { identity, privileged, directorateBranch, aliases };
}

async function identifyCallerCached(req: Request, admin: SupabaseClient): Promise<Caller> {
  const key = callerCacheKey(req);
  const hit = callerCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await identifyCaller(req, admin);
  if (callerCache.size > 500) callerCache.clear();
  callerCache.set(key, { expiresAt: Date.now() + CALLER_TTL_MS, value });
  return value;
}

function ownsExpense(
  row: Record<string, unknown>,
  aliases: Set<string>,
  directorateBranch: string | null,
): boolean {
  if (costCenterInBranch(row.cost_center, directorateBranch)) return true;
  const candidates = [
    row.requester_email,
    row.requester_name,
    row.created_by_email,
    row.current_approver,
    row.original_approver,
  ];
  for (const c of candidates) {
    if (!c) continue;
    for (const alias of aliases) {
      if (identityMatches(c, alias) || personMatches(c, alias)) return true;
    }
  }
  return false;
}

Deno.serve(async (req) => {
  const cors = corsFor(req, "POST, OPTIONS");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const foreign = rejectForeignOrigin(req);
  if (foreign) return foreign;
  if (req.method !== "POST") return json(405, { error: "Método não permitido" }, cors);

  const startedAt = Date.now();
  try {
    const admin = service();
    const body = await req.json().catch(() => ({}));
    const companyDb = typeof body?.company_db === "string" ? body.company_db.trim() : "";
    if (!companyDb) return json(400, { error: "company_db obrigatório" }, cors);

    const tAuth = Date.now();
    const caller = await identifyCallerCached(req, admin);
    const authMs = Date.now() - tAuth;
    if (!caller.identity) {
      return json(401, { error: "Não autenticado. Faça login novamente para carregar as aprovações." }, cors);
    }

    const tQuery = Date.now();
    // Pacote completo em UMA ida ao banco: documentos pendentes + linhas +
    // anexos + aprovadores do nível atual, montados em SQL.
    const { data: bundle, error: bundleErr } = await admin.rpc("approvals_feed_bundle", {
      _company_db: companyDb,
    });
    if (bundleErr) return json(500, { error: bundleErr.message }, cors);

    let docs = (Array.isArray(bundle) ? bundle : []) as Array<Record<string, any>>;

    // Recorte de visibilidade (mesma semântica de `expense-read`), em memória.
    if (!caller.privileged) {
      docs = docs.filter((d) => {
        if (ownsExpense(d, caller.aliases, caller.directorateBranch)) return true;
        if (!caller.directorateBranch) return false;
        return (d.items || []).some((it: Record<string, unknown>) =>
          costCenterInBranch(it.cost_center, caller.directorateBranch),
        );
      });
    }


    return json(
      200,
      {
        docs,
        privileged: caller.privileged,
        directorate_branch: caller.directorateBranch,
        generated_at: new Date().toISOString(),
        took_ms: Date.now() - startedAt,
        timings: { auth_ms: authMs, data_ms: Date.now() - tQuery },
      },
      cors,
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return json(error.status ?? 401, { error: error.message }, cors);
    }
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    return json(500, { error: message }, cors);
  }
});
