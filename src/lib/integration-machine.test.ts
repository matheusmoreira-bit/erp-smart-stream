import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

interface Grant {
  id: string; api_key_id: string; service: string; secret_env_name: string;
  company_dbs: string[]; project_codes: string[]; operations: string[];
  enabled: boolean; expires_at: string; revoked_at: string | null;
}
type Machine = {
  machineSigningMessage(req: Request, service: string): Promise<string>;
  verifyMachineProof(admin: unknown, req: Request, context: { keyId?: string; service: string }): Promise<Grant>;
  assertMachineScope(grant: Grant, company: string | undefined, operation: string): void;
};
const syntheticSecret = 'synthetic-test-only-not-a-real-credential';
function fixture() {
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync('supabase/functions/_shared/integration-machine.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, crypto, Request, URL, TextEncoder, Uint8Array, Date, Error,
    Deno: { env: { get: () => syntheticSecret } } });
  const machine = exports as unknown as Machine;
  const grant: Grant = { id: '11111111-1111-4111-8111-111111111111', api_key_id: 'key',
    service: 'external-approvals-api', secret_env_name: 'INTEGRATION_MACHINE_TEST', company_dbs: ['TEST'],
    project_codes: ['CASSINO','VERA'], operations: ['list'], enabled: true,
    expires_at: new Date(Date.now()+3600000).toISOString(), revoked_at: null };
  const used = new Set<string>();
  let effects = 0;
  const admin = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: grant, error: null }) }) }) }),
    rpc: async (_name: string, args: { _nonce: string }) => {
      effects++;
      if (used.has(args._nonce)) return { data: false, error: null };
      used.add(args._nonce); return { data: true, error: null };
    } };
  async function signed(age = 0) {
    const request = new Request('https://example.test/functions/v1/external-approvals-api', { method: 'POST',
      headers: { 'x-api-key': 'synthetic-key', 'x-machine-id': grant.id,
        'x-machine-timestamp': String(Math.floor(Date.now()/1000)-age), 'x-machine-nonce': 'synthetic_nonce_123456' },
      body: JSON.stringify({ op: 'list', company_db: 'TEST' }) });
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(syntheticSecret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(await machine.machineSigningMessage(request, grant.service)));
    request.headers.set('x-machine-signature', Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2,'0')).join(''));
    return request;
  }
  return { machine, grant, admin, signed, effects: () => effects,
    verify: (req: Request, keyId: string | undefined = 'key', service = grant.service) => machine.verifyMachineProof(admin, req, { keyId, service }) };
}
describe('dedicated machine admission', () => {
  it('permits a separately authenticated scoped read without a human session', async () => {
    const f = fixture(); expect((await f.verify(await f.signed())).id).toBe(f.grant.id);
    expect(() => f.machine.assertMachineScope(f.grant, 'TEST', 'list')).not.toThrow();
  });
  it('rejects replay with atomic nonce consumption', async () => {
    const f = fixture(); const req = await f.signed(); await f.verify(req);
    await expect(f.verify(req)).rejects.toMatchObject({ status: 403 });
  });
  it('rejects expired signatures after 60 seconds', async () => {
    const f = fixture(); await expect(f.verify(await f.signed(61))).rejects.toMatchObject({ status: 401 });
    expect(f.effects()).toBe(0);
  });
  it('rejects signatures changed by another body', async () => {
    const f = fixture(); const req = await f.signed();
    await expect(f.verify(new Request(req.url, { method: 'POST', headers: req.headers, body: '{"op":"approve"}' })))
      .rejects.toMatchObject({ status: 401 }); expect(f.effects()).toBe(0);
  });
  it('binds signature to query and path', async () => {
    const f = fixture(); const req = await f.signed();
    await expect(f.verify(new Request(req.url+'?company=OTHER', { method: 'POST', headers: req.headers, body: await req.clone().text() })))
      .rejects.toMatchObject({ status: 401 });
  });
  it('denies another key or service before nonce writes', async () => {
    const f = fixture(); await expect(f.verify(await f.signed(), 'other')).rejects.toMatchObject({ status: 403 });
    await expect(f.verify(await f.signed(), 'key','expense-tracking-api')).rejects.toMatchObject({ status: 403 });
    expect(f.effects()).toBe(0);
  });
  it('denies revocation immediately', async () => {
    const f = fixture(); f.grant.revoked_at = new Date().toISOString();
    await expect(f.verify(await f.signed())).rejects.toMatchObject({ status: 403 });
  });
  it('denies disabled and expired grant', async () => {
    const f = fixture(); f.grant.enabled = false;
    await expect(f.verify(await f.signed())).rejects.toMatchObject({ status: 403 });
    f.grant.enabled = true; f.grant.expires_at = new Date(Date.now()-1).toISOString();
    await expect(f.verify(await f.signed())).rejects.toMatchObject({ status: 403 });
  });
  it('denies human decisions and companies outside the persisted scope', () => {
    const f = fixture();
    for (const op of ['approve','reject']) expect(() => f.machine.assertMachineScope(f.grant, 'TEST', op)).toThrow();
    expect(() => f.machine.assertMachineScope(f.grant, 'OTHER','list')).toThrow();
  });
  it('denies legacy keys without persisted key binding', async () => {
    const f = fixture();
    await expect(f.machine.verifyMachineProof(f.admin, await f.signed(), { service: f.grant.service })).rejects.toMatchObject({ status: 401 });
  });
});