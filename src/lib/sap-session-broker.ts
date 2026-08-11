/**
 * Broker de sessão do SAP Service Layer.
 *
 * O login do app é feito pelo Google (identidade Lovable Cloud). A sessão do
 * Service Layer deixou de ser um pré-requisito da entrada no sistema: ela é
 * criada sob demanda, apenas quando alguma rotina precisa realmente falar com
 * o Service Layer.
 *
 * O provider (SapContext) registra aqui um "resolver" que sabe:
 *  1. reaproveitar a sessão já ativa;
 *  2. logar de forma invisível quando o usuário tem senha provisionada;
 *  3. abrir o modal de login da empresa quando não há senha provisionada.
 */

export interface ResolvedSapSession {
  sessionId: string;
  routeId: string;
  companyDB: string;
  userName: string;
  isSuperUser?: boolean;
}

type Resolver = (companyDB: string, interactive: boolean) => Promise<ResolvedSapSession | null>;

let resolver: Resolver | null = null;
const inFlight = new Map<string, Promise<ResolvedSapSession | null>>();

export function registerSapSessionResolver(fn: Resolver | null) {
  resolver = fn;
}

/**
 * Garante uma sessão válida do Service Layer para a base informada.
 * Chamadas concorrentes para a mesma base compartilham a mesma promise,
 * evitando múltiplos /Login (e múltiplos modais) simultâneos.
 *
 * `interactive` só deve ser `true` em ações que gravam diretamente no SAP.
 * Em qualquer outro caso a sessão é resolvida silenciosamente (senha
 * provisionada) e, se não houver credencial, retorna `null` sem abrir modal.
 */
export function resolveSapSession(
  companyDB: string,
  interactive = false,
): Promise<ResolvedSapSession | null> {
  if (!resolver) return Promise.resolve(null);
  const key = `${companyDB || "__default__"}:${interactive ? "i" : "s"}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const p = resolver(companyDB, interactive)
    .catch(() => null)
    .finally(() => { inFlight.delete(key); });
  inFlight.set(key, p);
  return p;
}

export function hasSapSessionResolver(): boolean {
  return resolver !== null;
}
