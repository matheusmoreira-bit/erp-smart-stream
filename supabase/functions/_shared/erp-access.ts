export interface AccessRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

export class ErpAccessError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Call only after verifying the original actor, never from declared headers. */
export async function assertErpAccess(
  client: AccessRpcClient,
  actor: { userId: string } | { email: string } | { sapUser: string },
): Promise<void> {
  const isUser = 'userId' in actor;
  const { data, error } = await client.rpc(
    isUser ? 'erp_access_admitted' : 'erp_access_actor_admitted',
    isUser ? { _user_id: actor.userId } : 'email' in actor
      ? { _email: actor.email, _sap_user: null }
      : { _email: null, _sap_user: actor.sapUser },
  );
  if (error || typeof data !== 'boolean') {
    throw new ErpAccessError('Não foi possível verificar o acesso. Tente novamente.', 503);
  }
  if (!data) throw new ErpAccessError('Seu acesso ao ERP Flow está temporariamente bloqueado.', 403);
}