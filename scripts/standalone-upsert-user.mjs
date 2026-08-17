import fs from "node:fs";

const root = new URL("..", import.meta.url);
const envPath = new URL("docker/.env.standalone", root);

function readEnv(path) {
  const out = {};
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx);
    let value = trimmed.slice(idx + 1);
    value = value.replace(/\$\{([^}]+)\}/g, (_, name) => out[name] ?? process.env[name] ?? "");
    out[key] = value;
  }
  return out;
}

const env = readEnv(envPath);
const baseUrl = env.VITE_SUPABASE_URL || "http://127.0.0.1:8000";
const serviceKey = env.SERVICE_ROLE_KEY;
const email = env.VITE_FAKE_AUTH_EMAIL;
const password = env.VITE_FAKE_AUTH_PASSWORD;

if (!serviceKey || !email || !password) {
  throw new Error("SERVICE_ROLE_KEY, VITE_FAKE_AUTH_EMAIL e VITE_FAKE_AUTH_PASSWORD sao obrigatorios");
}

const headers = {
  apikey: serviceKey,
  authorization: `Bearer ${serviceKey}`,
  "content-type": "application/json",
};

async function request(path, init = {}) {
  const res = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${init.method || "GET"} ${path} -> ${res.status}: ${text}`);
  }
  return body;
}

async function waitForAuth() {
  for (let i = 0; i < 60; i += 1) {
    try {
      await request("/auth/v1/admin/users?page=1&per_page=1");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error("Auth local nao respondeu a tempo");
}

await waitForAuth();
const users = await request("/auth/v1/admin/users?page=1&per_page=200");
const list = Array.isArray(users?.users) ? users.users : [];
const existing = list.find((user) => String(user.email || "").toLowerCase() === email.toLowerCase());

if (existing?.id) {
  await request(`/auth/v1/admin/users/${existing.id}`, {
    method: "PUT",
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "Matheus Moreira", name: "Matheus Moreira" },
      app_metadata: { provider: "standalone", providers: ["standalone"] },
    }),
  });
  console.log(`   Auth user atualizado: ${email}`);
} else {
  await request("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "Matheus Moreira", name: "Matheus Moreira" },
      app_metadata: { provider: "standalone", providers: ["standalone"] },
    }),
  });
  console.log(`   Auth user criado: ${email}`);
}
