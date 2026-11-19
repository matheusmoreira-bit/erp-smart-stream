import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

function fixture() {
  let handler: ((req: Request) => Promise<Response>) | undefined;
  const calls: string[] = [];
  const dependencies: Record<string, unknown> = {
    'https://esm.sh/@supabase/supabase-js@2.103.0': { createClient: () => ({ rpc: async (name: string) => { calls.push(name); return { data: { enabled: false }, error: null }; } }) },
    'https://esm.sh/zod@3.25.76': { z },
    '../_shared/auth.ts': { requireAdmin: async () => {}, authErrorResponse: () => null },
    '../_shared/cors-allowlist.ts': { rejectForeignOrigin: () => null },
    'npm:@supabase/supabase-js@2/cors': { corsHeaders: {} },
  };
  runInNewContext(ts.transpileModule(readFileSync('supabase/functions/erp-access-manage/index.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: {}, Request, Response, console,
    Deno: { env: { get: () => 'synthetic' }, serve: (value: typeof handler) => { handler = value; } },
    require: (name: string) => { if (!(name in dependencies)) throw new Error(name); return dependencies[name]; },
  });
  return { calls, request: async (body: object) => {
    if (!handler) throw new Error('Missing handler');
    return handler(new Request('https://example.test/erp-access-manage', { method: 'POST', body: JSON.stringify(body) }));
  } };
}
describe('independent administrative access scope', () => {
  it('preserves the existing default global status contract', async () => {
    const f = fixture(); await f.request({ action: 'status' });
    expect(f.calls).toEqual(['erp_access_status']);
  });
  it('reads web status without mutating or activating either restriction', async () => {
    const f = fixture(); await f.request({ action: 'status', scope: 'web' });
    expect(f.calls).toEqual(['erp_web_access_status']);
  });
  it('binds a web allow action only to the web management RPC', async () => {
    const f = fixture(); await f.request({ action: 'allow', scope: 'web', version: 2, email: 'flavia.alves@growth.gg' });
    expect(f.calls).toEqual(['manage_erp_web_access']);
  });
  it('rejects unknown scopes before querying', async () => {
    const f = fixture(); const response = await f.request({ action: 'status', scope: 'other' });
    expect(response.status).toBe(400); expect(f.calls).toEqual([]);
  });
});