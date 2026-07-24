// Helper para listagem de usuários SAP com preferência por HanaAPI V2 (VW_USERS),
// e fallback ao Service Layer quando (a) a empresa não tem HanaAPI habilitada,
// (b) a chamada HANA falha, ou (c) o consumidor exige `MobilePhoneNumber` e a
// VW_USERS local da empresa não expõe esse campo.
//
// Uso típico em edge functions que hoje batem em `/Users?$select=...` no SL:
//
//   const users = await listSapUsersHybrid({
//     sb, companyDb, baseUrl, sapSession, needsPhone: true,
//   });
//
// O helper cuida da paginação do OData e da normalização dos campos vindos da
// HANA (que podem chegar em snake_case/upper_case).

import { fetchHanaView, loadHanaCreds, resolveHanaSchema } from "./hana-views.ts";

export interface SapUserRecord {
  UserCode: string;
  UserName?: string;
  eMail?: string;
  MobilePhoneNumber?: string;
  Locked?: string;
}

function pickStr(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return undefined;
}

function normalizeHanaRow(row: Record<string, unknown>): SapUserRecord {
  const lockedRaw = row.Locked ?? row.LOCKED ?? row.locked;
  const locked = lockedRaw === "tYES" || lockedRaw === "Y" || lockedRaw === 1 ||
      lockedRaw === "1" || lockedRaw === true
    ? "tYES" : "tNO";
  return {
    UserCode: pickStr(row.UserCode, row.USER_CODE, row.user_code) ?? "",
    UserName: pickStr(row.UserName, row.U_NAME, row.u_name),
    eMail: pickStr(row.eMail, row.E_Mail, row.EMAIL, row.email),
    MobilePhoneNumber: pickStr(
      row.MobilePhoneNumber,
      row.MOBILE_PHONE_NUMBER,
      row.MOBIL_PHONE,
      row.MobilePhone,
      row.MOBILEPHONE,
      row.mobile_phone,
    ),
    Locked: locked,
  };
}

// Detecta se a VW_USERS da empresa expõe algum campo compatível com telefone.
// Se nenhuma linha tiver a chave presente (mesmo que vazia), assumimos que a
// view não expõe o campo e caímos para o Service Layer.
function hanaExposesPhoneField(rows: Record<string, unknown>[]): boolean {
  const keys = [
    "MobilePhoneNumber", "MOBILE_PHONE_NUMBER", "MOBIL_PHONE",
    "MobilePhone", "MOBILEPHONE", "mobile_phone",
  ];
  for (const r of rows.slice(0, 5)) {
    for (const k of keys) if (k in r) return true;
  }
  return false;
}

async function tryHana(
  sb: { from: (t: string) => any },
  companyDb: string,
  sessionId: string,
  database: string | null,
  needsPhone: boolean,
): Promise<SapUserRecord[] | null> {
  const hana = await loadHanaCreds(sb, companyDb);
  if (!hana) return null;
  try {
    const rows = await fetchHanaView({
      schema: resolveHanaSchema(companyDb, database),
      view: "VW_USERS",
      sessionId,
      hanaApiUrl: hana.hana_api_url || null,
    });
    if (!rows.length) return null;
    if (needsPhone && !hanaExposesPhoneField(rows)) {
      console.log(`[sap-users-hybrid] VW_USERS de ${companyDb} não expõe telefone → SL fallback`);
      return null;
    }
    const mapped = rows.map(normalizeHanaRow).filter((u) => u.UserCode);
    return mapped.length ? mapped : null;
  } catch (e) {
    console.warn(
      `[sap-users-hybrid] HANA VW_USERS falhou (${companyDb}):`,
      (e as Error).message,
    );
    return null;
  }
}

async function fetchViaServiceLayer(
  baseUrl: string,
  s: { sessionId: string; routeId?: string },
  needsPhone: boolean,
): Promise<SapUserRecord[]> {
  const select = needsPhone
    ? "UserCode,UserName,eMail,MobilePhoneNumber,Locked"
    : "UserCode,UserName,eMail,Locked";
  const all: SapUserRecord[] = [];
  const pageSize = 200;
  let skip = 0;
  const cookie = `B1SESSION=${s.sessionId}${s.routeId ? `; B1ROUTEID=${s.routeId}` : ""}`;
  for (let page = 0; page < 100; page++) {
    const url = `${baseUrl}/Users?$select=${select}&$top=${pageSize}&$skip=${skip}`;
    const resp = await fetch(url, {
      headers: { Cookie: cookie, Prefer: `odata.maxpagesize=${pageSize}` },
    });
    if (!resp.ok) {
      if (page === 0) {
        throw new Error(`Service Layer Users falhou: ${resp.status} ${await resp.text().catch(() => "")}`);
      }
      break;
    }
    const json = await resp.json().catch(() => null);
    const rows: SapUserRecord[] = (json?.value || []) as SapUserRecord[];
    all.push(...rows);
    if (rows.length < pageSize) break;
    skip += pageSize;
  }
  return all;
}

export interface ListSapUsersHybridOpts {
  sb: { from: (t: string) => any };
  companyDb: string;
  baseUrl: string;
  sapSession: { sessionId: string; routeId?: string };
  /** Nome do banco HANA (quando conhecido). Usado no override de schema. */
  database?: string | null;
  /** Se true, exige MobilePhoneNumber — cai no SL caso a HANA não exponha. */
  needsPhone?: boolean;
}

export async function listSapUsersHybrid(opts: ListSapUsersHybridOpts): Promise<{
  users: SapUserRecord[];
  source: "hana" | "service_layer";
}> {
  const hana = await tryHana(
    opts.sb,
    opts.companyDb,
    opts.sapSession.sessionId,
    opts.database ?? null,
    !!opts.needsPhone,
  );
  if (hana && hana.length) return { users: hana, source: "hana" };
  const sl = await fetchViaServiceLayer(opts.baseUrl, opts.sapSession, !!opts.needsPhone);
  return { users: sl, source: "service_layer" };
}

/**
 * Variante para lookup de um único usuário por UserCode e/ou e-mail. Retorna a
 * primeira ocorrência, priorizando match exato de UserCode.
 */
export async function findSapUserHybrid(
  opts: ListSapUsersHybridOpts & { userCode?: string | null; email?: string | null },
): Promise<SapUserRecord | null> {
  const code = (opts.userCode || "").trim().toLowerCase();
  const email = (opts.email || "").trim().toLowerCase();
  if (!code && !email) return null;
  const { users } = await listSapUsersHybrid(opts);
  const byCode = code ? users.find((u) => (u.UserCode || "").toLowerCase() === code) : undefined;
  if (byCode) return byCode;
  const byEmail = email ? users.find((u) => (u.eMail || "").toLowerCase() === email) : undefined;
  return byEmail || null;
}
