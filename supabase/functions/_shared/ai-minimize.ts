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
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("Imagem JPEG inválida.");
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let i = 2;
  while (i < bytes.length) {
    const start = i;
    if (bytes[i++] !== 0xff) throw new Error("Estrutura JPEG inválida.");
    while (bytes[i] === 0xff) i++;
    const marker = bytes[i++];
    if (marker === 0xd9) {
      parts.push(bytes.subarray(start, i));
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let offset = 0;
      for (const part of parts) { out.set(part, offset); offset += part.length; }
      return out; // Do not send arbitrary data appended after EOI.
    }
    if (i + 2 > bytes.length) throw new Error("Segmento JPEG truncado.");
    const len = (bytes[i] << 8) | bytes[i + 1];
    if (len < 2 || i + len > bytes.length) throw new Error("Segmento JPEG truncado.");
    const end = i + len;
    const drop = (marker >= 0xe1 && marker <= 0xef && marker !== 0xee) || marker === 0xfe;
    if (!drop) parts.push(bytes.subarray(start, end));
    i = end;
    if (marker === 0xda) {
      const scanStart = i;
      // Escaped FF00 bytes and restart markers are image data. Other markers
      // end this scan; process them too (including metadata between scans).
      while (i < bytes.length) {
        if (bytes[i] !== 0xff) { i++; continue; }
        let j = i + 1;
        while (bytes[j] === 0xff) j++;
        if (bytes[j] === 0 || (bytes[j] >= 0xd0 && bytes[j] <= 0xd7)) { i = j + 1; continue; }
        break;
      }
      parts.push(bytes.subarray(scanStart, i));
    }
  }
  throw new Error("JPEG sem terminador.");
}

function stripPng(bytes: Uint8Array): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8 || sig.some((b, k) => bytes[k] !== b)) throw new Error("Imagem PNG inválida.");
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let i = 8;
  let ended = false;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (i + 12 <= bytes.length) {
    const len = dv.getUint32(i);
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
    const end = i + 12 + len;
    if (end > bytes.length) throw new Error("Chunk PNG truncado.");
    if (!["tEXt", "iTXt", "zTXt", "eXIf", "tIME"].includes(type)) parts.push(bytes.subarray(i, end));
    i = end;
    if (type === "IEND") { ended = true; break; }
  }
  if (!ended) throw new Error("PNG sem terminador.");
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** RFC 9649: remove EXIF/XMP, clear VP8X flags and rebuild RIFF length. */
function stripWebp(bytes: Uint8Array): Uint8Array {
  const text = (a: number, b: number) => String.fromCharCode(...bytes.subarray(a, b));
  if (bytes.length < 20 || text(0, 4) !== "RIFF" || text(8, 12) !== "WEBP") throw new Error("Imagem WebP inválida.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = view.getUint32(4, true) + 8;
  if (end > bytes.length || end < 20) throw new Error("WebP truncado.");
  const parts: Uint8Array[] = [bytes.slice(0, 12)];
  for (let i = 12; i < end;) {
    if (i + 8 > end) throw new Error("Chunk WebP truncado.");
    const length = view.getUint32(i + 4, true);
    const next = i + 8 + length + (length % 2);
    if (next > end) throw new Error("Chunk WebP truncado.");
    const kind = text(i, i + 4);
    if (kind !== "EXIF" && kind !== "XMP ") {
      const part = bytes.slice(i, next);
      if (kind === "VP8X") {
        if (length !== 10) throw new Error("Cabeçalho WebP inválido.");
        part[8] &= ~0x0c;
      }
      parts.push(part);
    }
    i = next;
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  return out;
}

/** JPEG/PNG/WebP fail closed on malformed containers. Other formats need separate coverage. */
export function stripImageMetadata(bytes: Uint8Array, mime: string): Uint8Array {
  const m = (mime || "").toLowerCase();
  if (m === "image/jpeg" || m === "image/jpg") return stripJpeg(bytes);
  if (m === "image/png") return stripPng(bytes);
  if (m === "image/webp") return stripWebp(bytes);
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
    // Só 15/16 dígitos (Amex/Visa/Master) com Luhn válido — não pega CNPJ (14) nem CPF (11).
    .replace(/(?<![\d.\/])(?:\d[ -]?){14,15}\d(?![\d.\/])/g, (m) => {
      const d = m.replace(/\D/g, "");
      return (d.length === 15 || d.length === 16) && luhnOk(d) ? `[cartão ****${d.slice(-4)}]` : m;
    })
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[e-mail]")
    // Telefone só no formato com DDD entre parênteses ou com hífen — nunca sequência pura de dígitos.
    .replace(/(?<!\d)(?:\+?55\s?)?\(\d{2}\)\s?9?\d{4}-?\d{4}(?!\d)/g, "[telefone]")
    .replace(/(?<!\d)\+55\s?\d{2}\s?9?\d{4}-?\d{4}(?!\d)/g, "[telefone]");
}

/** Tamanho aproximado em bytes de um base64. */
export function base64Bytes(b64: string): number {
  return Math.floor((b64.length * 3) / 4);
}
