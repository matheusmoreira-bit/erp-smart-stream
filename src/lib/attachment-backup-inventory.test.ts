import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { BUCKETS, loadInventories, parseInventory, type BackupFile, type InventoryRow } from "./attachment-backup";

describe("inventário com RLS por bucket", () => {
  it("aceita todos os 4.368 arquivos sem truncar em 1.000", () => {
    const data = Array.from({ length: 4368 }, (_, i) => ({ name: `${i}/nota.pdf`, bytes: "123", version: "2026-11-03T14:42:00Z" }));
    const files = parseInventory("expense-attachments", data);
    expect(files).toHaveLength(4368);
    expect(files[4367]).toEqual({ bucket: "expense-attachments", name: "4367/nota.pdf", bytes: 123, version: "2026-11-03T14:42:00Z" });
  });
  it("não transforma metadados ausentes em arquivos de zero bytes", () => {
    expect(() => parseInventory("nfse-pdfs", [{ name: "a.pdf", bytes: null, version: "1" }])).toThrow();
    expect(() => parseInventory("nfse-pdfs", [{ name: "a.pdf", bytes: "NaN", version: "1" }])).toThrow();
    expect(parseInventory("nfse-pdfs", [])).toEqual([]);
  });
  it("entrega nfse-pdfs mesmo enquanto expense-attachments está pendente e isola erros", async () => {
    let finish: ((files: BackupFile[]) => void) | undefined;
    const slow = new Promise<BackupFile[]>(resolve => { finish = resolve; });
    const rows: InventoryRow[] = [];
    const requests: string[] = [];
    const run = loadInventories(async bucket => {
      requests.push(bucket);
      if (bucket === "expense-attachments") return slow;
      if (bucket === "nfse-xmls") throw new Error("Consulta recusada");
      return parseInventory(bucket, [{ name: "nota.pdf", bytes: "100", version: "1" }]);
    }, row => rows.push(row));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(requests).toEqual(BUCKETS);
    expect(rows.find(r => r.bucket === "nfse-pdfs")?.files).toHaveLength(1);
    expect(rows.find(r => r.bucket === "nfse-xmls")?.error).toBe("Consulta recusada");
    expect(rows.find(r => r.bucket === "expense-attachments")).toBeUndefined();
    if (!finish) throw new Error("Callback não inicializado");
    finish([]);
    await run;
    expect(rows).toHaveLength(6);
  });
  it("RPC não eleva privilégios nem concede permissões de Storage", () => {
    const sql = readFileSync("drizzle/migrations/0075_attachment_backup_inventory_invoker.sql", "utf8");
    expect(sql).toMatch(/SECURITY INVOKER/);
    expect(sql).not.toMatch(/SECURITY DEFINER|CREATE POLICY|GRANT SELECT|INSERT INTO|UPDATE storage|DELETE FROM/i);
    expect(sql).toContain("public.has_role(auth.uid(), 'admin'::public.app_role)");
    expect(sql).toContain("FROM storage.objects AS o");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.attachment_backup_inventory(text) FROM PUBLIC, anon");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.attachment_backup_inventory(text) TO authenticated");
    for (const bucket of BUCKETS) expect(sql).toContain(`'${bucket}'`);
  });
});