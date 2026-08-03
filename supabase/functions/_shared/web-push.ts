// Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) implementado com WebCrypto.
//
// Não usa bibliotecas Node — roda nativo no Deno das edge functions.
// Segredos esperados: VAPID_PRIVATE_JWK (JWK EC P-256), VAPID_PUBLIC_KEY
// (chave pública raw base64url) e VAPID_SUBJECT (mailto:...).
// deno-lint-ignore-file no-explicit-any

const enc = new TextEncoder();

export interface PushSubscriptionRow {
  id?: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body?: string | null;
  url?: string | null;
  tag?: string | null;
}

export interface PushSendResult {
  ok: boolean;
  status: number;
  /** true quando a inscrição não existe mais (404/410) e deve ser removida. */
  gone: boolean;
  error?: string;
}

function b64urlToBytes(input: string): Uint8Array {
  const s = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

/** HKDF-SHA256 com um único bloco de saída (suficiente: len <= 32). */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const prk = await hmacSha256(salt, ikm);
  const okm = await hmacSha256(prk, concat(info, Uint8Array.of(1)));
  return okm.slice(0, len);
}

/* ───────────────── VAPID ───────────────── */

export function vapidPublicKey(): string | null {
  return Deno.env.get("VAPID_PUBLIC_KEY") || null;
}

export function isPushConfigured(): boolean {
  return !!(Deno.env.get("VAPID_PRIVATE_JWK") && Deno.env.get("VAPID_PUBLIC_KEY"));
}

async function vapidAuthHeader(endpoint: string): Promise<string> {
  const jwkRaw = Deno.env.get("VAPID_PRIVATE_JWK");
  const pub = Deno.env.get("VAPID_PUBLIC_KEY");
  if (!jwkRaw || !pub) throw new Error("VAPID não configurado");
  const jwk = JSON.parse(jwkRaw);
  const key = await crypto.subtle.importKey(
    "jwk",
    { ...jwk, key_ops: ["sign"], ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const aud = new URL(endpoint).origin;
  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = bytesToB64url(enc.encode(JSON.stringify({
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: Deno.env.get("VAPID_SUBJECT") || "mailto:no-reply@erp-flow.app",
  })));
  const signingInput = `${header}.${claims}`;
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(signingInput)),
  );
  return `vapid t=${signingInput}.${bytesToB64url(sig)}, k=${pub}`;
}

/* ───────────────── Payload encryption (aes128gcm) ───────────────── */

async function encryptPayload(sub: PushSubscriptionRow, plaintext: Uint8Array): Promise<Uint8Array> {
  const uaPublic = b64urlToBytes(sub.p256dh);
  const authSecret = b64urlToBytes(sub.auth);

  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, kp.privateKey, 256),
  );

  const ikm = await hkdf(
    authSecret,
    ecdh,
    concat(enc.encode("WebPush: info\u0000"), uaPublic, asPublic),
    32,
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\u0000"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\u0000"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const record = concat(plaintext, Uint8Array.of(2)); // delimitador de último registro
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, record),
  );

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, Uint8Array.of(asPublic.length), asPublic, ciphertext);
}

/* ───────────────── Envio ───────────────── */

export async function sendWebPush(
  sub: PushSubscriptionRow,
  payload: PushPayload,
  ttlSeconds = 12 * 60 * 60,
): Promise<PushSendResult> {
  try {
    if (!isPushConfigured()) return { ok: false, status: 0, gone: false, error: "VAPID não configurado" };
    const body = await encryptPayload(sub, enc.encode(JSON.stringify(payload)));
    const auth = await vapidAuthHeader(sub.endpoint);
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(ttlSeconds),
        Urgency: "high",
      },
      body,
    });
    if (res.ok) return { ok: true, status: res.status, gone: false };
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      status: res.status,
      gone: res.status === 404 || res.status === 410,
      error: text.slice(0, 200),
    };
  } catch (e) {
    return { ok: false, status: 0, gone: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Local-part minúsculo — mesma convenção de `notifications.user_identifier`. */
export function pushIdentifier(v: string | null | undefined): string {
  const s = String(v ?? "").trim().toLowerCase();
  return s.includes("@") ? s.split("@")[0] : s;
}

/**
 * Envia push para todas as inscrições de um destinatário (best-effort).
 * Remove inscrições expiradas (404/410) e nunca lança exceção.
 */
export async function pushToRecipient(
  admin: any,
  recipient: string | null | undefined,
  payload: PushPayload,
): Promise<void> {
  try {
    const ident = pushIdentifier(recipient);
    if (!ident || !isPushConfigured()) return;
    const { data } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_identifier", ident);
    const subs = (data || []) as PushSubscriptionRow[];
    if (subs.length === 0) return;

    const results = await Promise.all(subs.map((s) => sendWebPush(s, payload)));
    const goneIds = subs.filter((s, i) => results[i].gone && s.id).map((s) => s.id as string);
    if (goneIds.length) {
      await admin.from("push_subscriptions").delete().in("id", goneIds);
    }
    const okIds = subs.filter((s, i) => results[i].ok && s.id).map((s) => s.id as string);
    if (okIds.length) {
      await admin
        .from("push_subscriptions")
        .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
        .in("id", okIds);
    }
    for (const r of results.filter((r) => !r.ok && !r.gone)) {
      console.warn("[web-push] falha", r.status, r.error);
    }
  } catch (e) {
    console.warn("[web-push] erro inesperado:", e instanceof Error ? e.message : String(e));
  }
}
