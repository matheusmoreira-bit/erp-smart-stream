// Validação de código de barras / linha digitável de boletos (FEBRABAN).
// Mantido em sincronia com src/lib/boleto-barcode.ts (coberto por testes).

export interface BoletoValidation {
  ok: boolean;
  barcode: string | null;
  kind: "bancario" | "arrecadacao" | null;
  amount: number | null;
  dueDate: string | null;
  bankCode: string | null;
  error: string | null;
}

function onlyDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function mod10(block: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = block.length - 1; i >= 0; i--) {
    let n = Number(block[i]) * weight;
    if (n > 9) n = Math.floor(n / 10) + (n % 10);
    sum += n;
    weight = weight === 2 ? 1 : 2;
  }
  const r = sum % 10;
  return r === 0 ? 0 : 10 - r;
}

/** Módulo 11 do DV geral do boleto bancário (pesos 2..9). */
export function mod11Bancario(block: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = block.length - 1; i >= 0; i--) {
    sum += Number(block[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const r = 11 - (sum % 11);
  return r === 0 || r === 10 || r === 11 ? 1 : r;
}

/** Módulo 11 de arrecadação (pesos 2..9, resto 0/1 → 0, 10 → 1 conforme segmento). */
export function mod11Arrecadacao(block: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = block.length - 1; i >= 0; i--) {
    sum += Number(block[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const r = sum % 11;
  if (r === 0 || r === 1) return 0;
  if (r === 10) return 1;
  return 11 - r;
}

function fail(error: string): BoletoValidation {
  return { ok: false, barcode: null, kind: null, amount: null, dueDate: null, bankCode: null, error };
}

function dueFromFactor(factor: number, now = Date.now()): string | null {
  if (!factor) return null;
  // Ciclo antigo: base 07/10/1997. Novo ciclo: fator 1000 = 22/02/2025.
  const dayMs = 86_400_000;
  const oldCycle = Date.UTC(1997, 9, 7) + factor * dayMs;
  const newCycle = factor >= 1000 ? Date.UTC(2025, 1, 22) + (factor - 1000) * dayMs : oldCycle;
  const pick = Math.abs(newCycle - now) < Math.abs(oldCycle - now) ? newCycle : oldCycle;
  return new Date(pick).toISOString().slice(0, 10);
}

function validateBancarioBarcode(barcode: string): BoletoValidation {
  const dv = Number(barcode[4]);
  const calc = mod11Bancario(barcode.slice(0, 4) + barcode.slice(5));
  if (dv !== calc) return fail("Dígito verificador geral do código de barras inválido.");
  const factor = Number(barcode.slice(5, 9));
  const amount = Number(barcode.slice(9, 19)) / 100;
  return {
    ok: true,
    barcode,
    kind: "bancario",
    amount,
    dueDate: dueFromFactor(factor),
    bankCode: barcode.slice(0, 3),
    error: null,
  };
}

function validateArrecadacaoBarcode(barcode: string): BoletoValidation {
  const valueRef = barcode[2];
  const dv = Number(barcode[3]);
  const block = barcode.slice(0, 3) + barcode.slice(4);
  const calc = valueRef === "6" || valueRef === "7" ? mod10(block) : mod11Arrecadacao(block);
  if (dv !== calc) return fail("Dígito verificador geral do código de arrecadação inválido.");
  const amount = valueRef === "6" || valueRef === "8" ? Number(barcode.slice(4, 15)) / 100 : null;
  return { ok: true, barcode, kind: "arrecadacao", amount, dueDate: null, bankCode: null, error: null };
}

/** Aceita código de barras (44) ou linha digitável (47 bancário / 48 arrecadação). */
export function parseBoleto(input: unknown): BoletoValidation {
  const clean = onlyDigits(input);
  if (!clean) return fail("Informe o código de barras ou a linha digitável.");
  if (clean.length === 44) {
    return clean[0] === "8" ? validateArrecadacaoBarcode(clean) : validateBancarioBarcode(clean);
  }
  if (clean.length === 47) {
    const fields = [clean.slice(0, 9), clean.slice(10, 20), clean.slice(21, 31)];
    const dvs = [Number(clean[9]), Number(clean[20]), Number(clean[31])];
    for (let i = 0; i < 3; i++) {
      if (mod10(fields[i]) !== dvs[i]) return fail(`Dígito verificador do campo ${i + 1} da linha digitável inválido.`);
    }
    const barcode = `${clean.slice(0, 4)}${clean.slice(32, 33)}${clean.slice(33, 47)}${clean.slice(4, 9)}${clean.slice(10, 20)}${clean.slice(21, 31)}`;
    return validateBancarioBarcode(barcode);
  }
  if (clean.length === 48) {
    if (clean[0] !== "8") return fail("Linha digitável de 48 dígitos deve ser de arrecadação (começa com 8).");
    const valueRef = clean[2];
    const useMod10 = valueRef === "6" || valueRef === "7";
    for (let i = 0; i < 4; i++) {
      const block = clean.slice(i * 12, i * 12 + 11);
      const dv = Number(clean[i * 12 + 11]);
      const calc = useMod10 ? mod10(block) : mod11Arrecadacao(block);
      if (dv !== calc) return fail(`Dígito verificador do bloco ${i + 1} da linha digitável inválido.`);
    }
    const barcode = `${clean.slice(0, 11)}${clean.slice(12, 23)}${clean.slice(24, 35)}${clean.slice(36, 47)}`;
    return validateArrecadacaoBarcode(barcode);
  }
  return fail(`Tamanho inválido (${clean.length} dígitos). Use 44, 47 ou 48 dígitos.`);
}

/** Valida o boleto e confere o valor embutido com o valor do título (tolerância zero). */
export function validateBoletoForAmount(input: unknown, expectedAmount: number): BoletoValidation {
  const parsed = parseBoleto(input);
  if (!parsed.ok) return parsed;
  if (parsed.kind !== "bancario") {
    return { ...parsed, ok: false, error: "Boleto de arrecadação/tributo não é aceito nesta remessa." };
  }
  if (parsed.amount && parsed.amount > 0) {
    const expected = Math.round(Number(expectedAmount) * 100);
    if (Math.round(parsed.amount * 100) !== expected) {
      return {
        ...parsed,
        ok: false,
        error: `Valor do boleto (R$ ${parsed.amount.toFixed(2)}) diferente do valor do título (R$ ${(expected / 100).toFixed(2)}).`,
      };
    }
  }
  return parsed;
}
