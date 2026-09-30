import { describe, expect, it } from "vitest";
import { mod10, mod11Bancario, parseBoleto, validateBoletoForAmount } from "./boleto-barcode";

function buildBarcode(amountCents: number, factor = 1500): string {
  const body = `7569${String(factor).padStart(4, "0")}${String(amountCents).padStart(10, "0")}1234567890123456789012345`;
  // body sem DV: banco(3)+moeda(1) + fator + valor + campo livre(25) = 43
  const dv = mod11Bancario(body);
  return `${body.slice(0, 4)}${dv}${body.slice(4)}`;
}

function toDigitableLine(barcode: string): string {
  const f1 = barcode.slice(0, 4) + barcode.slice(19, 24);
  const f2 = barcode.slice(24, 34);
  const f3 = barcode.slice(34, 44);
  return `${f1}${mod10(f1)}${f2}${mod10(f2)}${f3}${mod10(f3)}${barcode[4]}${barcode.slice(5, 19)}`;
}

describe("boleto-barcode", () => {
  it("aceita código de barras válido e extrai o valor", () => {
    const code = buildBarcode(123456);
    const result = parseBoleto(code);
    expect(result.ok).toBe(true);
    expect(result.amount).toBe(1234.56);
    expect(result.bankCode).toBe("756");
  });

  it("converte linha digitável de 47 dígitos", () => {
    const code = buildBarcode(5000);
    const result = parseBoleto(toDigitableLine(code));
    expect(result.ok).toBe(true);
    expect(result.barcode).toBe(code);
  });

  it("recusa DV errado", () => {
    const code = buildBarcode(5000);
    const broken = code.slice(0, 4) + ((Number(code[4]) + 1) % 10) + code.slice(5);
    expect(parseBoleto(broken).ok).toBe(false);
  });

  it("recusa DV de campo errado na linha digitável", () => {
    const line = toDigitableLine(buildBarcode(5000));
    const broken = line.slice(0, 9) + ((Number(line[9]) + 1) % 10) + line.slice(10);
    expect(parseBoleto(broken).ok).toBe(false);
  });

  it("confere o valor com tolerância zero", () => {
    const code = buildBarcode(10000);
    expect(validateBoletoForAmount(code, 100).ok).toBe(true);
    expect(validateBoletoForAmount(code, 100.01).ok).toBe(false);
  });

  it("recusa tamanho inválido", () => {
    expect(parseBoleto("123").ok).toBe(false);
  });
});
