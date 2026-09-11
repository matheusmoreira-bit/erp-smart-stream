// Helper compartilhado: garante que TODA linha de anexo enviada ao SAP B1 fique
// com "Copiar para documento de destino" (CopyToTargetDocument = tYES).
//
// Por que existe: cada função de integração tinha sua própria versão do PATCH,
// com nomes de campo divergentes (CopyToTargetDocument x CopyToTargetDoc) e sem
// verificação — quando o PATCH falhava silenciosamente o anexo ficava sem a flag.
//
// Regras aplicadas aqui (a marcação é obrigatória):
//  - o PATCH sempre reenvia TODAS as linhas do anexo marcadas com tYES
//    (o Service Layer trata Attachments2_Lines como coleção completa; enviar
//    apenas as pendentes fazia o SL descartar/ignorar o PATCH em algumas
//    versões, deixando as caixas desmarcadas);
//  - depois de cada tentativa o resultado é conferido lendo o anexo de volta;
//  - as linhas ainda pendentes são tentadas uma a uma, nas duas variantes de
//    nome de campo, com algumas rodadas de repetição;
//  - se ainda assim sobrar linha sem a flag, o erro é logado como erro (não
//    como aviso) para aparecer na observabilidade da integração.

type Line = {
  Line?: number;
  SourcePath?: string;
  FileName?: string;
  FileExtension?: string;
  AttachmentDate?: string;
  UserID?: number;
  Override?: string;
  CopyToTargetDocument?: string;
  CopyToTargetDoc?: string;
};
type Lines = Line[];

const FIELD_VARIANTS = ["CopyToTargetDocument", "CopyToTargetDoc"] as const;
const MAX_ROUNDS = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isFlagged(l: { CopyToTargetDocument?: string; CopyToTargetDoc?: string }) {
  return l?.CopyToTargetDocument === "tYES" || l?.CopyToTargetDoc === "tYES";
}

async function fetchLines(baseUrl: string, cookies: string, absoluteEntry: number): Promise<Lines | null> {
  try {
    const res = await fetch(`${baseUrl}/Attachments2(${absoluteEntry})`, {
      method: "GET",
      headers: { Cookie: cookies, "Content-Type": "application/json" },
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => ({}));
    return Array.isArray(body?.Attachments2_Lines) ? (body.Attachments2_Lines as Lines) : null;
  } catch {
    return null;
  }
}

/** Logo após o POST as linhas podem demorar a aparecer; tentamos algumas vezes. */
async function fetchLinesWithRetry(
  baseUrl: string,
  cookies: string,
  absoluteEntry: number,
  attempts = 3,
): Promise<Lines | null> {
  for (let i = 1; i <= attempts; i++) {
    const lines = await fetchLines(baseUrl, cookies, absoluteEntry);
    if (lines && lines.length > 0) return lines;
    if (i < attempts) await sleep(500 * i);
  }
  return null;
}

/**
 * O Service Layer ignora silenciosamente um PATCH que traga apenas
 * `{ Line, CopyToTargetDocument }`: a linha precisa vir identificada pelos
 * campos de origem do arquivo. Por isso reenviamos a linha completa.
 */
function buildLinePayload(known: Lines | null, lineNumber: number, field: string): Record<string, unknown> {
  const source = known?.find((l) => Number(l?.Line) === lineNumber);
  const payload: Record<string, unknown> = { Line: lineNumber, [field]: "tYES" };
  if (source) {
    for (const key of ["SourcePath", "FileName", "FileExtension", "AttachmentDate", "UserID", "Override"] as const) {
      const value = source[key];
      if (value !== undefined && value !== null && value !== "") payload[key] = value;
    }
  }
  return payload;
}

async function patchLines(
  baseUrl: string,
  cookies: string,
  absoluteEntry: number,
  lineNumbers: number[],
  field: string,
  known: Lines | null,
): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/Attachments2(${absoluteEntry})`, {
      method: "PATCH",
      headers: { Cookie: cookies, "Content-Type": "application/json" },
      body: JSON.stringify({
        Attachments2_Lines: lineNumbers.map((line) => buildLinePayload(known, line, field)),
      }),
    });
    if (!res.ok && res.status !== 204) {
      const txt = (await res.text().catch(() => "")).replace(/\s+/g, " ");
      console.warn(`Attachments2 PATCH ${field} falhou [${res.status}]: ${txt.slice(0, 400)}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn(`Attachments2 PATCH ${field} erro:`, (e as Error).message);
    return false;
  }
}

function allLineNumbers(lines: Lines | null, count: number): number[] {
  if (lines && lines.length > 0) {
    return lines.map((l, idx) => (typeof l?.Line === "number" ? l.Line : idx));
  }
  return Array.from({ length: Math.max(count, 1) }, (_, idx) => idx);
}

/**
 * Marca CopyToTargetDocument = tYES em TODAS as linhas do anexo `absoluteEntry`.
 * @param postBody corpo retornado pelo POST /Attachments2 (opcional)
 * @param count quantidade de arquivos enviados (fallback quando não há linhas)
 * @returns true se todas as linhas ficaram marcadas (ou não foi possível verificar após sucesso do PATCH)
 */
export async function ensureCopyToTargetDocument(
  baseUrl: string,
  cookies: string,
  absoluteEntry: number | null | undefined,
  postBody?: unknown,
  count = 0,
): Promise<boolean> {
  if (absoluteEntry == null) return false;

  const fromPost = Array.isArray((postBody as { Attachments2_Lines?: Lines })?.Attachments2_Lines)
    ? ((postBody as { Attachments2_Lines: Lines }).Attachments2_Lines)
    : null;

  let lines = (await fetchLinesWithRetry(baseUrl, cookies, absoluteEntry)) ?? fromPost;
  let unverified = false;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    for (const field of FIELD_VARIANTS) {
      // Sempre reenviamos a coleção COMPLETA marcada, nunca só as pendentes.
      const everyLine = allLineNumbers(lines, count);
      const ok = await patchLines(baseUrl, cookies, absoluteEntry, everyLine, field, lines);

      let after = await fetchLines(baseUrl, cookies, absoluteEntry);
      if (!after) {
        unverified = unverified || ok;
      } else {
        let pending = after.filter((l) => !isFlagged(l));
        if (pending.length === 0) return true;

        // Algumas versões do SL ignoram o PATCH em lote quando já há linhas
        // marcadas: tentamos linha a linha as que sobraram.
        for (const ln of pending.map((l, idx) => (typeof l?.Line === "number" ? l.Line : idx))) {
          await patchLines(baseUrl, cookies, absoluteEntry, [ln], field, after);
        }
        after = (await fetchLines(baseUrl, cookies, absoluteEntry)) ?? after;
        pending = after.filter((l) => !isFlagged(l));
        if (pending.length === 0) return true;
        lines = after;
      }
    }
    if (round < MAX_ROUNDS) await sleep(800 * round);
  }

  const final = await fetchLines(baseUrl, cookies, absoluteEntry);
  if (final && final.length > 0 && final.every(isFlagged)) return true;
  if (!final && unverified) return true;

  const pendingCount = final ? final.filter((l) => !isFlagged(l)).length : allLineNumbers(lines, count).length;
  console.error(
    `Attachments2(${absoluteEntry}): "Copiar para documento de destino" NÃO ficou marcado em ${pendingCount} linha(s).`,
  );
  return false;
}

/**
 * Reaplica a marcação em um anexo já existente (usado em varreduras de
 * correção). Retorna o estado final das linhas para relatório.
 */
export async function repairCopyToTargetDocument(
  baseUrl: string,
  cookies: string,
  absoluteEntry: number,
): Promise<{ ok: boolean; totalLines: number; pendingLines: number }> {
  const ok = await ensureCopyToTargetDocument(baseUrl, cookies, absoluteEntry);
  const lines = (await fetchLines(baseUrl, cookies, absoluteEntry)) ?? [];
  return {
    ok,
    totalLines: lines.length,
    pendingLines: lines.filter((l) => !isFlagged(l)).length,
  };
}
