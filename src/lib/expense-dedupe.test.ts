import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  partitionDuplicates,
  hasInFlightGuardTripped,
  findExistingClaims,
  claimDocumentHashes,
} from "./expense-dedupe";

describe("partitionDuplicates", () => {
  it("separa hashes novos dos já existentes", () => {
    const res = partitionDuplicates(
      ["a", "b", "c", "a"],
      new Set(["b"]),
    );
    expect(res.fresh).toEqual(["a", "c", "a"]);
    expect(res.duplicates).toEqual(["b"]);
  });

  it("retorna tudo como fresco se o existing estiver vazio", () => {
    const res = partitionDuplicates(["x", "y"], []);
    expect(res.fresh).toEqual(["x", "y"]);
    expect(res.duplicates).toEqual([]);
  });
});

describe("hasInFlightGuardTripped", () => {
  it("bloqueia quando ref já marcado (evita 2ª chamada de IA/despesa)", () => {
    const ref = { current: false };
    expect(hasInFlightGuardTripped(ref)).toBe(false);
    ref.current = true;
    expect(hasInFlightGuardTripped(ref)).toBe(true);
  });
});

// --- Fake Supabase client mínimo para exercitar findExistingClaims/claim ---
function makeSupabaseMock(opts: {
  selectRows?: unknown[];
  selectError?: unknown;
  insertError?: unknown;
  insertReturn?: unknown[];
}) {
  const selectImpl = vi.fn(async () => ({
    data: opts.selectRows ?? [],
    error: opts.selectError ?? null,
  }));
  const insertImpl = vi.fn(() => ({
    select: vi.fn(async () => ({
      data: opts.insertReturn ?? [],
      error: opts.insertError ?? null,
    })),
  }));
  return {
    from: vi.fn(() => ({
      select: () => ({ in: selectImpl }),
      insert: insertImpl,
    })),
    _selectImpl: selectImpl,
    _insertImpl: insertImpl,
  };
}

describe("findExistingClaims", () => {
  it("retorna [] sem chamar rede quando lista vazia", async () => {
    const sb = makeSupabaseMock({});
    const res = await findExistingClaims(sb as never, []);
    expect(res).toEqual([]);
    expect(sb.from).not.toHaveBeenCalled();
  });

  it("retorna linhas existentes", async () => {
    const rows = [
      {
        file_hash: "h1",
        submitted_by: "u1",
        supplier_label: "ACME",
        doc_type: "purchase",
        file_name: "nf.pdf",
        created_at: "2026-07-07T00:00:00Z",
      },
    ];
    const sb = makeSupabaseMock({ selectRows: rows });
    const res = await findExistingClaims(sb as never, ["h1", "h2"]);
    expect(res).toEqual(rows);
  });

  it("propaga erro para o caller (fail-closed)", async () => {
    const sb = makeSupabaseMock({ selectError: { message: "boom" } });
    await expect(findExistingClaims(sb as never, ["x"])).rejects.toBeDefined();
  });
});

describe("claimDocumentHashes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("é no-op quando não há claims (evita despesa duplicada por 2º click)", async () => {
    const sb = makeSupabaseMock({});
    const res = await claimDocumentHashes(sb as never, "user-1", []);
    expect(res).toEqual({ inserted: 0, conflict: false });
    expect(sb.from).not.toHaveBeenCalled();
  });

  it("insere e retorna a contagem", async () => {
    const sb = makeSupabaseMock({ insertReturn: [{ file_hash: "h1" }] });
    const res = await claimDocumentHashes(sb as never, "user-1", [
      { fileHash: "h1", fileName: "a.pdf", fileSize: 10 },
    ]);
    expect(res.inserted).toBe(1);
    expect(res.conflict).toBe(false);
  });

  it("detecta corrida via unique_violation (23505)", async () => {
    const sb = makeSupabaseMock({
      insertError: { code: "23505", message: "duplicate key" },
    });
    const res = await claimDocumentHashes(sb as never, "user-1", [
      { fileHash: "h1" },
    ]);
    expect(res.conflict).toBe(true);
    expect(res.inserted).toBe(0);
  });
});

// --- Simulação do fluxo cancelar → retentar (não deve duplicar) ---
describe("cenário cancelar/retentar", () => {
  it("guard impede segunda chamada de IA enquanto a 1ª estiver em vôo", async () => {
    const ref = { current: false };
    const call = vi.fn(async () => {
      if (hasInFlightGuardTripped(ref)) return "skipped";
      ref.current = true;
      try {
        await new Promise((r) => setTimeout(r, 5));
        return "ran";
      } finally {
        ref.current = false;
      }
    });
    const [a, b] = await Promise.all([call(), call()]);
    // Uma roda, a outra é rejeitada pelo guard.
    expect([a, b].sort()).toEqual(["ran", "skipped"]);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("após cancelar (ref liberado), retentar roda de novo — mas só uma vez", async () => {
    const ref = { current: false };
    const call = vi.fn(async () => {
      if (hasInFlightGuardTripped(ref)) return "skipped";
      ref.current = true;
      try {
        return "ran";
      } finally {
        ref.current = false;
      }
    });
    expect(await call()).toBe("ran"); // 1ª tentativa
    // cancelamento externo -> ref já foi liberado pelo finally
    expect(await call()).toBe("ran"); // retentativa
    // duplo-click imediato: a 2ª chamada síncrona ainda enxerga ref=false,
    // então testamos o caso de reentrada concorrente:
    const [x, y] = await Promise.all([call(), call()]);
    expect([x, y].sort()).toEqual(["ran", "skipped"]);
  });

  it("claim é idempotente frente a duplicata (não cria despesa fantasma)", async () => {
    const sb = makeSupabaseMock({
      insertError: { code: "23505", message: "dup" },
    });
    // 1º submit conclui; 2º submit (retry) tenta reivindicar os MESMOS hashes.
    const res = await claimDocumentHashes(sb as never, "user-1", [
      { fileHash: "same-hash" },
    ]);
    expect(res.conflict).toBe(true);
    expect(res.inserted).toBe(0);
  });
});
