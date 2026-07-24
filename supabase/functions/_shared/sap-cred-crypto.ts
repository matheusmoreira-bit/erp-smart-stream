// AES-GCM encryption for user SAP passwords.
// Key material comes from the SAP_CRED_ENC_KEY secret (any length; hashed to 256 bits).

const enc = new TextEncoder();
const dec = new TextDecoder();

async function getKey(): Promise<CryptoKey> {
  const raw = Deno.env.get("SAP_CRED_ENC_KEY");
  if (!raw) throw new Error("SAP_CRED_ENC_KEY não configurado");
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(raw));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64decode(str: string): Uint8Array {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext)));
  const packed = new Uint8Array(iv.length + ct.length);
  packed.set(iv, 0);
  packed.set(ct, iv.length);
  return `v1:${b64encode(packed)}`;
}

export async function decryptSecret(payload: string): Promise<string> {
  if (!payload.startsWith("v1:")) throw new Error("Formato de credencial inválido");
  const packed = b64decode(payload.slice(3));
  const iv = packed.slice(0, 12);
  const ct = packed.slice(12);
  const key = await getKey();
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return dec.decode(pt);
}
