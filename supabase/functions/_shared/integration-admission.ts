import { requireUser } from './auth.ts';
import { normalizeIdentity, resolveCallerAliases } from './user-aliases.ts';
import { assertErpAccess } from './erp-access.ts';

interface AdmissionClient {
  from(table: string): {
    select(columns: string): { eq(column: string, value: boolean): { maybeSingle(): PromiseLike<{ data: { enabled: boolean } | null; error: unknown }> } };
  };
}
export interface IntegrationAdmission {
  restricted: boolean;
  caller?: { id: string; email?: string };
}
export class IntegrationAdmissionError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** API keys authenticate a service, never an admitted human. No caller-declared exemptions. */
export async function checkIntegrationAdmission(admin: AdmissionClient, req: Request): Promise<IntegrationAdmission> {
  const { data, error } = await admin.from('erp_access_control').select('enabled').eq('id', true).maybeSingle();
  if (error || !data || typeof data.enabled !== 'boolean') {
    throw new IntegrationAdmissionError('Não foi possível verificar o acesso à integração.', 503);
  }
  const authorization = req.headers.get('authorization') || '';
  // A separate bearer is a human credential, not a fallback API key.
  const hasHumanCredential = !!req.headers.get('x-api-key') && /^Bearer\s+\S+$/i.test(authorization);
  if (!data.enabled && !hasHumanCredential) return { restricted: false };
  if (!hasHumanCredential) {
    throw new IntegrationAdmissionError('Modo restrito: integração exige sessão pessoal autorizada além da chave de API.', 403);
  }
  const caller = await requireUser(req);
  return { restricted: data.enabled, caller: { id: caller.id, email: caller.email ?? undefined } };
}

/** Only a verified caller may select their own delegated SAP identity while restricted. */
export async function assertIntegrationActor(
  admin: Parameters<typeof resolveCallerAliases>[0], admission: IntegrationAdmission, userCode: string,
): Promise<void> {
  if (!admission.restricted) return;
  if (!admission.caller || !userCode || !/^[A-Za-z0-9._@-]{1,128}$/.test(userCode)) {
    throw new IntegrationAdmissionError('Modo restrito: informe sua própria identidade SAP.', 403);
  }
  const aliases = await resolveCallerAliases(admin, admission.caller);
  if (!aliases.has(normalizeIdentity(userCode))) {
    throw new IntegrationAdmissionError('Não é permitido agir em nome de outra pessoa.', 403);
  }
  await assertErpAccess(admin, { sapUser: userCode });
}