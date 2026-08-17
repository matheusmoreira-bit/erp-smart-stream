import type { Session, User } from "@supabase/supabase-js";

const rawEmail = (import.meta.env.VITE_FAKE_AUTH_EMAIL as string | undefined)?.trim().toLowerCase() || "";
const rawAdmin = String(import.meta.env.VITE_FAKE_AUTH_IS_ADMIN ?? "").trim().toLowerCase();

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FAKE_USER_ID = "00000000-0000-4000-8000-000000000001";

function base64Url(value: unknown): string {
  const json = JSON.stringify(value);
  const binary = Array.from(new TextEncoder().encode(json), (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fakeAccessToken(email: string): string {
  const now = Math.floor(Date.now() / 1000);
  return [
    base64Url({ alg: "none", typ: "JWT" }),
    base64Url({
      aud: "authenticated",
      email,
      exp: now + 24 * 60 * 60,
      iat: now,
      iss: "erp-flow-fake-auth",
      role: "authenticated",
      sub: FAKE_USER_ID,
    }),
    "fake-signature",
  ].join(".");
}

export function isFakeAuthEnabled(): boolean {
  return !!rawEmail;
}

export function getFakeAuthEmail(): string {
  return rawEmail;
}

export function isFakeAuthAdmin(): boolean {
  return isFakeAuthEnabled() && TRUE_VALUES.has(rawAdmin);
}

export function createFakeAuthUser(): User {
  const email = getFakeAuthEmail();
  const now = new Date().toISOString();

  return {
    id: FAKE_USER_ID,
    app_metadata: { provider: "fake", providers: ["fake"] },
    aud: "authenticated",
    created_at: now,
    email,
    email_confirmed_at: now,
    last_sign_in_at: now,
    role: "authenticated",
    updated_at: now,
    user_metadata: {
      email,
      full_name: "Matheus Moreira",
      name: "Matheus Moreira",
    },
  } as User;
}

export function createFakeAuthSession(): Session {
  const user = createFakeAuthUser();
  const expiresAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

  return {
    access_token: fakeAccessToken(user.email || getFakeAuthEmail()),
    expires_at: expiresAt,
    expires_in: expiresAt - Math.floor(Date.now() / 1000),
    refresh_token: "fake-refresh-token",
    token_type: "bearer",
    user,
  } as Session;
}

export async function getCurrentAuthSession(
  getRealSession: () => Promise<{ data: { session: Session | null } }>,
): Promise<{ data: { session: Session | null } }> {
  if (isFakeAuthEnabled()) {
    return { data: { session: createFakeAuthSession() } };
  }
  return getRealSession();
}
