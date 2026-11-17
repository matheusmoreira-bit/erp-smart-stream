import { describe, expect, it } from 'vitest';
import { assertErpAccess, ErpAccessError } from '../../supabase/functions/_shared/erp-access';

describe('ERP admission enforcement', () => {
  it('checks each verified identity, including Hiller and Douglas, without role bypass', async () => {
    const allowed = new Set([
      '28dc95ee-92b4-4c0d-8310-eba68a3ad0c8',
      'f64dbcd6-bd23-47de-939d-91d386f85b77',
      '8a229285-c36c-489f-ba1b-0cc03b779d7c',
      'd8da2168-b339-46f0-84a4-6c674e6f8f77',
      '1783d855-cc24-40de-920d-f087e356a9c8',
      '92305a29-1893-4a9a-8ddf-e1dc98ececc2',
    ]);
    const client = { rpc: async (_name: string, args: Record<string, unknown>) => ({ data: allowed.has(String(args._user_id)), error: null }) };
    for (const userId of allowed) await expect(assertErpAccess(client, { userId })).resolves.toBeUndefined();
    await expect(assertErpAccess(client, { userId: 'another-admin' })).rejects.toMatchObject({ status: 403 });
  });
  it('does not admit a denied existing session', async () => {
    await expect(assertErpAccess({ rpc: async () => ({ data: false, error: null }) }, { userId: 'existing-session-user' })).rejects.toBeInstanceOf(ErpAccessError);
  });
  it('fails closed on lookup failure', async () => {
    await expect(assertErpAccess({ rpc: async () => ({ data: null, error: new Error('unavailable') }) }, { userId: 'allowed' })).rejects.toMatchObject({ status: 503 });
  });
  it('fails closed on invalid response', async () => {
    await expect(assertErpAccess({ rpc: async () => ({ data: 'true', error: null }) }, { userId: 'allowed' })).rejects.toMatchObject({ status: 503 });
  });
  it('allows prior permissions to resume when the server disables restriction', async () => {
    let enabled = true;
    const client = { rpc: async () => ({ data: !enabled, error: null }) };
    await expect(assertErpAccess(client, { userId: 'blocked' })).rejects.toMatchObject({ status: 403 });
    enabled = false;
    await expect(assertErpAccess(client, { userId: 'blocked' })).resolves.toBeUndefined();
  });
  it('uses server-resolved SAP identity rather than an unchecked user UUID', async () => {
    let received: Record<string, unknown> = {};
    const client = { rpc: async (name: string, args: Record<string, unknown>) => {
      expect(name).toBe('erp_access_actor_admitted'); received = args;
      return { data: false, error: null };
    } };
    await expect(assertErpAccess(client, { sapUser: 'blocked.sap' })).rejects.toMatchObject({ status: 403 });
    expect(received).toEqual({ _email: null, _sap_user: 'blocked.sap' });
  });
  it('checks delegated approval email independently of service-role transport', async () => {
    const client = { rpc: async (_name: string, args: Record<string, unknown>) => ({ data: args._email === 'juliana.gavineli@anagaming.com.br', error: null }) };
    await expect(assertErpAccess(client, { email: 'juliana.gavineli@anagaming.com.br' })).resolves.toBeUndefined();
    await expect(assertErpAccess(client, { email: 'someone.else@anagaming.com.br' })).rejects.toMatchObject({ status: 403 });
  });
});