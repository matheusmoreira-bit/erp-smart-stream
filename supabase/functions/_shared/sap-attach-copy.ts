// Helper compartilhado: garante que TODA linha de anexo enviada ao SAP B1 fique
// com "Copiar para documento de destino" (CopyToTargetDocument = tYES).
//
// Por que existe: cada função de integração tinha sua própria versão do PATCH,
// com nomes de campo divergentes (CopyToTargetDocument x CopyToTargetDoc) e sem
// verificação — quando o PATCH falhava silenciosamente o anexo ficava sem a flag.
// Aqui centralizamos: descobre as linhas reais, aplica o PATCH, confere o
// resultado e tenta variações/por linha enquanto houver linha pendente.

type Lines = Array<{ Line?: number; CopyToTargetDocument?: string; CopyToTargetDoc?: string }>;

const FIELD_VARIANTS = ["CopyToTargetDocument", "CopyToTargetDoc"] as const;

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

async function patchLines(
  baseUrl: string,
  cookies: string,
  absoluteEntry: number,
  lineNumbers: number[],
  field: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/Attachments2(${absoluteEntry})`, {
      method: "PATCH",
      headers: { Cookie: cookies, "Content-Type": "application/json" },
      body: JSON.stringify({
        Attachments2_Lines: lineNumbers.map((Line) => ({ Line, [field]: "tYES" })),
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.warn(`Attachments2 PATCH ${field} falhou [${res.status}]: ${txt.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn(`Attachments2 PATCH ${field} erro:`, (e as Error).message);
    return false;
  }
}

/**
 * Marca CopyToTargetDocument = tYES em todas as linhas do anexo `absoluteEntry`.
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

  let lines = (await fetchLines(baseUrl, cookies, absoluteEntry)) ?? fromPost;
  let lineNumbers = lines && lines.length > 0
    ? lines.map((l, idx) => (typeof l?.Line === "number" ? l.Line : idx))
    : Array.from({ length: Math.max(count, 1) }, (_, idx) => idx);

  for (const field of FIELD_VARIANTS) {
    const ok = await patchLines(baseUrl, cookies, absoluteEntry, lineNumbers, field);

    const after = await fetchLines(baseUrl, cookies, absoluteEntry);
    if (!after) {
      // Sem como verificar: considera bom se o PATCH respondeu OK.
      if (ok) return true;
      continue;
    }
    const pending = after.filter((l) => !isFlagged(l));
    if (pending.length === 0) return true;

    lines = after;
    lineNumbers = pending.map((l, idx) => (typeof l?.Line === "number" ? l.Line : idx));

    // Última tentativa da variante: linha a linha (algumas versões do SL
    // ignoram o PATCH em lote quando há linhas já marcadas).
    for (const ln of lineNumbers) {
      await patchLines(baseUrl, cookies, absoluteEntry, [ln], field);
    }
    const final = await fetchLines(baseUrl, cookies, absoluteEntry);
    if (!final || final.every(isFlagged)) return true;
    lineNumbers = final.filter((l) => !isFlagged(l)).map((l, idx) => (typeof l?.Line === "number" ? l.Line : idx));
  }

  console.warn(
    `Attachments2(${absoluteEntry}): não foi possível marcar CopyToTargetDocument em ${lineNumbers.length} linha(s).`,
  );
  return false;
}
