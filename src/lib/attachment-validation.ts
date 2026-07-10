// Validação de anexos usada nos modais de despesa/adiantamento.
// Centraliza: tamanho máximo, tipos permitidos e mensagens amigáveis.

export const MAX_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
export const MAX_ATTACHMENT_SIZE_LABEL = "20 MB";

// Extensões permitidas (fallback quando o MIME vem vazio) e MIME types.
// Aceitamos: PDFs, imagens comuns, planilhas, XML/CSV, DOC/DOCX, TXT — os
// formatos que os fluxos de compra/despesa costumam anexar.
const ALLOWED_EXTENSIONS = [
  "pdf",
  "png", "jpg", "jpeg", "webp", "gif", "heic", "heif",
  "csv", "xml", "txt",
  "xls", "xlsx", "ods",
  "doc", "docx",
  "ppt", "pptx",
  "zip",
] as const;

const ALLOWED_MIME_PREFIXES = ["image/"];
const ALLOWED_MIME_EXACT = new Set<string>([
  "application/pdf",
  "text/csv",
  "text/xml",
  "application/xml",
  "text/plain",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream", // alguns navegadores enviam assim; validamos pela extensão
]);

export const ALLOWED_ATTACHMENT_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.webp,.gif,.heic,.heif,.csv,.xml,.txt,.xls,.xlsx,.ods,.doc,.docx,.ppt,.pptx,.zip";

export const ALLOWED_ATTACHMENT_HINT =
  "PDF, imagens, planilhas (XLS/XLSX/CSV/ODS), XML, TXT, DOC/DOCX, PPT/PPTX ou ZIP. Máx. " +
  MAX_ATTACHMENT_SIZE_LABEL + " por arquivo.";

function getExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  if (idx < 0 || idx === name.length - 1) return "";
  return name.slice(idx + 1).toLowerCase();
}

function isTypeAllowed(file: File): boolean {
  const mime = (file.type || "").toLowerCase();
  if (mime && ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p))) return true;
  if (mime && ALLOWED_MIME_EXACT.has(mime)) {
    // octet-stream: exige extensão conhecida.
    if (mime === "application/octet-stream") {
      return (ALLOWED_EXTENSIONS as readonly string[]).includes(getExtension(file.name));
    }
    return true;
  }
  // Sem MIME confiável: valida pela extensão.
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(getExtension(file.name));
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export interface AttachmentValidationResult {
  valid: File[];
  errors: string[];
}

/**
 * Valida uma lista de arquivos anexados. Retorna os aceitos e mensagens
 * de erro para os rejeitados — uma linha por arquivo, pronta para toast.
 */
export function validateAttachments(files: File[] | FileList): AttachmentValidationResult {
  const list = Array.from(files);
  const valid: File[] = [];
  const errors: string[] = [];
  for (const f of list) {
    if (!f || f.size === 0) {
      errors.push(`"${f?.name || "arquivo"}" está vazio e foi ignorado.`);
      continue;
    }
    if (f.size > MAX_ATTACHMENT_SIZE_BYTES) {
      errors.push(
        `"${f.name}" tem ${formatSize(f.size)} — excede o limite de ${MAX_ATTACHMENT_SIZE_LABEL}.`,
      );
      continue;
    }
    if (!isTypeAllowed(f)) {
      errors.push(
        `"${f.name}" tem formato não suportado. Permitidos: ${ALLOWED_ATTACHMENT_HINT}`,
      );
      continue;
    }
    valid.push(f);
  }
  return { valid, errors };
}
