/**
 * Correção de preço zerado após PATCH no SAP B1 (Service Layer).
 *
 * Quando um documento já integrado é reenviado/editado — principalmente quando
 * o ItemCode da linha muda — o SAP recalcula o preço a partir da lista de
 * preços do item e costuma gravar 0, ignorando o UnitPrice enviado junto com a
 * troca do item. O contorno é aplicar um segundo PATCH contendo apenas
 * LineNum + UnitPrice + Price (sem ItemCode), que o Service Layer aceita como
 * preço manual.
 */

export type ExpectedLinePrice = {
  lineNum: number;
  unitPrice: number;
};

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const close = (a: unknown, b: unknown) => Math.abs(num(a) - num(b)) < 0.005;

async function readLines(
  baseUrl: string,
  cookies: string,
  endpoint: string,
  docEntry: number,
): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${baseUrl}/${endpoint}(${docEntry})?$select=DocumentLines`, {
    headers: { Cookie: cookies },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body as any)?.error?.message?.value || JSON.stringify(body);
    throw new Error(`Falha ao conferir o documento no ERP [${res.status}]: ${msg}`);
  }
  return Array.isArray((body as any)?.DocumentLines) ? (body as any).DocumentLines : [];
}

/**
 * Garante que cada linha ficou com o preço unitário esperado. Se o SAP tiver
 * zerado/alterado algum preço, reaplica apenas os preços e confere de novo.
 * Lança erro quando não conseguir corrigir.
 */
export async function enforceSapLinePrices(
  baseUrl: string,
  cookies: string,
  endpoint: string,
  docEntry: number,
  expected: ExpectedLinePrice[],
): Promise<{ corrected: boolean }> {
  const wanted = expected.filter((e) => num(e.unitPrice) > 0);
  if (!wanted.length) return { corrected: false };

  const lines = await readLines(baseUrl, cookies, endpoint, docEntry);
  const priceOf = (l: Record<string, unknown>) => num(l.UnitPrice ?? (l as any).Price);
  const byLineNum = new Map<number, Record<string, unknown>>();
  lines.forEach((l, idx) => byLineNum.set(num(l.LineNum ?? idx), l));

  const wrong = wanted.filter((e) => {
    const line = byLineNum.get(e.lineNum);
    if (!line) return false;
    return !close(priceOf(line), e.unitPrice);
  });
  if (!wrong.length) return { corrected: false };

  const res = await fetch(`${baseUrl}/${endpoint}(${docEntry})`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookies },
    body: JSON.stringify({
      DocumentLines: lines.map((l, idx) => {
        const lineNum = num(l.LineNum ?? idx);
        const fix = wanted.find((e) => e.lineNum === lineNum);
        const price = fix ? fix.unitPrice : priceOf(l);
        return { LineNum: lineNum, UnitPrice: price, Price: price, DiscountPercent: 0 };
      }),
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`O ERP recusou a correção de valores [${res.status}]: ${t.slice(0, 400)}`);
  }

  const after = await readLines(baseUrl, cookies, endpoint, docEntry);
  const afterByLineNum = new Map<number, Record<string, unknown>>();
  after.forEach((l, idx) => afterByLineNum.set(num(l.LineNum ?? idx), l));
  const stillWrong = wanted.filter((e) => {
    const line = afterByLineNum.get(e.lineNum);
    if (!line) return false;
    return !close(priceOf(line), e.unitPrice);
  });
  if (stillWrong.length) {
    throw new Error(
      `O ERP não gravou o valor das linhas ${stillWrong.map((e) => e.lineNum + 1).join(", ")}. ` +
        `Nenhum valor foi confirmado — revise o documento no ERP.`,
    );
  }
  return { corrected: true };
}
