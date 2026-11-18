import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

type Admission = { restricted: boolean; caller?: { id: string; email?: string } };
type Guard = {
  checkIntegrationAdmission: (admin: unknown, req: Request) => Promise<Admission>;
  assertIntegrationActor: (admin: unknown, admission: Admission, code: string) => Promise<void>;
};
function load(path: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Request, Response, URL, Error, TextEncoder, crypto, Date, Set, console,
    Deno: { env: { get: () => 'synthetic-legacy-key' } },
    require: (name: string) => { if (!(name in dependencies)) throw new Error(`Unexpected import: ${name}`); return dependencies[name]; },
  });
  return exports;
}
function fixture() {
  let enabled = true;
  let failure = false;
  let person = 'blocked';
  let machineProof = false;
  const effects: string[] = [];
  const admin = {
    from: (table: string) => {
      const query: Record<string, unknown> = {};
      query.select = query.eq = () => query;
      query.update = () => { effects.push('usage-update'); return query; };
      query.maybeSingle = async () => table === 'erp_access_control'
        ? { data: failure ? null : { enabled }, error: failure ? new Error('offline') : null }
        : { data: { id: 'key', name: 'synthetic', service: 'test', project_codes: ['TEST'] }, error: null };
      query.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve);
      return query;
    }, rpc: async () => { effects.push('usage-rpc'); return { data: true, error: null }; },
  };
  const guard = load('supabase/functions/_shared/integration-admission.ts', {
    './auth.ts': { requireUser: async () => {
      if (person === 'blocked') throw Object.assign(new Error('blocked'), { status: 403 });
      if (person === 'invalid') throw Object.assign(new Error('invalid'), { status: 401 });
      return { id: person, email: `${person}@anagaming.com.br` };
    } },
    './user-aliases.ts': { normalizeIdentity: (v: string) => v.toLowerCase().replace(/\./g, ''),
      resolveCallerAliases: async () => new Set([person.replace(/\./g, '')]) },
    './erp-access.ts': { assertErpAccess: async (_admin: unknown, actor: { sapUser: string }) => {
      effects.push('actor-check'); if (actor.sapUser === 'blocked') throw Object.assign(new Error('blocked'), { status: 403 });
    } },
    './integration-machine.ts': { hasMachineProof: () => machineProof,
      verifyMachineProof: async () => ({ id: 'machine', operations: ['list'] }) },
  }) as unknown as Guard;
  const validator = load('supabase/functions/_shared/api-keys.ts', { './integration-admission.ts': guard }) as {
    validateApiKey: (admin: unknown, req: Request, service: string, legacy?: string) => Promise<{ valid: boolean; status?: number }>;
  };
  return { admin, guard, validator, effects, setEnabled: (value: boolean) => { enabled = value; },
    setPerson: (value: string) => { person = value; }, setMachine: () => { machineProof = true; }, fail: () => { failure = true; } };
}
const keyOnly = () => new Request('https://example.test', { headers: { 'x-api-key': 'synthetic-key', 'x-user-id': 'juliana.gavineli', 'x-scheduler-secret': 'forged' } });
const human = () => new Request('https://example.test', { headers: { 'x-api-key': 'synthetic-key', authorization: 'Bearer synthetic-human' } });

describe('integration keys cannot bypass ERP admission', () => {
  it('permits independently verified machine reads under restriction without a human alias', async () => {
    const f = fixture(); f.setMachine();
    expect(await f.validator.validateApiKey(f.admin, keyOnly(), 'test')).toMatchObject({ valid: true });
  });
  it('does not fall back from a blocked human to an otherwise valid machine proof', async () => {
    const f = fixture(); f.setMachine();
    expect(await f.validator.validateApiKey(f.admin, human(), 'test')).toMatchObject({ valid: false, status: 403 });
    expect(f.effects).toEqual([]);
  });
  it('denies key-only calls while restricted even with forged exemption headers', async () => {
    const f = fixture();
    await expect(f.guard.checkIntegrationAdmission(f.admin, keyOnly())).rejects.toMatchObject({ status: 403 });
  });
  it('denies blocked human despite valid integration key', async () => {
    const f = fixture();
    expect(await f.validator.validateApiKey(f.admin, human(), 'test')).toMatchObject({ valid: false, status: 403 });
    expect(f.effects).toEqual([]);
  });
  it('refuses invalid personal bearer instead of falling back to valid key', async () => {
    const f = fixture(); f.setPerson('invalid'); f.setEnabled(false);
    expect(await f.validator.validateApiKey(f.admin, human(), 'test')).toMatchObject({ valid: false, status: 401 });
    expect(f.effects).toEqual([]);
  });
  it('preserves key-only automation while gate remains disabled', async () => {
    const f = fixture(); f.setEnabled(false);
    expect(await f.validator.validateApiKey(f.admin, keyOnly(), 'test')).toMatchObject({ valid: true });
  });
  it('checks latest gate value on every call and resumes after reopening', async () => {
    const f = fixture();
    expect(await f.validator.validateApiKey(f.admin, keyOnly(), 'test')).toMatchObject({ valid: false, status: 403 });
    f.setEnabled(false);
    expect(await f.validator.validateApiKey(f.admin, keyOnly(), 'test')).toMatchObject({ valid: true });
    f.setEnabled(true);
    expect(await f.validator.validateApiKey(f.admin, keyOnly(), 'test')).toMatchObject({ valid: false, status: 403 });
  });
  it('fails closed before usage writes when gate lookup fails', async () => {
    const f = fixture(); f.fail();
    expect(await f.validator.validateApiKey(f.admin, keyOnly(), 'test')).toMatchObject({ valid: false, status: 503 });
    expect(f.effects).toEqual([]);
  });
  for (const person of ['mauricio.farias', 'juliana.gavineli', 'artur.angelo']) {
    it(`${person} retains their own delegated action while restricted`, async () => {
      const f = fixture(); f.setPerson(person);
      const admission = await f.guard.checkIntegrationAdmission(f.admin, human());
      await expect(f.guard.assertIntegrationActor(f.admin, admission, person)).resolves.toBeUndefined();
      expect(f.effects).toEqual(['actor-check']);
    });
  }
  it('admitted caller cannot impersonate another SAP actor or list everyone', async () => {
    const f = fixture(); f.setPerson('juliana.gavineli');
    const admission = await f.guard.checkIntegrationAdmission(f.admin, human());
    for (const code of ['mauricio.farias', 'blocked', '', 'juliana.gavineli,(id.gt.0)']) {
      await expect(f.guard.assertIntegrationActor(f.admin, admission, code)).rejects.toMatchObject({ status: 403 });
    }
    expect(f.effects).toEqual([]);
  });
  it('keeps disabled-gate delegation contracts unchanged', async () => {
    const f = fixture(); f.setEnabled(false);
    await expect(f.guard.assertIntegrationActor(f.admin, { restricted: false }, '')).resolves.toBeUndefined();
  });
});

describe('deployed integration entrypoints deny before business side effects', () => {
  for (const name of ['external-approvals-api', 'expense-tracking-api', 'pagcorp-status-api']) {
    it(`${name} propagates blocked admission before SAP or data reads`, async () => {
      let handler: ((req: Request) => Promise<Response>) | undefined;
      const effects: string[] = [];
      const source = readFileSync(`supabase/functions/${name}/index.ts`, 'utf8');
      const dependencies: Record<string, unknown> = {};
      for (const match of source.matchAll(/from ["']([^"']+)["']/g)) dependencies[match[1]] = {};
      for (const key of Object.keys(dependencies)) {
        if (key.includes('supabase-js')) dependencies[key] = { createClient: () => ({
          from: () => { effects.push('business-read'); throw new Error('Forbidden read'); },
        }) };
      }
      dependencies['../_shared/api-keys.ts'] = { validateApiKey: async () => ({ valid: false, status: 403, reason: 'blocked' }) };
      dependencies['../_shared/auth.ts'] = { authErrorResponse: () => null };
      dependencies['npm:zod@3.23.8'] = { z };
      const exports: Record<string, unknown> = {};
      runInNewContext(ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText, { exports, Request, Response, URL, console,
        Deno: { env: { get: () => 'synthetic' }, serve: (fn: typeof handler) => { handler = fn; } },
        fetch: () => { effects.push('SAP-fetch'); throw new Error('Forbidden fetch'); },
        require: (key: string) => dependencies[key],
      });
      if (!handler) throw new Error('Missing handler');
      const response = await handler(new Request(`https://example.test/${name}`, {
        method: name === 'external-approvals-api' ? 'POST' : 'GET',
      }));
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: 'blocked' });
      expect(effects).toEqual([]);
    });
  }
});