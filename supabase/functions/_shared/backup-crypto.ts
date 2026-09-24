// Cifra de backups (F07). AES-256-GCM com chave derivada de BACKUP_ENC_KEY.
// Formato do arquivo: "ERPBK1" (6 bytes) + IV (12 bytes) + ciphertext+tag.
const MAGIC = new TextEncoder().encode("ERPBK1");

async function key(): Promise<CryptoKey> {
  const secret = Deno.env.get("BACKUP_ENC_KEY") || "";
  if (secret.length < 32) throw new Error("BACKUP_ENC_KEY ausente ou curta");
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptBackup(plain: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), plain));
  const out = new Uint8Array(MAGIC.length + iv.length + ct.length);
  out.set(MAGIC, 0);
  out.set(iv, MAGIC.length);
  out.set(ct, MAGIC.length + iv.length);
  return out;
}

export async function decryptBackup(data: Uint8Array): Promise<Uint8Array> {
  const head = new TextDecoder().decode(data.slice(0, MAGIC.length));
  if (head !== "ERPBK1") throw new Error("Arquivo de backup com formato desconhecido");
  const iv = data.slice(MAGIC.length, MAGIC.length + 12);
  const ct = data.slice(MAGIC.length + 12);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await key(), ct));
}
