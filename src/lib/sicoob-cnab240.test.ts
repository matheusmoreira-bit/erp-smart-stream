import { describe, expect, it } from "vitest";
import {
  generateSicoobCnab240,
  parseSicoobReturn,
} from "../../supabase/functions/_shared/sicoob-cnab240";

const account = {
  legalName: "Empresa Árvore Ltda",
  taxId: "12.345.678/0001-90",
  agreementCode: "CONVENIO123",
  agency: "1234",
  agencyDigit: "5",
  accountNumber: "98765",
  accountDigit: "4",
};

const title = {
  id: "invoice-42",
  barcode: "00100000000000000000000000000000000000000100",
  supplierName: "Fornecedor São José",
  supplierTaxId: "98.765.432/0001-10",
  dueDate: "2026-09-10",
  paymentDate: "2026-09-08",
  amount: 100,
  companyReference: "AP123456789012345678",
};

describe("Sicoob CNAB 240", () => {
  it("gera registros com 240 posições e lote de títulos de outro banco", () => {
    const result = generateSicoobCnab240({
      account,
      fileSequence: 7,
      generatedAt: new Date("2026-09-01T12:34:56Z"),
      titles: [title],
    });

    expect(result.records).toHaveLength(6);
    expect(result.records.every((record) => record.length === 240)).toBe(true);
    expect(result.records[0].slice(0, 8)).toBe("75600000");
    expect(result.records[1].slice(9, 16)).toBe("2031040");
    expect(result.records[2].slice(13, 14)).toBe("J");
    expect(result.records[2].slice(17, 61)).toBe(title.barcode);
    expect(result.records[3].slice(17, 19)).toBe("52");
    expect(result.content.endsWith("\r\n")).toBe(true);
  });

  it("separa títulos do Sicoob e de outros bancos em lotes", () => {
    const result = generateSicoobCnab240({
      account,
      fileSequence: 8,
      titles: [
        { ...title, id: "sicoob", barcode: `756${title.barcode.slice(3)}`, companyReference: "APSICOOB" },
        { ...title, id: "other", companyReference: "APOTHER" },
      ],
    });

    expect(result.lotCount).toBe(2);
    expect(result.records[1].slice(11, 13)).toBe("30");
    expect(result.records[5].slice(11, 13)).toBe("31");
  });

  it("gera TED e PIX em lotes próprios com segmentos A e B", () => {
    const result = generateSicoobCnab240({
      account,
      fileSequence: 11,
      titles: [
        {
          ...title,
          id: "ted",
          paymentMethod: "ted",
          barcode: null,
          companyReference: "APTED",
          bankCode: "001",
          branch: "1234",
          accountNumber: "56789",
          accountDigit: "0",
        },
        {
          ...title,
          id: "pix",
          paymentMethod: "pix",
          barcode: null,
          companyReference: "APPIX",
          pixKeyType: "cnpj",
          pixKey: "98765432000110",
        },
      ],
    });

    expect(result.lotCount).toBe(2);
    expect(result.records.every((record) => record.length === 240)).toBe(true);
    expect(result.records[1].slice(11, 13)).toBe("03");
    expect(result.records[2].slice(13, 14)).toBe("A");
    expect(result.records[3].slice(13, 14)).toBe("B");
    expect(result.records[5].slice(11, 13)).toBe("45");
    expect(result.records[6].slice(13, 14)).toBe("A");
    expect(result.records[7].slice(13, 14)).toBe("B");
  });

  it("interpreta somente ocorrência 00 como pagamento efetivado", () => {
    const generated = generateSicoobCnab240({ account, fileSequence: 9, titles: [title] });
    const returnRecords = generated.records.map((record, index) => {
      const chars = record.split("");
      if (index === 0) chars[142] = "2";
      if (index === 2) {
        chars.splice(230, 2, ..."00");
        chars.splice(144, 8, ..."08092026");
      }
      return chars.join("");
    });
    const parsed = parseSicoobReturn(returnRecords.join("\r\n"));

    expect(parsed.fileSequence).toBe(9);
    expect(parsed.titles).toHaveLength(1);
    expect(parsed.titles[0].status).toBe("paid");
    expect(parsed.titles[0].paymentDate).toBe("2026-09-08");
    expect(parsed.titles[0].paymentAmount).toBe(100);
  });

  it("não interpreta retorno agendado como pagamento", () => {
    const generated = generateSicoobCnab240({ account, fileSequence: 10, titles: [title] });
    const records = generated.records.map((record, index) => {
      const chars = record.split("");
      if (index === 0) chars[142] = "2";
      if (index === 2) chars.splice(230, 2, ..."BD");
      return chars.join("");
    });

    expect(parseSicoobReturn(records.join("\n")).titles[0].status).toBe("scheduled");
  });
});
