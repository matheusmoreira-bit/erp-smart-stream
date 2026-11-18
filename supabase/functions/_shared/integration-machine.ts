// Machine credentials are independent of API keys and never authorize a human session.
export interface MachineGrant {
  id: string;
  api_key_id: string;
  service: string;
  secret_env_name: string;
  company_dbs: string[];
  project_codes: string[];
  operations: string[];
  enabled: boolean;
  expires_at: string;
  revoked_at: string | null;
}
export interface MachineClient {
  from(table: string): { select(columns: string): {
    eq(column: string, value: string): { maybeSingle(): PromiseLike<{ data: MachineGrant | null; error: unknown }> };
  } };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
export class MachineAuthError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export function hasMachineProof(req: Request): boolean {
  return ['x-machine-id', 'x-machine-timestamp', 'x-machine-nonce', 'x-machine-signature']
    .some(header => req.headers.has(header));
}
async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
/** Canonical input includes the exact URL search and body bytes decoded as UTF-8. */
export async function machineSigningMessage(req: Request, service: string): Promise<string> {
  const url = new URL(req.url);
  const body = await req.clone().text();
  if (new TextEncoder().encode(body).length > 65_536) throw new MachineAuthError('Requisição técnica excede o limite.', 413);
  return ['erp-machine-v1', req.headers.get('x-machine-id'), service,
    req.headers.get('x-machine-timestamp'), req.headers.get('x-machine-nonce'),
    req.method.toUpperCase(), url.pathname + url.search, await digest(body)].join('\n');
}
export async function verifyMachineProof(
  admin: MachineClient, req: Request, context: { keyId?: string; service: string },
): Promise<MachineGrant> {
  const id = req.headers.get('x-machine-id') || '';
  const timestamp = req.headers.get('x-machine-timestamp') || '';
  const nonce = req.headers.get('x-machine-nonce') || '';
  const signature = req.headers.get('x-machine-signature') || '';
  if (!context.keyId || !req.headers.get('x-api-key') ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ||
    !/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 60 ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(signature)) {
    throw new MachineAuthError('Prova técnica inválida ou expirada.', 401);
  }
  const { data: grant, error } = await admin.from('integration_machine_grants')
    .select('id,api_key_id,service,secret_env_name,company_dbs,project_codes,operations,enabled,expires_at,revoked_at')
    .eq('id', id).maybeSingle();
  if (error) throw new MachineAuthError('Verificação técnica indisponível.', 503);
  if (!grant || !grant.enabled || grant.revoked_at || grant.api_key_id !== context.keyId ||
    grant.service !== context.service || !Number.isFinite(Date.parse(grant.expires_at)) ||
    Date.parse(grant.expires_at) <= Date.now() || !Array.isArray(grant.company_dbs) ||
    !grant.company_dbs.length || !Array.isArray(grant.operations) || !grant.operations.length ||
    grant.operations.some(op => !['read', 'list'].includes(op)) ||
    !/^INTEGRATION_MACHINE_[A-Z0-9_]{1,80}$/.test(grant.secret_env_name)) {
    throw new MachineAuthError('Automação não autorizada.', 403);
  }
  const secret = Deno.env.get(grant.secret_env_name);
  if (!secret) throw new MachineAuthError('Credencial técnica não configurada.', 503);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const sig = Uint8Array.from(signature.match(/../g) || [], hex => parseInt(hex, 16));
  if (!await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(await machineSigningMessage(req, context.service)))) {
    throw new MachineAuthError('Assinatura técnica inválida.', 401);
  }
  const consumed = await admin.rpc('consume_integration_machine_nonce', {
    _grant_id: id, _nonce: nonce, _timestamp: Number(timestamp),
  });
  if (consumed.error) throw new MachineAuthError('Verificação técnica indisponível.', 503);
  if (consumed.data !== true) throw new MachineAuthError('Assinatura repetida ou autorização revogada.', 403);
  return grant;
}
export function assertMachineScope(grant: MachineGrant | undefined, companyDb: string | undefined, operation: string): void {
  if (!grant) return;
  if (!grant.operations.includes(operation) || (companyDb !== undefined && !grant.company_dbs.includes(companyDb))) {
    throw new MachineAuthError('Operação ou empresa fora do escopo técnico.', 403);
  }
}