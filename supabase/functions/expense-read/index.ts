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
}

async function identifyCaller(req: Request, admin: SupabaseClient): Promise<Caller> {
  let identity: string | null = null;
  let email: string | null = null;
  let userName: string | null = null;
  let id: string | undefined;
  let privileged = false;
  let companyDB: string | null = null;

  try {
    const u = await requireUser(req);
    email = u.email || null;
    identity = u.email || null;
    id = u.id;
    const { data } = await admin.rpc("has_role", { _user_id: u.id, _role: "admin" });
    if (data === true) privileged = true;
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
  }

  const sap = await validateSapSession(req);
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

  return { identity, email, userName, id, privileged, directorateBranch, companyDB };
}

/** Uma despesa pertence ao caller quando ele é solicitante, criador ou aprovador. */
function ownsExpense(
  row: Record<string, unknown>,
  aliases: Set<string>,
  directorateBranch: string | null = null,
): boolean {
  // Grupo "Usuário Administrativo": tudo da própria diretoria (1.6.x quando o
  // IdP informa 1.6.1.2). Sem CC no IdP, cai na regra de dono abaixo.
  if (costCenterInBranch(row.cost_center, directorateBranch)) return true;
  const candidates = [
    row.requester_email,
    row.requester_name,
    row.created_by_email,
    row.current_approver,
    row.current_approver_email,
    row.original_approver,
  ];
  for (const c of candidates) {
    if (!c) continue;
    for (const alias of aliases) {
      if (identityMatches(c, alias)) return true;
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
  "id, cost_center, requester_email, requester_name, created_by_email, current_approver, current_approver_email, original_approver";

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

const OR_RE = /^[A-Za-z0-9_.,%@\-\s:+*'"]+$/;

Deno.serve(async (req) => {
  const cors = corsFor(req, "POST, OPTIONS");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const foreign = rejectForeignOrigin(req);
  if (foreign) return foreign;
  if (req.method !== "POST") return json(405, { error: "Método não permitido" }, cors);

  try {
    const admin = service();
    const caller = await identifyCaller(req, admin);
    if (!caller.identity) return json(401, { error: "Não autenticado" }, cors);

    const body = await req.json().catch(() => ({}));
    const table = String(body?.table ?? "");
    if (!TABLES.has(table)) return json(400, { error: "tabela não permitida" }, cors);

    const select = typeof body?.select === "string" && body.select.trim() ? body.select.trim() : "*";
    if (!SELECT_RE.test(select)) return json(400, { error: "select inválido" }, cors);

    const filters = Array.isArray(body?.filters) ? body.filters.slice(0, 30) : [];
    const limit = Math.min(Number(body?.limit ?? MAX_ROWS) || MAX_ROWS, MAX_ROWS);
    const wantsAll = body?.scope === "all";

    const aliases = await resolveCallerAliases(admin, {
      id: caller.id,
      email: caller.email ?? undefined,
      userName: caller.userName ?? caller.identity ?? undefined,
    });

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

    let query: any = admin.from(table).select(select);

    const applied = applyFilters(query, filters.filter((f: any) =>
      !(allowedExpenseIds && f?.column === "expense_id")
    ));
    if (applied.error === "__EMPTY_IN__") return json(200, { data: [] }, cors);
    if (applied.error) return json(400, { error: applied.error }, cors);
    query = applied.query;

    if (allowedExpenseIds) query = query.in("expense_id", allowedExpenseIds);

    if (typeof body?.or === "string" && body.or.trim()) {
      const orClause = body.or.trim();
      if (!OR_RE.test(orClause) || orClause.length > 2000) {
        return json(400, { error: "cláusula or inválida" }, cors);
      }
      query = query.or(orClause);
    }

    const order = body?.order;
    if (order && IDENT.test(String(order.column ?? ""))) {
      query = query.order(String(order.column), {
        ascending: order.ascending !== false,
        nullsFirst: Boolean(order.nullsFirst),
      });
    }

    if (Array.isArray(body?.range) && body.range.length === 2) {
      const from = Math.max(0, Number(body.range[0]) || 0);
      const to = Math.max(from, Number(body.range[1]) || from);
      query = query.range(from, Math.min(to, from + MAX_ROWS - 1));
    } else {
      // Sobre-busca no modo escopado: o recorte fino é feito em memória.
      query = query.limit(scoped && table === "expenses" ? MAX_ROWS : limit);
    }

    const { data, error } = await query;
    if (error) return json(500, { error: error.message }, cors);

    let rows: any[] = data || [];

    if (scoped && table === "expenses") {
      // Se o select do cliente não trouxe as colunas de dono, resolvemos os
      // donos em uma segunda consulta para não vazar linhas alheias.
      const hasOwnerCols =
        select === "*" ||
        (select.includes("requester_email") &&
          (!caller.directorateBranch || select.includes("cost_center")));
      if (hasOwnerCols) {
        const byItems = await directorateItemIds(
          admin,
          rows.map((r) => String(r.id)).filter(Boolean),
          caller.directorateBranch,
        );
        rows = rows.filter(
          (r) => ownsExpense(r, aliases, caller.directorateBranch) || byItems.has(String(r.id)),
        );
      } else {
        const ids = rows.map((r) => r.id).filter(Boolean);
        if (ids.length === 0) return json(200, { data: [] }, cors);
        const { data: owners } = await admin
          .from("expenses")
          .select(OWNER_COLUMNS)
          .in("id", ids);
        const byItems = await directorateItemIds(admin, ids, caller.directorateBranch);
        const allowed = new Set(
          (owners || [])
            .filter((r: any) =>
              ownsExpense(r, aliases, caller.directorateBranch) || byItems.has(String(r.id)),
            )
            .map((r: any) => String(r.id)),
        );
        rows = rows.filter((r) => allowed.has(String(r.id)));
      }
      rows = rows.slice(0, limit);
    }

    return json(
      200,
      { data: rows, scoped, privileged: caller.privileged, directorate: caller.directorateBranch },
      cors,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[expense-read] erro", msg);
    return json(500, { error: msg }, cors);
  }
});
