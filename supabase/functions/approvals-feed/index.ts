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
  personListMatches,
  resolveDirectorateBranch,
  costCenterInBranch,
} from "../_shared/permission-groups.ts";
import { resolveCallerAliases } from "../_shared/user-aliases.ts";
import { corsFor, rejectForeignOrigin } from "../_shared/cors-allowlist.ts";
import {
  approvalSegmentBelongsToAliases,
  scopeApprovalDocumentToSegments,
  type ApprovalSegmentVisibilityRow,
} from "../_shared/approval-segment-visibility.ts";


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
  /**
   * `true` quando alguma consulta de permissão/identidade falhou. Um caller
   * degradado NUNCA é cacheado (nem em memória, nem no cache compartilhado):
   * caso contrário uma falha momentânea de banco escondia a fila do aprovador
   * por até 10 minutos — o sintoma de "a aprovação aparece e some".
   */
  degraded?: boolean;
}


let authPhaseTimings: Record<string, number> = {};

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

  const tIdent = Date.now();
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

  const tWave = Date.now();
  let degraded = false;
  const flag = <T>(fallback: T) => (): T => {
    degraded = true;
    return fallback;
  };
  // Todas as consultas de identidade/permissão em UMA rodada paralela.
  // (Antes eram até 5 idas sequenciais ao banco — ~1,3 s só de autenticação.)
  const [adminRole, sapAdmin, viewAll, branch, aliases] = await Promise.all([
    cloudUser
      ? admin.rpc("has_role", { _user_id: cloudUser.id, _role: "admin" }).then(({ data }) => data === true).catch(flag(false))
      : Promise.resolve(false),
    sap
      ? admin
          .rpc("is_sap_user_admin", { _sap_username: sap.userName.toLowerCase() })
          .then(({ data }) => data === true)
          .catch(flag(false))
      : Promise.resolve(false),
    identity || email || userName
      ? canViewAllDocuments(admin, [identity, email, userName]).catch(flag(false))
      : Promise.resolve(false),
    identity || email || userName
      ? resolveDirectorateBranch(admin, [identity, email, userName]).catch(flag(null as string | null))
      : Promise.resolve(null),
    resolveCallerAliases(admin, {
      id,
      email: email ?? undefined,
      userName: userName ?? identity ?? undefined,
    }).catch(flag(new Set<string>())),
  ]);

  authPhaseTimings = { identify_ms: tWave - tIdent, perms_ms: Date.now() - tWave };
  privileged = privileged || adminRole || sapAdmin || viewAll;
  const directorateBranch = privileged ? null : branch;

  return { identity, privileged, directorateBranch, aliases, degraded };
}


/**
 * Cache em dois níveis:
 *  1. memória do isolate (5 min) — custo zero;
 *  2. `public.auth_caller_cache` (10 min) — compartilhado entre isolates, o
 *     que evita que todo cold start pague ~1,2 s de resolução de permissões.
 * A identidade em si (JWT/sessão SAP) continua sendo validada a cada chamada.
 */
const SHARED_TTL_MS = 600_000;

async function identifyCallerCached(req: Request, admin: SupabaseClient): Promise<Caller> {
  const key = callerCacheKey(req);
  const hit = callerCache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    authPhaseTimings = { cache: 1 };
    return hit.value;
  }

  const memoize = (value: Caller) => {
    if (callerCache.size > 500) callerCache.clear();
    callerCache.set(key, { expiresAt: Date.now() + CALLER_TTL_MS, value });
    return value;
  };

  // Identidade primeiro (barata, ~50 ms) — o cache compartilhado é indexado
  // por ela, nunca pelo token bruto.
  const tIdent = Date.now();
  const [cloudUser, sap] = await Promise.all([
    requireUser(req).catch((e) => {
      if (!(e instanceof AuthError)) throw e;
      return null;
    }),
    validateSapSession(req),
  ]);
  const identity = cloudUser?.email || sap?.userName || null;
  const identMs = Date.now() - tIdent;
  if (!identity) return { identity: null, privileged: false, directorateBranch: null, aliases: new Set() };

  const sharedKey = `approvals-feed|${identity.toLowerCase()}`;
  const tShared = Date.now();
  const { data: cached } = await admin
    .from("auth_caller_cache")
    .select("payload, expires_at")
    .eq("cache_key", sharedKey)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (cached?.payload) {
    const p = cached.payload as { privileged?: boolean; directorateBranch?: string | null; aliases?: string[] };
    authPhaseTimings = { identify_ms: identMs, shared_cache_ms: Date.now() - tShared };
    return memoize({
      identity,
      privileged: !!p.privileged,
      directorateBranch: p.directorateBranch ?? null,
      aliases: new Set(p.aliases || []),
    });
  }

  const value = await identifyCaller(req, admin);
  authPhaseTimings = { ...authPhaseTimings, identify_ms: identMs };
  // Resultado degradado (alguma consulta de permissão falhou) não vira cache:
  // seria congelar por 10 min uma visibilidade menor do que a real.
  if (value.degraded) return value;
  if (value.identity) {
    admin
      .from("auth_caller_cache")
      .upsert({
        cache_key: sharedKey,
        payload: {
          privileged: value.privileged,
          directorateBranch: value.directorateBranch,
          aliases: Array.from(value.aliases),
        },
        expires_at: new Date(Date.now() + SHARED_TTL_MS).toISOString(),
      })
      .then(() => {}, () => {});
  }
  return memoize(value);
}


/**
 * Titulares que o caller substitui hoje (grant vigente e não revogado).
 * Sem isso, o substituto ativo não via NENHUM documento da fila do titular.
 */
async function substituteOfficialAliases(
  admin: SupabaseClient,
  aliases: Set<string>,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (aliases.size === 0) return out;
  try {
    const nowIso = new Date().toISOString();
    const { data } = await admin
      .from("approver_substitutes")
      .select("official_email, official_name, substitute_email, substitute_name")
      .is("revoked_at", null)
      .lte("starts_at", nowIso)
      .gte("ends_at", nowIso);
    for (const r of (data || []) as any[]) {
      const isMine = Array.from(aliases).some((alias) =>
        identityMatches(r.substitute_email, alias) ||
        personListMatches(r.substitute_email, alias) ||
        identityMatches(r.substitute_name, alias) ||
        personListMatches(r.substitute_name, alias),
      );
      if (!isMine) continue;
      const email = String(r.official_email || "").toLowerCase();
      if (email) {
        out.add(email);
        const prefix = email.split("@")[0];
        if (prefix) out.add(prefix);
      }
      if (r.official_name) out.add(String(r.official_name).toLowerCase());
    }
  } catch { /* ignore */ }
  return out;
}

function levelApproverCandidates(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    return [row.name, row.email].filter(Boolean);
  });
}

function ownsExpense(
  row: Record<string, unknown>,
  aliases: Set<string>,
  directorateBranch: string | null,
  substituteAliases?: Set<string> | null,
): boolean {
  if (costCenterInBranch(row.cost_center, directorateBranch)) return true;
  const levelCandidates = levelApproverCandidates(row.level_approvers);
  const candidates = [
    row.requester_email,
    row.requester_name,
    row.created_by_email,
    row.current_approver,
    row.original_approver,
    ...levelCandidates,
  ];
  for (const c of candidates) {
    if (!c) continue;
    for (const alias of aliases) {
      if (identityMatches(c, alias) || personListMatches(c, alias)) return true;
    }
  }
  // Substituto ativo: herda apenas a fila de aprovação do titular.
  if (substituteAliases && substituteAliases.size > 0) {
    for (const c of [row.current_approver, row.original_approver, ...levelCandidates]) {
      if (!c) continue;
      for (const alias of substituteAliases) {
        if (identityMatches(c, alias) || personListMatches(c, alias)) return true;
      }
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

    // Dados e identidade são independentes: buscamos os dois EM PARALELO e o
    // recorte de visibilidade é aplicado depois, em memória. O tempo total
    // passa a ser o do mais lento, e não a soma dos dois.
    const tAuth = Date.now();
    // `.then()` força o início imediato: os builders do supabase-js são lazy.
    const bundlePromise = admin.rpc("approvals_feed_bundle", { _company_db: companyDb }).then((r) => r);
    const caller = await identifyCallerCached(req, admin);
    const authMs = Date.now() - tAuth;
    if (!caller.identity) {
      return json(401, { error: "Não autenticado. Faça login novamente para carregar as aprovações." }, cors);
    }

    const tQuery = Date.now();
    const { data: bundle, error: bundleErr } = await bundlePromise;
    if (bundleErr) return json(500, { error: bundleErr.message }, cors);

    let docs = (Array.isArray(bundle) ? bundle : []) as Array<Record<string, any>>;

    // Recorte de visibilidade (mesma semântica de `expense-read`), em memória.
    let substituteAliases = new Set<string>();
    if (!caller.privileged) {
      substituteAliases = await substituteOfficialAliases(admin, caller.aliases);
      docs = docs.filter((d) => {
        if (ownsExpense(d, caller.aliases, caller.directorateBranch, substituteAliases)) return true;
        if (!caller.directorateBranch) return false;
        return (d.items || []).some((it: Record<string, unknown>) =>
          costCenterInBranch(it.cost_center, caller.directorateBranch),
        );
      });
    }

    // As trilhas persistidas sao a fonte de verdade do rateio. Para callers
    // comuns, cada documento e recortado antes de sair da funcao: valores,
    // itens, CCs, projetos e cadeias de outras ramificacoes nao chegam ao
    // navegador. Um administrador que nao participa de nenhuma trilha ainda
    // preserva a visao operacional integral.
    const expenseIds = docs.map((doc) => String(doc.id || "")).filter(Boolean);
    if (expenseIds.length > 0) {
      const { data: segmentData, error: segmentError } = await admin
        .from("expense_approval_segments")
        .select("*")
        .in("expense_id", expenseIds);
      if (segmentError) return json(500, { error: segmentError.message }, cors);

      const segmentsByExpense = new Map<string, ApprovalSegmentVisibilityRow[]>();
      for (const row of (segmentData || []) as ApprovalSegmentVisibilityRow[]) {
        const expenseId = String(row.expense_id || "");
        if (!segmentsByExpense.has(expenseId)) segmentsByExpense.set(expenseId, []);
        segmentsByExpense.get(expenseId)!.push(row);
      }

      const effectiveAliases = new Set([...caller.aliases, ...substituteAliases]);
      docs = docs.map((doc) => {
        const segments = segmentsByExpense.get(String(doc.id || "")) || [];
        return scopeApprovalDocumentToSegments(
          doc,
          segments,
          (segment) => approvalSegmentBelongsToAliases(
            segment,
            effectiveAliases,
            (candidate, alias) =>
              identityMatches(candidate, alias) ||
              personMatches(candidate, alias) ||
              personListMatches(candidate, alias),
          ),
        );
      });
    }


    return json(
      200,
      {
        docs,
        privileged: caller.privileged,
        directorate_branch: caller.directorateBranch,
        // O cliente usa isto para NÃO substituir uma lista boa por uma
        // resposta calculada com permissões incompletas.
        degraded: !!caller.degraded,
        generated_at: new Date().toISOString(),
        took_ms: Date.now() - startedAt,
        timings: { auth_ms: authMs, data_ms: Date.now() - tQuery, ...authPhaseTimings },
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
