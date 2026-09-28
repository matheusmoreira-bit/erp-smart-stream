// Fixed metadata queries only. Source credentials never reach Vite or containers.
import postgres from 'postgres';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const config = JSON.parse(await readFile(new URL('docker/source-db.local', root), 'utf8'));
const ca = await readFile(new URL('docker/local/supabase-ca.crt', root), 'utf8');
const sql = postgres({
  host: config.host, port: config.port, database: config.database,
  username: config.username, password: config.password,
  ssl: { ca, rejectUnauthorized: true }, max: 1, prepare: false, connect_timeout: 15,
  connection: { default_transaction_read_only: 'on', statement_timeout: 15000,
    application_name: 'erp-local-readonly-inspection' },
});
try {
  const result = await sql.begin('read only', async tx => {
    const [server] = await tx`select version(), current_setting('transaction_read_only') as read_only`;
    if (server.read_only !== 'on') throw new Error('Source connection is not read-only');
    const schemas = await tx`select schemaname, count(*)::int as tables from pg_tables
      where schemaname in ('public','auth','storage') group by schemaname`;
    const tables = await tx`select relname, n_live_tup from pg_stat_user_tables order by n_live_tup desc`;
    return { collected_at: new Date().toISOString(), source_host: config.host, server, schemas, tables };
  });
  await mkdir(new URL('docker/local/', root), { recursive: true });
  await writeFile(new URL('docker/local/source-inventory.json', root), JSON.stringify(result, null, 2)+'\n', {mode:0o600});
  console.log(JSON.stringify({ read_only: result.server.read_only, schemas: result.schemas }, null, 2));
} catch (error) {
  // Do not emit the connection config or stack (may contain credentials).
  console.error('Source inspection failed:', error.code ?? 'ERROR', String(error.message).replaceAll(config.password, '[redacted]'));
  process.exitCode = 1;
} finally { await sql.end({ timeout: 2 }); }
