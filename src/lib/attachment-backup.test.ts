import { describe, expect, it, vi } from "vitest";
import { BUCKETS, PART_BYTES, splitParts, zipPath, fileKey, retryFile, type BackupFile } from "./attachment-backup";
const file = (name: string, bytes = 10): BackupFile => ({ bucket: "nfse-pdfs", name, bytes, version: "1" });

describe("backup local de anexos", () => {
  it("limita as partes a aproximadamente 200 MB incluindo margem ZIP", () => {
    expect(PART_BYTES).toBe(209715200);
    expect(splitParts([file("a.pdf", 110 * 1048576), file("b.pdf", 110 * 1048576)]).parts.map(p => p.length)).toEqual([1, 1]);
    expect(splitParts([file("gigante.pdf", PART_BYTES)]).rejected).toHaveLength(1);
  });
  it("preserva pasta e nome de nfse-pdfs", () => {
    expect(zipPath(file("SBO_CACTUS/nota 1.pdf"))).toBe("outros-anexos/nfse-pdfs/SBO_CACTUS/nota 1.pdf");
  });
  it("preserva empresa e caminho SAP no destino compartilhado", () => {
    expect(zipPath({ ...file("SBO_CACTUS/Orders/123/a.pdf"), bucket: "sap-archive" })).toBe("arquivo-sap/SBO_CACTUS/anexos/Orders/123/a.pdf");
  });
  it("rejeita traversal e colisões sem sobrescrever arquivos", () => {
    expect(splitParts([file("../secret"), file("a.pdf"), file("a.pdf")]).rejected).toHaveLength(2);
  });
  it("inclui os seis buckets no fluxo de ZIP sem bloquear os dois autorizados", () => {
    expect(BUCKETS).toEqual(["expense-attachments", "sap-archive", "registration-attachments", "nf-entrada-files", "nfse-pdfs", "nfse-xmls"]);
    const files = BUCKETS.map(bucket => ({ ...file(bucket === "sap-archive" ? "SBO_CACTUS/a.pdf" : "folder/a.pdf"), bucket }));
    expect(splitParts(files).parts.flat()).toHaveLength(6);
    expect(splitParts(files).rejected).toEqual([]);
  });
  it("preserva o destino de expense-attachments", () => {
    expect(zipPath({ ...file("uuid/nota.pdf"), bucket: "expense-attachments" })).toBe("anexos-pedidos-flow/uuid/nota.pdf");
  });
  it("preserva o destino de nfse-xmls", () => {
    expect(zipPath({ ...file("SBO_CACTUS/nota.xml"), bucket: "nfse-xmls" })).toBe("outros-anexos/nfse-xmls/SBO_CACTUS/nota.xml");
  });
  it("tenta no máximo três vezes", async () => {
    vi.useFakeTimers();
    const op = vi.fn().mockRejectedValue(new Error("falhou"));
    const result = retryFile(op, () => false).catch(e => e.message);
    await vi.runAllTimersAsync();
    expect(await result).toBe("falhou"); expect(op).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
  it("não inicia download cancelado", async () => {
    const op = vi.fn();
    await expect(retryFile(op, () => true)).rejects.toThrow("Cancelado");
    expect(op).not.toHaveBeenCalled();
  });
  it("retoma apenas arquivos já solicitados da mesma versão", () => {
    const a = file("a.pdf"); const b = file("b.pdf");
    const completed = new Set([fileKey(a)]);
    expect([a, b, { ...a, version: "2" }].filter(f => !completed.has(fileKey(f)))).toEqual([b, { ...a, version: "2" }]);
  });
});