import { supabase } from "@/integrations/supabase/client";
import { stripDiacritics } from "@/lib/text-normalize";

export const REGISTRATION_BUCKET = "registration-attachments";

export interface RegistrationAttachment {
  name: string;
  path: string;
  size?: number;
  type?: string;
  uploadedAt?: string;
  uploadedBy?: string | null;
  /** legado: anexos antigos podiam vir apenas com url pública */
  url?: string;
}

const MAX_SIZE = 15 * 1024 * 1024; // 15MB
const ALLOWED = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/csv",
  "text/xml",
  "application/xml",
];

export function validateRegistrationFile(file: File): string | null {
  if (file.size > MAX_SIZE) return `"${file.name}" excede o limite de 15MB.`;
  if (file.type && !ALLOWED.includes(file.type)) return `Formato não permitido em "${file.name}".`;
  return null;
}

function safeName(name: string) {
  return stripDiacritics(name)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(-120);
}

/** Faz upload dos arquivos no caminho <requestId>/<timestamp>-<arquivo> */
export async function uploadRegistrationAttachments(
  requestId: string,
  files: File[],
  uploadedBy?: string | null,
): Promise<RegistrationAttachment[]> {
  const out: RegistrationAttachment[] = [];
  for (const file of files) {
    const problem = validateRegistrationFile(file);
    if (problem) throw new Error(problem);
    const path = `${requestId}/${Date.now()}-${safeName(file.name)}`;
    const { error } = await supabase.storage
      .from(REGISTRATION_BUCKET)
      .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (error) throw new Error(`Falha ao enviar "${file.name}": ${error.message}`);
    out.push({
      name: file.name,
      path,
      size: file.size,
      type: file.type || undefined,
      uploadedAt: new Date().toISOString(),
      uploadedBy: uploadedBy ?? null,
    });
  }
  return out;
}

export async function getRegistrationAttachmentUrl(att: RegistrationAttachment): Promise<string> {
  if (!att.path) {
    if (att.url) return att.url;
    throw new Error("Anexo sem caminho de armazenamento.");
  }
  const { data, error } = await supabase.storage
    .from(REGISTRATION_BUCKET)
    .createSignedUrl(att.path, 300);
  if (error || !data?.signedUrl) throw new Error(error?.message || "Não foi possível gerar o link do anexo.");
  return data.signedUrl;
}

export function formatFileSize(bytes?: number) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
