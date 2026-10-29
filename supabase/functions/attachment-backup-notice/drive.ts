export const SHARED_DRIVE = "0AEGlkXe3D_4wUk9PVA";
const GATEWAY = "https://connector-gateway.lovable.dev/google_drive";
export class DriveError extends Error {
  constructor(public status: number) { super(status === 403 || status === 404 ? "sem acesso ao Drive" : `Google Drive HTTP ${status}`); }
}
export function headers(extra: Record<string, string> = {}): Record<string, string> {
  const key = Deno.env.get("GOOGLE_DRIVE_API_KEY");
  const app = Deno.env.get("LOVABLE_API_KEY");
  if (!key || !app) throw new Error("Conexão Douglas não vinculada ao projeto; proprietário precisa receber Can use na conexão e vinculá-la");
  return { Authorization: `Bearer ${app}`, "X-Connection-Api-Key": key, ...extra };
}
export async function drive(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const url = new URL(GATEWAY + path);
  url.searchParams.set("supportsAllDrives", "true");
  const r = await fetch(url, { ...init, headers: headers({ "Content-Type": "application/json", ...(init.headers as Record<string, string> || {}) }), signal: AbortSignal.timeout(20_000) });
  if (!r.ok) { await r.body?.cancel(); throw new DriveError(r.status); }
  return await r.json();
}
export async function find(name: string, parent: string): Promise<{ id: string; size?: string; appProperties?: Record<string,string> } | undefined> {
  const q = `name='${name.replace(/[\\']/g, "\\$&")}' and '${parent}' in parents and trashed=false`;
  const params = new URLSearchParams({ q, corpora: "drive", driveId: SHARED_DRIVE, includeItemsFromAllDrives: "true", fields: "files(id,size,appProperties)", pageSize: "100" });
  const result = await drive(`/drive/v3/files?${params}`);
  const files = result.files as { id: string; size?: string; appProperties?: Record<string,string> }[];
  if (files.length > 1) throw new Error("Arquivos duplicados no destino; revisão necessária");
  return files[0];
}
export async function folder(name: string, parent: string): Promise<string> {
  const existing = await find(name, parent);
  if (existing) return existing.id;
  const created = await drive("/drive/v3/files", { method: "POST", body: JSON.stringify({ name, parents: [parent], mimeType: "application/vnd.google-apps.folder" }) });
  return String(created.id);
}
export async function parentFor(path: string, root: string): Promise<{ parent: string; name: string }> {
  const parts = path.split("/"); const name = parts.pop() || "arquivo"; let parent = root;
  for (const part of parts) parent = await folder(part, parent);
  return { parent, name };
}
export async function putSmall(path: string, root: string, content: string, mime: string): Promise<string> {
  const { parent, name } = await parentFor(path, root); const existing = await find(name, parent);
  const boundary = crypto.randomUUID();
  const metadata = existing ? { name } : { name, parents: [parent] };
  const body = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n${content}\r\n--${boundary}--`;
  const r = await fetch(`${GATEWAY}/upload/drive/v3/files${existing ? "/"+existing.id : ""}?uploadType=multipart&supportsAllDrives=true`, { method: existing ? "PATCH" : "POST", headers: headers({ "Content-Type": `multipart/related; boundary=${boundary}` }), body, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) { await r.body?.cancel(); throw new DriveError(r.status); }
  return String((await r.json()).id);
}
export async function startUpload(path: string, root: string, bytes: number, hash: string): Promise<{ url: string; id?: string; skipped: boolean }> {
  const { parent, name } = await parentFor(path, root); const existing = await find(name, parent);
  if (existing?.appProperties?.sha256 === hash && Number(existing.size) === bytes) return { url: "", id: existing.id, skipped: true };
  const r = await fetch(`${GATEWAY}/upload/drive/v3/files${existing ? "/"+existing.id : ""}?uploadType=resumable&supportsAllDrives=true`, { method: existing ? "PATCH" : "POST", headers: headers({ "Content-Type": "application/json", "X-Upload-Content-Length": String(bytes), "X-Upload-Content-Type": path.endsWith("json") ? "application/json" : "text/csv" }), body: JSON.stringify({ name, ...(!existing ? { parents:[parent] } : {}), appProperties:{ sha256:hash } }), signal: AbortSignal.timeout(20_000) });
  if (!r.ok) { await r.body?.cancel(); throw new DriveError(r.status); }
  const location = r.headers.get("location"); await r.body?.cancel();
  if (!location) throw new Error("Conector não retornou sessão retomável de upload");
  const u = new URL(location);
  if (!["www.googleapis.com", "content.googleapis.com", "connector-gateway.lovable.dev"].includes(u.hostname) || !u.pathname.includes("/upload/drive/")) throw new Error("Destino de upload inválido");
  return { url:GATEWAY+u.pathname+u.search, skipped:false };
}
export async function uploadPart(url: string, body: Uint8Array, offset: number, total: number): Promise<{ offset:number; id?:string }> {
  if (!url.startsWith(GATEWAY+"/upload/drive/")) throw new Error("Sessão inválida");
  const r = await fetch(url, { method:"PUT", headers:headers({ "Content-Length":String(body.byteLength), "Content-Range":`bytes ${offset}-${offset+body.byteLength-1}/${total}` }), body, signal:AbortSignal.timeout(20_000) });
  if (r.status === 308) { const range=r.headers.get("range"); await r.body?.cancel(); return { offset:range ? Number(range.split("-").pop())+1 : 0 }; }
  if (!r.ok) { await r.body?.cancel(); throw new DriveError(r.status); }
  return { offset:total, id:String((await r.json()).id) };
}