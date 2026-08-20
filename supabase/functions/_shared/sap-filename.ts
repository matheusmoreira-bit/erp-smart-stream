// SAP B1 Attachments2 rejeita nomes de arquivo que terminam com espaço
// (mensagem: "File name cannot end with space string."). Também é sensato
// remover caracteres de controle e barras invasoras. Este helper normaliza
// o nome preservando a extensão.

const FORBIDDEN = /[\\/:*?"<>|\x00-\x1F]/g;

// SAP separa o anexo em FileName + FileExtension. Um nome sem extensão faz o
// Service Layer rejeitar a linha ("Property 'files...' of 'Attachments2_Line'
// is invalid"), então garantimos sempre uma extensão válida.
const MIME_EXT: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "text/xml": ".xml",
  "application/xml": ".xml",
  "application/json": ".json",
  "application/zip": ".zip",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
};

export function sanitizeSapFileName(raw: string | null | undefined, mimeType?: string | null): string {
  const original = (raw ?? "").toString();
  // Separa nome + extensão para preservar ".pdf" mesmo se houver espaço antes.
  const dot = original.lastIndexOf(".");
  let base = dot > 0 ? original.slice(0, dot) : original;
  let ext = dot > 0 ? original.slice(dot) : "";


  base = base.replace(FORBIDDEN, "_").replace(/\s+/g, " ").trim();
  ext = ext.replace(FORBIDDEN, "_").replace(/\s+/g, "").trim();
  // Extensão também não pode ter espaço no final.
  if (ext === ".") ext = "";
  // Extensão precisa ser alfanumérica curta; senão tratamos como parte do nome.
  if (ext && !/^\.[A-Za-z0-9]{1,8}$/.test(ext)) {
    base = (base + ext).trim();
    ext = "";
  }
  if (!ext) ext = MIME_EXT[(mimeType || "").toLowerCase().split(";")[0].trim()] || ".pdf";

  let name = (base + ext).trim();
  // Remover espaços antes da extensão / pontos finais que o SAP rejeita.
  name = name.replace(/\s+(\.[A-Za-z0-9]{1,8})$/, "$1");
  name = name.trimEnd();
  if (!name || name === ext) name = `anexo${ext}`;

  // SAP limita a 100 chars no nome do anexo — dar folga.
  if (name.length > 90) {
    const d = name.lastIndexOf(".");
    if (d > 0) name = name.slice(0, 90 - (name.length - d)) + name.slice(d);
    else name = name.slice(0, 90);
  }
  return name;
}
