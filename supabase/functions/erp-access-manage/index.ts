import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0';
import { z } from 'https://esm.sh/zod@3.25.76';
import { requireAdmin, authErrorResponse } from '../_shared/auth.ts';
import { rejectForeignOrigin } from '../_shared/cors-allowlist.ts';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const schema = z.object({
  scope: z.enum(['global', 'web']).default('global'),
  action: z.enum(['status', 'enable', 'disable', 'allow', 'remove']),
  version: z.number().int().nonnegative().optional(),
  email: z.string().email().max(254).optional(),
}).strict();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

Deno.serve(async req => {
  const rejected = rejectForeignOrigin(req);
  if (rejected) return rejected;
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  try {
    await requireAdmin(req);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: 'Solicitação inválida.' }, 400);
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_ANON_KEY');
    if (!url || !key) return json({ error: 'Serviço indisponível.' }, 503);
    const caller = createClient(url, key, {
      global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
      auth: { persistSession: false },
    });
    const input = parsed.data;
    if (input.action !== 'status' && input.version === undefined) return json({ error: 'Atualize a configuração.' }, 400);
    const result = input.action === 'status'
      ? await caller.rpc(input.scope === 'web' ? 'erp_web_access_status' : 'erp_access_status')
      : await caller.rpc(input.scope === 'web' ? 'manage_erp_web_access' : 'manage_erp_access', { _action: input.action, _expected_version: input.version, _email: input.email ?? null });
    if (result.error) return json({ error: result.error.message }, result.error.code === '42501' ? 403 : result.error.code === '40001' ? 409 : 400);
    return json(result.data);
  } catch (error) {
    return authErrorResponse(error, corsHeaders) ?? json({ error: 'Não foi possível verificar a gestão de acesso.' }, 503);
  }
});