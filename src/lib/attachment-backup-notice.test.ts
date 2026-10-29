import { describe, it, expect } from "vitest";
import { bucketForDrivePath, compareBucket, decide, sapInitialLoadDone } from "../../supabase/functions/attachment-backup-notice/core";

describe("aviso de anexos pendentes", () => {
  it("bucket sai do aviso quando nome e tamanho batem no Drive", () => {
    const s = compareBucket("nfse-pdfs", [{ name: "a/b/nota.pdf", bytes: 10 }], [{ name: "nota.pdf", bytes: 10 }]);
    expect(s.complete).toBe(true);
  });
  it("tamanho diferente continua pendente", () => {
    expect(compareBucket("nfse-pdfs", [{ name: "nota.pdf", bytes: 10 }], [{ name: "nota.pdf", bytes: 9 }]).complete).toBe(false);
  });
  it("mapeia subpastas do Drive aos buckets", () => {
    expect(bucketForDrivePath(["arquivo-sap", "SBO_CACTUS", "anexos", "oPOR"])).toBe("sap-archive");
    expect(bucketForDrivePath(["outros-anexos", "nfse-xmls"])).toBe("nfse-xmls");
    expect(bucketForDrivePath(["dados", "x"])).toBeNull();
  });
  it("carga SAP só conclui com as 5 empresas completas e sem anexo pendente", () => {
    const cos = ["a", "b"];
    expect(sapInitialLoadDone(cos, [{ company_db: "a", completed: true }], 0)).toBe(false);
    expect(sapInitialLoadDone(cos, [{ company_db: "a", completed: true }, { company_db: "b", completed: true }], 3)).toBe(false);
    expect(sapInitialLoadDone(cos, [{ company_db: "a", completed: true }, { company_db: "b", completed: true }], 0)).toBe(true);
  });
  it("aviso inicial uma vez, semanal enquanto pendente, final e depois para", () => {
    const base = { allComplete: false, sapDone: true, initialSent: false, completed: false };
    expect(decide("check", base)).toBe("initial");
    expect(decide("check", { ...base, initialSent: true })).toBe("none");
    expect(decide("weekly", { ...base, initialSent: true })).toBe("weekly");
    expect(decide("weekly", { ...base, allComplete: true })).toBe("final");
    expect(decide("weekly", { ...base, allComplete: true, completed: true })).toBe("none");
  });
});
