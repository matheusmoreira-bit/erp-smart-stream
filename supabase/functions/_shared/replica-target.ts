// Destinos de réplica (F07). "primary" = REPLICA_DB_URL (SSL obrigatório).
// "local" = REPLICA2_DB_URL — instância local em 201.48.79.205, exceção de
// transporte aprovada por Matheus Moreira em 30/09/2026 (SSL se disponível).
export type ReplicaTarget = "primary" | "local";

const LOCAL_ALLOWED_HOST = "201.48.79.205";

export function parseTarget(v: unknown): ReplicaTarget {
  return v === "local" ? "local" : "primary";
}

export function targetConfig(t: ReplicaTarget):
  | { ok: true; url: string; ssl: "require" | "prefer" }
  | { ok: false; error: string } {
  if (t === "primary") {
    const url = Deno.env.get("REPLICA_DB_URL");
    return url ? { ok: true, url, ssl: "require" } : { ok: false, error: "REPLICA_DB_URL não configurada" };
  }
  const url = Deno.env.get("REPLICA2_DB_URL");
  if (!url) return { ok: false, error: "REPLICA2_DB_URL não configurada" };
  try {
    const u = new URL(url);
    if (!/^postgres(ql)?:$/.test(u.protocol) || u.hostname !== LOCAL_ALLOWED_HOST) {
      return { ok: false, error: "REPLICA2_DB_URL fora do endereço autorizado" };
    }
  } catch {
    return { ok: false, error: "REPLICA2_DB_URL inválida" };
  }
  return { ok: true, url, ssl: "prefer" };
}
