// Gera o DynamicToken exigido pelo middleware SAP B1 (HANA views).
// Algoritmo:
//   1. Unix timestamp atual em segundos
//   2. Divide por 3600 e arredonda para baixo (bloco de hora)
//   3. Converte para string
//   4. HMAC-SHA256(secret, blocoDeHora)
//   5. Retorna em hexadecimal
//
// A chave secreta compartilhada é lida da env SAP_MIDDLEWARE_SECRET.

let cachedKey: CryptoKey | null = null;
let cachedKeySource: string | null = null;

async function getKey(secret: string): Promise<CryptoKey> {
  if (cachedKey && cachedKeySource === secret) return cachedKey;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  cachedKey = key;
  cachedKeySource = secret;
  return key;
}

export async function generateDynamicToken(secretOverride?: string): Promise<string> {
  const secret = secretOverride ?? Deno.env.get("SAP_MIDDLEWARE_SECRET");
  if (!secret) throw new Error("SAP_MIDDLEWARE_SECRET não configurada");

  const hourBlock = Math.floor(Date.now() / 1000 / 3600).toString();
  const key = await getKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(hourBlock));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Retorna o mesmo DynamicToken como header pronto para uso, se preferir. */
export async function dynamicTokenHeader(): Promise<Record<string, string>> {
  return { "X-Dynamic-Token": await generateDynamicToken() };
}
