import { requireUser } from './auth.ts';
import { normalizeIdentity, resolveCallerAliases } from './user-aliases.ts';
import { assertErpAccess } from './erp-access.ts';
import { hasMachineProof, verifyMachineProof, type MachineGrant, type MachineClient } from './integration-machine.ts';

interface AdmissionClient {
  from(table: string): {
    select(columns: string): { eq(column: string, value: boolean): { maybeSingle(): PromiseLike<{ data: { enabled: boolean } | null; error: unknown }> } };
  };
}
export interface IntegrationAdmission {
  restricted: boolean;
  caller?: { id: string; email?: string };
  machine?: MachineGrant;
}
export class IntegrationAdmissionError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** API keys authenticate a service, never an admitted human. No caller-declared exemptions. */
export async function checkIntegrationAdmission(
  admin: AdmissionClient, req: Request,
  keyContext?: { keyId?: string; service: string },
): Promise<IntegrationAdmission> {
  const { data, error } = await admin.from('erp_access_control').select('enabled').eq('id', true).maybeSingle();
  if (error || !data || typeof data.enabled !== 'boolean') {
    throw new IntegrationAdmissionError('Não foi possível verificar o acesso à integração.', 503);
  }
  const authorization = req.headers.get('authorization') || '';
  // A separate bearer is a human credential, not a fallback API key.
  const hasHumanCredential = !!req.headers.get('x-api-key') && /^Bearer\s+\S+$/i.test(authorization);
  // Personal credentials always win: a blocked person cannot fall back to a machine.
  if (hasHumanCredential) {
    const caller = await requireUser(req);
    return { restricted: data.enabled, caller: { id: caller.id, email: caller.email ?? undefined } };
  }
  if (hasMachineProof(req)) {
    if (!keyContext) throw new IntegrationAdmissionError('Identidade técnica não configurada.', 403);
    const machine = await verifyMachineProof(admin as unknown as MachineClient, req, keyContext);
    return { restricted: data.enabled, machine };
  }
  if (!data.enabled) return { restricted: false };
  throw new IntegrationAdmissionError('Modo restrito: integração exige sessão pessoal autorizada ou autenticação técnica exclusiva.', 403);
}

/** Only a verified caller may select their own delegated SAP identity while restricted. */
export async function assertIntegrationActor(
  admin: Parameters<typeof resolveCallerAliases>[0], admission: IntegrationAdmission, userCode: string,
): Promise<void> {
  if (admission.machine) {
    if (userCode) throw new IntegrationAdmissionError('Automação não pode representar uma pessoa.', 403);
    return;
  }
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