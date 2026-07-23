// SAP B1 Attachments2 rejeita nomes de arquivo que terminam com espaço
// (mensagem: "File name cannot end with space string."). Também é sensato
// remover caracteres de controle e barras invasoras. Este helper normaliza
// o nome preservando a extensão.

const FORBIDDEN = /[\\/:*?"<>|\x00-\x1F]/g;

export function sanitizeSapFileName(raw: string | null | undefined): string {
  const original = (raw ?? "").toString();
  // Separa nome + extensão para preservar ".pdf" mesmo se houver espaço antes.
  const dot = original.lastIndexOf(".");
  let base = dot > 0 ? original.slice(0, dot) : original;
  let ext = dot > 0 ? original.slice(dot) : "";

  base = base.replace(FORBIDDEN, "_").replace(/\s+/g, " ").trim();
  ext = ext.replace(FORBIDDEN, "_").replace(/\s+/g, "").trim();
  // Extensão também não pode ter espaço no final.
  if (ext === ".") ext = "";

  let name = (base + ext).trim();
  // Remover pontos/espaços finais que o SAP rejeita.
  name = name.replace(/[\s.]+$/g, (m) => m.includes(".") ? m.replace(/\s+/g, "") : "");
  name = name.trimEnd();
  if (!name) name = "anexo";
  // SAP limita a 100 chars no nome do anexo — dar folga.
  if (name.length > 90) {
    const d = name.lastIndexOf(".");
    if (d > 0) name = name.slice(0, 90 - (name.length - d)) + name.slice(d);
    else name = name.slice(0, 90);
  }
  return name;
}
