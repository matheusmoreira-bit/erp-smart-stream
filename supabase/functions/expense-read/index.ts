// Leitura escopada de despesas (expenses / expense_items / expense_attachments).
//
// Contexto (pentest 2026-07, achado 3.2): as políticas de RLS dessas tabelas
// permitiam SELECT irrestrito para anon/authenticated e o recorte "só vejo o
// que é meu" era aplicado apenas no frontend. Qualquer portador da chave
// pública lia todos os pedidos. Esta função passa a ser o ÚNICO caminho de
// leitura a partir do cliente: autoriza pela sessão SAP (ou JWT admin),
// executa com service role e devolve apenas as linhas permitidas.
//
// Contrato (POST):
// {
//   table: "expenses" | "expense_items" | "expense_attachments",
//   select?: string,
//   filters?: [{ op, column, value }],
//   or?: string,                       // "col.op.value,col.op.value"
//   order?: { column, ascending?, nullsFirst? },
//   limit?: number,
//   range?: [from, to],
//   scope?: "auto" | "all"             // "all" só é honrado para privilegiados
// }

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

const TABLES = new Set(["expenses", "expense_items", "expense_attachments"]);
const OPS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is", "not_is"]);
const IDENT = /^[a-z0-9_]+$/;
const SELECT_RE = /^[a-zA-Z0-9_,\s*()]+$/;
const MAX_ROWS = 2000;

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
  email: string | null;
  userName: string | null;
  id?: string;
  privileged: boolean;
  /** Diretoria (CC de 2º nível) visível ao grupo "Usuário Administrativo". */
  directorateBranch: string | null;
  companyDB: string | null;
  /** Aliases do caller (e-mails/UserCodes equivalentes), resolvidos uma vez. */
  aliases: Set<string>;
}

/**
 * Cache por instância (5 min) da identificação do caller: uma única tela
 * dispara várias chamadas seguidas e cada uma refazia JWT + sessão SAP +
 * grupos + aliases (5 a 7 idas ao banco por requisição).
 */
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
  let companyDB: string | null = null;

  // JWT do Cloud e sessão SAP são independentes: valida os dois em paralelo.
  // A validação SAP tem teto de 8s — com o ERP degradado, a leitura não pode
  // ficar pendurada até o idle timeout (150s) da edge function.
  const sapWithCap = Promise.race([
    validateSapSession(req).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
  ]);
  const [cloudUser, sap] = await Promise.all([
    requireUser(req).catch((e) => {
      if (!(e instanceof AuthError)) throw e;
      return null;
    }),
    sapWithCap,
  ]);

  if (cloudUser) {
    email = cloudUser.email || null;
    identity = cloudUser.email || null;
    id = cloudUser.id;
    const { data } = await admin.rpc("has_role", { _user_id: cloudUser.id, _role: "admin" });
    if (data === true) privileged = true;
  }

  if (sap) {
    userName = sap.userName;
    if (!identity) identity = sap.userName;
    companyDB = sap.companyDB;
    if (!privileged) {
      try {
        const { data: mapped } = await admin.rpc("is_sap_user_admin", {
          _sap_username: sap.userName.toLowerCase(),
        });
        if (mapped === true) privileged = true;
      } catch { /* ignore */ }
      if (!privileged && sap.userName.toLowerCase() === "manager") privileged = true;
    }
  }

  let directorateBranch: string | null = null;
  if (!privileged && (identity || email || userName)) {
    privileged = await canViewAllDocuments(admin, [identity, email, userName]);
    if (!privileged) {
      directorateBranch = await resolveDirectorateBranch(admin, [identity, email, userName]);
    }
  }

  const aliases = await resolveCallerAliases(admin, {
    id,
    email: email ?? undefined,
    userName: userName ?? identity ?? undefined,
  });

  return { identity, email, userName, id, privileged, directorateBranch, companyDB, aliases };
}

async function identifyCallerCached(req: Request, admin: SupabaseClient): Promise<Caller> {
  const key = callerCacheKey(req);
  const hit = callerCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await identifyCaller(req, admin);
  if (callerCache.size > 500) callerCache.clear();
  // Se a sessão SAP não pôde ser comprovada (ERP fora do ar), guarda por pouco
  // tempo para não congelar uma identidade incompleta por 5 minutos.
  const degraded = !!req.headers.get("x-sap-session") && !value.userName;
  callerCache.set(key, {
    expiresAt: Date.now() + (degraded ? 20_000 : CALLER_TTL_MS),
    value,
  });
  return value;
}

/**
 * Regras de aprovação em que o caller aparece como aprovador (por e-mail ou
 * nome). Usado para não depender da string gravada em `current_approver`, que
 * pode divergir do nome real do usuário (ex.: grafia diferente na matriz).
 */
async function approverRuleIds(
  admin: SupabaseClient,
  aliases: Set<string>,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (aliases.size === 0) return out;
  try {
    const { data } = await admin
      .from("approval_rule_levels")
      .select("rule_id, approver_email, approver_name");
    for (const r of (data || []) as any[]) {
      for (const alias of aliases) {
        if (
          identityMatches(r.approver_email, alias) ||
          personMatches(r.approver_email, alias) ||
          identityMatches(r.approver_name, alias) ||
          personMatches(r.approver_name, alias)
        ) {
          out.add(String(r.rule_id));
          break;
        }
      }
    }
  } catch { /* ignore */ }
  return out;
}

/** Uma despesa pertence ao caller quando ele é solicitante, criador ou aprovador. */
function ownsExpense(
  row: Record<string, unknown>,
  aliases: Set<string>,
  directorateBranch: string | null = null,
  approverRules: Set<string> | null = null,
): boolean {
  // Grupo "Usuário Administrativo": tudo da própria diretoria (1.6.x quando o
  // IdP informa 1.6.1.2). Sem CC no IdP, cai na regra de dono abaixo.
  if (costCenterInBranch(row.cost_center, directorateBranch)) return true;
  // Aprovador pela MATRIZ (independe da grafia gravada em current_approver).
  if (
    approverRules &&
    row.approval_rule_id &&
    approverRules.has(String(row.approval_rule_id))
  ) return true;
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
      // `personMatches` cobre o caso em que a coluna guarda o NOME completo
      // ("Andresa De Carvalho") e o caller é o UserCode ("andresa.carvalho").
      if (identityMatches(c, alias) || personMatches(c, alias)) return true;
    }
  }
  return false;
}



/**
 * Ids (dentre os informados) cujas LINHAS pertencem à diretoria — cobre os
 * rateios, em que o CC fica nos itens e não no cabeçalho.
 */
async function directorateItemIds(
  admin: SupabaseClient,
  ids: string[],
  branch: string | null,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (!branch || ids.length === 0) return out;
  const { data } = await admin
    .from("expense_items")
    .select("expense_id, cost_center")
    .in("expense_id", ids.slice(0, 5000));
  for (const r of (data || []) as any[]) {
    if (costCenterInBranch(r.cost_center, branch)) out.add(String(r.expense_id));
  }
  return out;
}

const OWNER_COLUMNS =
  "id, cost_center, requester_email, requester_name, created_by_email, current_approver, original_approver";

function applyFilters(query: any, filters: any[]): { query: any; error?: string } {
  for (const f of filters) {
    const col = String(f?.column ?? "");
    const op = String(f?.op ?? "");
    if (!IDENT.test(col)) return { query, error: `coluna inválida: ${col}` };
    if (!OPS.has(op)) return { query, error: `operador inválido: ${op}` };
    const value = f?.value;
    switch (op) {
      case "in":
        if (!Array.isArray(value)) return { query, error: "in requer array" };
        if (value.length === 0) return { query, error: "__EMPTY_IN__" };
        query = query.in(col, value.slice(0, 5000));
        break;
      case "is":
        query = query.is(col, value === null ? null : value);
        break;
      case "not_is":
        query = query.not(col, "is", value === null ? null : value);
        break;
      default:
        query = (query as any)[op](col, value);
    }
  }
  return { query };
}

const OR_RE = /^[A-Za-zÀ-ÿ0-9_.,%@\-\s:+*'"()]+$/;

Deno.serve(async (req) => {
  const cors = corsFor(req, "POST, OPTIONS");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const foreign = rejectForeignOrigin(req);
  if (foreign) return foreign;
  if (req.method !== "POST") return json(405, { error: "Método não permitido" }, cors);

  try {
    const admin = service();
    const caller = await identifyCallerCached(req, admin);
    if (!caller.identity) {
      console.warn("[expense-read] sem identidade", {
        hasAuthorization: !!req.headers.get("authorization"),
        hasSapSession: !!req.headers.get("x-sap-session"),
        companyDb: req.headers.get("x-company-db"),
        sapUser: req.headers.get("x-sap-user"),
      });
      return json(401, { error: "Não autenticado. Faça login novamente para carregar os documentos." }, cors);
    }


    const body = await req.json().catch(() => ({}));
    const table = String(body?.table ?? "");
    if (!TABLES.has(table)) return json(400, { error: "tabela não permitida" }, cors);

    const select = typeof body?.select === "string" && body.select.trim() ? body.select.trim() : "*";
    if (!SELECT_RE.test(select)) return json(400, { error: "select inválido" }, cors);

    const filters = Array.isArray(body?.filters) ? body.filters.slice(0, 30) : [];
    const limit = Math.min(Number(body?.limit ?? MAX_ROWS) || MAX_ROWS, MAX_ROWS);
    const wantsAll = body?.scope === "all";

    const aliases = caller.aliases;

    const scoped = !(caller.privileged && wantsAll) && !caller.privileged;

    /* ── Tabelas filhas: restringe pelos expense_ids visíveis ── */
    let allowedExpenseIds: string[] | null = null;
    if (scoped && table !== "expenses") {
      const idFilter = filters.find((f: any) => f?.column === "expense_id" && f?.op === "in");
      const ids: string[] = Array.isArray(idFilter?.value) ? idFilter.value : [];
      if (ids.length === 0) return json(200, { data: [] }, cors);
      const { data: parents, error: perr } = await admin
        .from("expenses")
        .select(OWNER_COLUMNS)
        .in("id", ids.slice(0, 5000));
      if (perr) return json(500, { error: perr.message }, cors);
      const byItems = await directorateItemIds(
        admin,
        (parents || []).map((r: any) => String(r.id)),
        caller.directorateBranch,
      );
      allowedExpenseIds = (parents || [])
        .filter((r: any) =>
          ownsExpense(r, aliases, caller.directorateBranch) || byItems.has(String(r.id)),
        )
        .map((r: any) => String(r.id));
      if (allowedExpenseIds.length === 0) return json(200, { data: [] }, cors);
    }

    /* ── Builder reutilizável (mesmos filtros/ordem em cada consulta) ── */
    const usableFilters = filters.filter((f: any) => !(allowedExpenseIds && f?.column === "expense_id"));
    let filterError: string | undefined;

    const orClause = typeof body?.or === "string" && body.or.trim() ? body.or.trim() : null;
    if (orClause && (!OR_RE.test(orClause) || orClause.length > 2000)) {
      return json(400, { error: "cláusula or inválida" }, cors);
    }

    const order = body?.order;
    const orderColumn = order && IDENT.test(String(order.column ?? "")) ? String(order.column) : null;

    const build = (cols: string, opts?: { count?: boolean }) => {
      let q: any = opts?.count
        ? admin.from(table).select(cols, { count: "exact" })
        : admin.from(table).select(cols);
      const applied = applyFilters(q, usableFilters);
      if (applied.error) { filterError = applied.error; return null; }
      q = applied.query;
      if (allowedExpenseIds) q = q.in("expense_id", allowedExpenseIds);
      if (orClause) q = q.or(orClause);
      if (orderColumn) {
        q = q.order(orderColumn, {
          ascending: order.ascending !== false,
          nullsFirst: Boolean(order.nullsFirst),
        });
        // Desempate estável para paginação consistente entre páginas.
        if (orderColumn !== "id") q = q.order("id", { ascending: true });
      }
      return q;
    };

    /* ── Janela solicitada (paginação server-side) ── */
    let rangeFrom: number | null = null;
    let rangeTo: number | null = null;
    if (Array.isArray(body?.range) && body.range.length === 2) {
      rangeFrom = Math.max(0, Number(body.range[0]) || 0);
      rangeTo = Math.max(rangeFrom, Number(body.range[1]) || rangeFrom);
      rangeTo = Math.min(rangeTo, rangeFrom + MAX_ROWS - 1);
    }
    const countRequested = body?.count === true || body?.count === "exact";
    const wantKeys = body?.keys === true && table === "expenses";

    /** Aplica o recorte de propriedade (modo escopado) a um lote de linhas. */
    const filterOwned = async (batch: any[]): Promise<any[]> => {
      if (batch.length === 0) return batch;
      const hasOwnerCols =
        select === "*" ||
        (select.includes("requester_email") &&
          (!caller.directorateBranch || select.includes("cost_center")));
      if (hasOwnerCols) {
        const byItems = await directorateItemIds(
          admin,
          batch.map((r) => String(r.id)).filter(Boolean),
          caller.directorateBranch,
        );
        return batch.filter(
          (r) => ownsExpense(r, aliases, caller.directorateBranch) || byItems.has(String(r.id)),
        );
      }
      const ids = batch.map((r) => r.id).filter(Boolean);
      if (ids.length === 0) return [];
      const { data: owners } = await admin.from("expenses").select(OWNER_COLUMNS).in("id", ids);
      const byItems = await directorateItemIds(admin, ids, caller.directorateBranch);
      const allowed = new Set(
        (owners || [])
          .filter((r: any) =>
            ownsExpense(r, aliases, caller.directorateBranch) || byItems.has(String(r.id)),
          )
          .map((r: any) => String(r.id)),
      );
      return batch.filter((r) => allowed.has(String(r.id)));
    };

    let rows: any[] = [];
    let total: number | null = null;
    let hasMore = false;
    let truncated = false;
    let keySource: any[] | null = null;

    if (scoped && table === "expenses") {
      // O recorte de propriedade é feito em memória, então a janela é montada
      // varrendo a tabela em blocos até preencher a página pedida.
      // As varreduras vão em ONDAS PARALELAS: antes eram até 20 consultas
      // sequenciais (+1 por bloco para os rateios), o que fazia a tela de
      // aprovações esperar dezenas de segundos.
      const CHUNK = 500;
      const WAVE = 4;
      const SCAN_CAP = MAX_ROWS * 5;
      const need = rangeTo != null ? rangeTo + 1 : limit;
      let page = 0;
      let scanned = 0;
      let exhausted = false;
      const collected: any[] = [];
      while (
        !exhausted &&
        (collected.length < need || countRequested || wantKeys) &&
        scanned < SCAN_CAP
      ) {
        const pages: number[] = [];
        for (let i = 0; i < WAVE; i++) pages.push(page + i);
        page += WAVE;
        const results = await Promise.all(
          pages.map(async (p) => {
            const q = build(select);
            if (!q) return { data: [] as any[], error: null };
            return await q.range(p * CHUNK, p * CHUNK + CHUNK - 1);
          }),
        );
        const flat: any[] = [];
        for (const r of results as any[]) {
          if (r?.error) return json(500, { error: r.error.message }, cors);
          const batch = (r?.data || []) as any[];
          scanned += batch.length;
          flat.push(...batch);
          if (batch.length < CHUNK) exhausted = true;
        }
        if (flat.length === 0) { exhausted = true; break; }
        // Um único lookup de rateio por onda (em vez de um por bloco).
        collected.push(...(await filterOwned(flat)));
      }
      if (filterError === "__EMPTY_IN__") return json(200, { data: [], count: 0 }, cors);
      if (filterError) return json(400, { error: filterError }, cors);
      truncated = !exhausted;
      total = exhausted ? collected.length : null;
      keySource = collected;
      rows = rangeFrom != null
        ? collected.slice(rangeFrom, (rangeTo as number) + 1)
        : collected.slice(0, limit);
      hasMore = !exhausted || collected.length > need;
    } else {

      const q = build(select, { count: countRequested });
      if (filterError === "__EMPTY_IN__") return json(200, { data: [], count: 0 }, cors);
      if (filterError || !q) return json(400, { error: filterError || "consulta inválida" }, cors);
      const windowed = rangeFrom != null
        ? q.range(rangeFrom, rangeTo as number)
        : q.limit(limit);
      const { data, error, count } = await windowed;
      if (error) return json(500, { error: error.message }, cors);
      rows = (data || []) as any[];
      total = typeof count === "number" ? count : null;
      const consumed = (rangeFrom ?? 0) + rows.length;
      hasMore = total != null ? consumed < total : rows.length >= (rangeTo != null ? rangeTo - rangeFrom! + 1 : limit);
    }

    /* ── Chaves ERP de todo o conjunto filtrado (dedup ERP Flow × ERP) ── */
    let keys: Array<{ company_db: string | null; sap_doc_entry: number | null; sap_doc_num: number | null }> | undefined;
    if (wantKeys) {
      if (keySource) {
        keys = keySource.map((r: any) => ({
          company_db: r.company_db ?? null,
          sap_doc_entry: r.sap_doc_entry ?? null,
          sap_doc_num: r.sap_doc_num ?? null,
        }));
      } else {
        const kq = build("company_db, sap_doc_entry, sap_doc_num");
        if (kq) {
          const { data: kdata } = await kq.limit(MAX_ROWS * 5);
          keys = ((kdata || []) as any[]).map((r) => ({
            company_db: r.company_db ?? null,
            sap_doc_entry: r.sap_doc_entry ?? null,
            sap_doc_num: r.sap_doc_num ?? null,
          }));
        }
      }
      keys = (keys || []).filter((k) => k.sap_doc_entry != null || k.sap_doc_num != null);
    }


    // Filhos na mesma chamada (evita 2 round-trips extras por tela).
    let children: Record<string, any[]> | undefined;
    if (table === "expenses" && Array.isArray(body?.include) && body.include.length) {
      const ids = rows.map((r: any) => r.id).filter(Boolean).slice(0, 5000);
      const want = new Set(body.include.map((v: unknown) => String(v)));
      children = {};
      if (ids.length) {
        const [items, atts] = await Promise.all([
          want.has("items")
            ? admin.from("expense_items").select("*").in("expense_id", ids)
            : Promise.resolve({ data: null }),
          want.has("attachments")
            ? admin.from("expense_attachments").select("*").in("expense_id", ids)
            : Promise.resolve({ data: null }),
        ]);
        if (want.has("items")) children.items = (items as any).data || [];
        if (want.has("attachments")) children.attachments = (atts as any).data || [];
      } else {
        if (want.has("items")) children.items = [];
        if (want.has("attachments")) children.attachments = [];
      }
    }

    return json(
      200,
      {
        data: rows,
        ...(children || {}),
        ...(keys ? { keys } : {}),
        count: total,
        hasMore,
        truncated,
        scoped,
        privileged: caller.privileged,
        directorate: caller.directorateBranch,
      },
      cors,
    );

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[expense-read] erro", msg);
    return json(500, { error: msg }, cors);
  }
});
