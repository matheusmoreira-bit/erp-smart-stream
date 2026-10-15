// Destinos de réplica (F07). "primary" = REPLICA_DB_URL (SSL obrigatório).
// "local" = REPLICA2_DB_URL — instância local on-prem, exceção de
// transporte aprovada por Matheus Moreira em 30/09/2026 (SSL se disponível).
// Hosts aceitos: 201.48.79.205 e 189.20.156.34 (transição de data center
// 15/10/2026), mais os listados na env opcional REPLICA_LOCAL_ALLOWED_HOSTS
// (separados por vírgula).
export type ReplicaTarget = "primary" | "local";

const DEFAULT_LOCAL_ALLOWED_HOSTS = ["201.48.79.205", "189.20.156.34"];

function localAllowedHosts(): Set<string> {
  const extra = (Deno.env.get("REPLICA_LOCAL_ALLOWED_HOSTS") || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return new Set([...DEFAULT_LOCAL_ALLOWED_HOSTS, ...extra]);
}

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
    if (!/^postgres(ql)?:$/.test(u.protocol) || !localAllowedHosts().has(u.hostname.toLowerCase())) {
      return { ok: false, error: "REPLICA2_DB_URL fora do endereço autorizado" };
    }
  } catch {
    return { ok: false, error: "REPLICA2_DB_URL inválida" };
  }
  return { ok: true, url, ssl: "prefer" };
}
