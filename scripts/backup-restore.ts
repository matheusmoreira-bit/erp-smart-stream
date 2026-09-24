// Restauração de backup ERPBK1 (F07). Executar fora do app, em máquina controlada:
//   BACKUP_ENC_KEY=... TARGET_DB_URL=postgres://... deno run -A scripts/backup-restore.ts <pasta-local-com-manifest> [--verify-only]
// A pasta deve conter manifest.json e os arquivos *.jsonl.gz.enc baixados do S3.
// Restaura somente tabelas do schema public (auth.users é só conferido — contas voltam via convite/SSO).
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import postgres from "npm:postgres@3.4.4";

type Part = { key: string; rows: number; sha256: string };
type Entry = { table: string; count: number; parts: Part[] };

const dir = Deno.args[0];
const verifyOnly = Deno.args.includes("--verify-only");
if (!dir) throw new Error("Informe a pasta do backup");

async function key(): Promise<CryptoKey> {
  const s = Deno.env.get("BACKUP_ENC_KEY") || "";
  if (s.length < 32) throw new Error("BACKUP_ENC_KEY ausente");
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
}

async function readPart(k: CryptoKey, p: Part): Promise<Record<string, unknown>[]> {
  const data = await Deno.readFile(`${dir}/${p.key.split("/").pop()}`);
  const sha = createHash("sha256").update(data).digest("hex");
  if (sha !== p.sha256) throw new Error(`Hash divergente em ${p.key}`);
  if (new TextDecoder().decode(data.slice(0, 6)) !== "ERPBK1") throw new Error(`Formato inválido ${p.key}`);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: data.slice(6, 18) }, k, data.slice(18)));
  const lines = new TextDecoder().decode(gunzipSync(plain)).split("\n").filter(Boolean);
  if (lines.length !== p.rows) throw new Error(`Linhas divergentes em ${p.key}`);
  return lines.map((l) => JSON.parse(l));
}

const manifest = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`)) as { tables: Entry[] };
const k = await key();
const sql = verifyOnly ? null : postgres(Deno.env.get("TARGET_DB_URL")!, { max: 1 });
if (sql) await sql`SET session_replication_role = replica`;

let ok = 0;
for (const t of manifest.tables) {
  let n = 0;
  for (const p of t.parts) {
    const rows = await readPart(k, p);
    n += rows.length;
    if (sql && t.table !== "auth.users" && rows.length) {
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        await sql`INSERT INTO ${sql("public." + t.table)} ${sql(batch)} ON CONFLICT DO NOTHING`;
      }
    }
  }
  if (n !== t.count) throw new Error(`${t.table}: esperado ${t.count}, lido ${n}`);
  ok++;
  console.log(`${verifyOnly ? "conferido" : "restaurado"} ${t.table}: ${n}`);
}
if (sql) { await sql`SET session_replication_role = origin`; await sql.end(); }
console.log(`OK — ${ok} tabelas`);
