// F14: minimização de dados antes de enviar documentos à IA.
//
// - Imagens: remove metadados que não servem para ler o documento
//   (EXIF com GPS/aparelho, XMP, IPTC, comentários, textos embutidos em PNG).
// - Texto: mascara números de cartão (PAN, conferidos por Luhn), e-mails e
//   telefones, que não são necessários para extrair uma despesa.
// Campos fiscais necessários (CNPJ/CPF do emitente, valor, datas, linha
// digitável/PIX do beneficiário para pagamento) continuam legíveis — eles são
// o objetivo da leitura. O que sai além disso é descartado depois (ver
// `minimizeAiResult`).

function stripJpeg(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const out: number[] = [0xff, 0xd8];
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return bytes; // formato inesperado: não mexe
    const marker = bytes[i + 1];
    if (marker === 0xda) { // início dos dados da imagem: copia o resto
      for (let j = i; j < bytes.length; j++) out.push(bytes[j]);
      return new Uint8Array(out);
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2 || i + 2 + len > bytes.length) return bytes;
    // APP1 (EXIF/XMP), APP13 (IPTC), APP2..APP15 exceto APP14 (cor), COM (comentário)
    const drop = (marker >= 0xe1 && marker <= 0xef && marker !== 0xee) || marker === 0xfe;
    if (!drop) for (let j = i; j < i + 2 + len; j++) out.push(bytes[j]);
    i += 2 + len;
  }
  return bytes;
}

function stripPng(bytes: Uint8Array): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8 || sig.some((b, k) => bytes[k] !== b)) return bytes;
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let i = 8;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (i + 12 <= bytes.length) {
    const len = dv.getUint32(i);
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
    const end = i + 12 + len;
    if (end > bytes.length) return bytes;
    if (!["tEXt", "iTXt", "zTXt", "eXIf", "tIME"].includes(type)) parts.push(bytes.subarray(i, end));
    i = end;
    if (type === "IEND") break;
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Remove metadados de JPEG/PNG. Outros formatos voltam sem alteração. */
export function stripImageMetadata(bytes: Uint8Array, mime: string): Uint8Array {
  try {
    const m = (mime || "").toLowerCase();
    if (m === "image/jpeg" || m === "image/jpg") return stripJpeg(bytes);
    if (m === "image/png") return stripPng(bytes);
  } catch { /* em dúvida, envia o original */ }
  return bytes;
}

function luhnOk(d: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** Mascara cartões, e-mails e telefones em texto antes de enviar à IA. */
export function maskTextForAi(text: string): string {
  return text
    .replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => {
      const d = m.replace(/\D/g, "");
      return d.length >= 13 && d.length <= 19 && luhnOk(d) ? `[cartão ****${d.slice(-4)}]` : m;
    })
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[e-mail]")
    .replace(/(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}-?\d{4}\b/g, (m) => (m.replace(/\D/g, "").length >= 10 ? "[telefone]" : m));
}

/** Tamanho aproximado em bytes de um base64. */
export function base64Bytes(b64: string): number {
  return Math.floor((b64.length * 3) / 4);
}
