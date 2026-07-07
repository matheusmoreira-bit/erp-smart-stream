/**
 * Testes de `src/lib/report-pdf.ts`.
 *
 * Estratégia: como jsPDF/autoTable geram binário e não conseguimos "ler" o PDF
 * gerado, interceptamos as chamadas de baixo nível (`doc.text`, `autoTable`,
 * `doc.save`) por meio de mocks das dependências e verificamos que os campos,
 * datas e itens corretos foram enviados para renderização.
 *
 * Cobre os três cenários pedidos:
 *  - Despesa (compra) via `exportExpenseDetailPdf` com `mode: "purchase"`.
 *  - Pedido de venda via `exportExpenseDetailPdf` com `mode: "sales"`.
 *  - Aprovação (listagem) via `exportListReportPdf` (é o export usado pelas
 *    telas de Approvals/Histórico).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Instrumentação global — armazena chamadas feitas pelos exports.
// ---------------------------------------------------------------------------

interface AutoTableCall {
  head?: unknown[][];
  body?: unknown[][];
  startY?: number;
}

const captured = {
  textCalls: [] as string[],
  autoTables: [] as AutoTableCall[],
  savedFiles: [] as string[],
  addedPages: 0,
  lastConstructorOpts: null as unknown,
};

function resetCaptured() {
  captured.textCalls = [];
  captured.autoTables = [];
  captured.savedFiles = [];
  captured.addedPages = 0;
  captured.lastConstructorOpts = null;
}

// ---- Mock jsPDF -----------------------------------------------------------
vi.mock("jspdf", () => {
  class FakePDF {
    internal = {
      pageSize: { getWidth: () => 210, getHeight: () => 297 },
    };
    // lastAutoTable é lido depois de cada autoTable para posicionar o cursor
    lastAutoTable = { finalY: 20 };

    constructor(opts: unknown) {
      captured.lastConstructorOpts = opts;
    }
    setFillColor() {}
    setTextColor() {}
    setDrawColor() {}
    setFont() {}
    setFontSize() {}
    rect() {}
    line() {}
    setPage() {}
    addPage() { captured.addedPages += 1; }
    getNumberOfPages() { return 1; }
    splitTextToSize(text: string) { return [String(text)]; }
    text(payload: string | string[]) {
      if (Array.isArray(payload)) captured.textCalls.push(...payload.map(String));
      else captured.textCalls.push(String(payload));
    }
    save(name: string) { captured.savedFiles.push(name); }
  }
  return { jsPDF: FakePDF };
});

// ---- Mock jspdf-autotable -------------------------------------------------
vi.mock("jspdf-autotable", () => {
  const autoTable = vi.fn((_doc: unknown, opts: AutoTableCall) => {
    captured.autoTables.push({
      head: opts.head,
      body: opts.body,
      startY: opts.startY,
    });
  });
  return { default: autoTable };
});

// ---- Mock supabase (auth + expense_approval_log) --------------------------
const mockLogRows: Array<Record<string, unknown>> = [];
vi.mock("@/integrations/supabase/client", () => {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockImplementation(() =>
      Promise.resolve({ data: mockLogRows.slice(), error: null }),
    ),
  };
  return {
    supabase: {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { email: "tester@example.com" } } }) },
      from: vi.fn().mockReturnValue(builder),
    },
  };
});

// Import DEPOIS dos mocks para que o módulo já pegue os stubs.
import {
  exportExpenseDetailPdf,
  exportListReportPdf,
  exportListReportCsv,
} from "./report-pdf";

// Helpers ------------------------------------------------------------------
const hasText = (needle: string | RegExp) =>
  captured.textCalls.some((t) =>
    typeof needle === "string" ? t.includes(needle) : needle.test(t),
  );
const anyTableBodyHas = (predicate: (row: unknown[]) => boolean) =>
  captured.autoTables.some((t) => (t.body ?? []).some(predicate));

const baseExpense = {
  id: "abcdef1234567890",
  supplier_code: "F001",
  supplier_name: "Fornecedor Teste LTDA",
  total_amount: 1234.5,
  currency: "BRL",
  cost_center: "CC-100",
  project: "PRJ-42",
  remarks: "Compra recorrente do mês.",
  status: "approved",
  requester_name: "Ana Solicitante",
  requester_email: "ana@example.com",
  current_approver: "Bruno Aprovador",
  sap_doc_entry: 555,
  sap_doc_num: 999,
  sap_integration_error: null as string | null,
  sap_purchase_order_status: "created",
  sap_attachment_status: "sent",
  sap_integration_last_attempt_at: "2026-01-15T10:00:00-03:00",
  origin: "manual",
  created_by_email: "ana@example.com",
  company_db: "SBO_ANA",
  doc_date: "2026-01-10T12:00:00-03:00",
  due_date: "2026-02-10T12:00:00-03:00",
  created_at: "2026-01-10T09:00:00-03:00",
  updated_at: "2026-01-15T11:00:00-03:00",
  items: [
    { item_code: "IT01", description: "Serviço de consultoria", quantity: 2, unit_price: 500, line_total: 1000, cost_center: "CC-100", project: "PRJ-42" },
    { item_code: "IT02", description: "Taxa de emissão", quantity: 1, unit_price: 234.5, line_total: 234.5 },
  ],
  attachments: [
    { file_name: "nota.pdf", file_size: 12345, mime_type: "application/pdf" },
  ],
};

beforeEach(() => {
  resetCaptured();
  mockLogRows.length = 0;
});

// ---------------------------------------------------------------------------
// DESPESA (compra)
// ---------------------------------------------------------------------------
describe("exportExpenseDetailPdf — despesa (compra)", () => {
  it("emite título, cabeçalho, datas formatadas e tabela de itens em BRL", async () => {
    mockLogRows.push({
      decision: "approved",
      approver_name: "Bruno Aprovador",
      approver_email: "bruno@example.com",
      level_order: 1,
      remarks: "Ok",
      decided_at: "2026-01-14T14:00:00-03:00",
    });

    await exportExpenseDetailPdf(baseExpense, { statusLabel: "Aprovada", mode: "purchase" });

    // Título e subtítulo
    expect(hasText(/^Despesa — Fornecedor Teste LTDA$/)).toBe(true);
    expect(hasText("#abcdef12")).toBe(true); // id truncado
    expect(hasText(/ERP 999/)).toBe(true);

    // Rótulos de cabeçalho — compras usa "Fornecedor"
    expect(hasText("Fornecedor")).toBe(true);
    expect(hasText("Fornecedor Teste LTDA (F001)")).toBe(true);
    expect(hasText("Solicitante")).toBe(true);
    expect(hasText("Ana Solicitante <ana@example.com>")).toBe(true);
    expect(hasText("Aprovada")).toBe(true); // status badge

    // Datas formatadas em pt-BR
    expect(hasText("10/01/2026")).toBe(true); // doc_date
    expect(hasText("10/02/2026")).toBe(true); // due_date

    // Headline com valor total formatado
    expect(hasText(/R\$\s?1\.234,50/)).toBe(true);

    // Observações renderizadas
    expect(hasText("Compra recorrente do mês.")).toBe(true);

    // Tabela de itens contém descrições e totais formatados
    const itemsTable = captured.autoTables.find((t) =>
      (t.head?.[0] as string[] | undefined)?.[0] === "Cód.",
    );
    expect(itemsTable).toBeTruthy();
    expect(itemsTable!.body).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(["IT01", "Serviço de consultoria"]),
        expect.arrayContaining(["IT02", "Taxa de emissão"]),
      ]),
    );
    // Formato de moeda propagado para linhas
    expect(anyTableBodyHas((row) => row.some((c) => /R\$\s?1\.000,00/.test(String(c))))).toBe(true);

    // Histórico usa o rótulo mapeado ("Aprovado") + nome do responsável
    const historyTable = captured.autoTables.find((t) =>
      (t.head?.[0] as string[] | undefined)?.some((h) => h === "Evento"),
    );
    expect(historyTable).toBeTruthy();
    expect(historyTable!.body?.[0]).toEqual(
      expect.arrayContaining(["Aprovado", "Bruno Aprovador"]),
    );

    // Salvou um PDF cujo nome referencia despesa + fornecedor + id curto
    expect(captured.savedFiles).toHaveLength(1);
    expect(captured.savedFiles[0]).toMatch(/^Despesa_Fornecedor_Teste_LTDA_abcdef12_\d+\.pdf$/);
  });

  it("oculta a seção de integração ERP quando não há dados de SAP", async () => {
    const clean = {
      ...baseExpense,
      sap_doc_entry: undefined,
      sap_doc_num: undefined,
      sap_integration_error: null,
    };
    await exportExpenseDetailPdf(clean, { statusLabel: "Pendente", mode: "purchase" });
    // O título da seção só aparece quando ao menos um campo de ERP existe.
    expect(hasText("INTEGRAÇÃO ERP")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PEDIDO DE VENDA
// ---------------------------------------------------------------------------
describe("exportExpenseDetailPdf — pedido de venda", () => {
  it("usa rótulos de venda (Cliente / Pedido de Venda) e mantém itens", async () => {
    const sale = {
      ...baseExpense,
      supplier_code: "C001",
      supplier_name: "Cliente Alpha S/A",
      currency: "USD",
      total_amount: 500,
      items: [
        { item_code: "SKU-A", description: "Licença anual", quantity: 1, unit_price: 500, line_total: 500 },
      ],
    };

    await exportExpenseDetailPdf(sale, { statusLabel: "Enviada", mode: "sales" });

    // Título com "Pedido de Venda"
    expect(hasText(/^Pedido de Venda — Cliente Alpha S\/A$/)).toBe(true);

    // Rótulo "Cliente" no lugar de "Fornecedor"
    expect(hasText("Cliente")).toBe(true);
    expect(hasText("Cliente Alpha S/A (C001)")).toBe(true);
    // Nenhum rótulo "Fornecedor" nos campos (só ocorre em compras)
    const fornecedorAppearances = captured.textCalls.filter((t) => t === "Fornecedor");
    expect(fornecedorAppearances).toHaveLength(0);

    // Headline em USD (símbolo pode variar; o importante é "500,00")
    expect(hasText(/500,00/)).toBe(true);

    // Itens presentes na tabela
    const itemsTable = captured.autoTables.find((t) =>
      (t.head?.[0] as string[] | undefined)?.[0] === "Cód.",
    );
    expect(itemsTable?.body?.[0]).toEqual(
      expect.arrayContaining(["SKU-A", "Licença anual"]),
    );

    // Arquivo salvo com prefixo "Pedido_de_Venda"
    expect(captured.savedFiles[0]).toMatch(/^Pedido_de_Venda_Cliente_Alpha_S_A_/);
  });
});

// ---------------------------------------------------------------------------
// APROVAÇÃO (listagem)
// ---------------------------------------------------------------------------
describe("exportListReportPdf — aprovações", () => {
  it("renderiza colunas + linhas na tabela e salva o arquivo com o título", async () => {
    interface ApprovalRow {
      id: string;
      supplier: string;
      total: number;
      requester: string;
      decidedAt: string;
    }
    const rows: ApprovalRow[] = [
      { id: "abc12345", supplier: "Fornecedor X", total: 100, requester: "Ana", decidedAt: "2026-02-01T10:00:00-03:00" },
      { id: "def67890", supplier: "Fornecedor Y", total: 250.75, requester: "Bruno", decidedAt: "2026-02-02T11:30:00-03:00" },
    ];

    await exportListReportPdf<ApprovalRow>({
      title: "Aprovações",
      subtitle: "Pendentes de decisão",
      columns: [
        { header: "ID", cell: (r) => r.id },
        { header: "Fornecedor", cell: (r) => r.supplier },
        { header: "Total", cell: (r) => `R$ ${r.total.toFixed(2)}`, align: "right" },
        { header: "Solicitante", cell: (r) => r.requester },
        { header: "Decidido em", cell: (r) => new Date(r.decidedAt).toLocaleDateString("pt-BR") },
      ],
      rows,
      meta: [{ label: "Total", value: `${rows.length} pedido(s)` }],
      fileName: "aprovacoes",
    });

    // Título e subtítulo desenhados
    expect(hasText("Aprovações")).toBe(true);
    expect(hasText("Pendentes de decisão")).toBe(true);

    // A única tabela deve conter head correto e as duas linhas
    const listTable = captured.autoTables[0];
    expect(listTable).toBeTruthy();
    expect(listTable.head).toEqual([
      ["ID", "Fornecedor", "Total", "Solicitante", "Decidido em"],
    ]);
    expect(listTable.body).toEqual([
      ["abc12345", "Fornecedor X", "R$ 100.00", "Ana", "01/02/2026"],
      ["def67890", "Fornecedor Y", "R$ 250.75", "Bruno", "02/02/2026"],
    ]);

    // Arquivo salvo com o fileName informado
    expect(captured.savedFiles).toHaveLength(1);
    expect(captured.savedFiles[0]).toMatch(/^aprovacoes_\d+\.pdf$/);
  });

  it("substitui o subtítulo padrão pela contagem quando não é informado", async () => {
    await exportListReportPdf({
      title: "Vazio",
      columns: [{ header: "X", cell: () => "-" }],
      rows: [],
    });
    // subtitle default = "0 registro(s)"
    expect(hasText("0 registro(s)")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
describe("exportListReportCsv — aprovações/compras/vendas", () => {
  interface Row { supplier: string; total: number; note?: string }
  const rows: Row[] = [
    { supplier: "Fornecedor A", total: 100 },
    // valores com separador (;), quebra de linha e aspas — devem ser escapados
    { supplier: 'Nome; com "aspas"', total: 250.5, note: "linha1\nlinha2" },
  ];
  const columns = [
    { header: "Fornecedor", cell: (r: Row) => r.supplier },
    { header: "Total", cell: (r: Row) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(r.total) },
    { header: "Obs", cell: (r: Row) => r.note || "—" },
  ];

  // Captura a string bruta passada ao construtor do Blob (jsdom não implementa
  // Blob.text() nem Response(blob).text() de forma confiável).
  const csvStrings: string[] = [];
  const downloads: string[] = [];
  let originalCreateURL: typeof URL.createObjectURL;
  let originalClick: typeof HTMLAnchorElement.prototype.click;
  let originalBlob: typeof Blob;

  beforeEach(() => {
    csvStrings.length = 0;
    downloads.length = 0;
    originalCreateURL = URL.createObjectURL;
    originalClick = HTMLAnchorElement.prototype.click;
    originalBlob = globalThis.Blob;
    // Blob mock: guarda o conteúdo e continua "válido" para o restante do fluxo.
    class RecordingBlob {
      constructor(parts: BlobPart[]) {
        csvStrings.push(parts.map((p) => (typeof p === "string" ? p : "")).join(""));
      }
    }
    // @ts-expect-error — mock parcial suficiente para o exercício.
    globalThis.Blob = RecordingBlob;
    URL.createObjectURL = (() => "blob:mock") as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
    HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateURL;
    HTMLAnchorElement.prototype.click = originalClick;
    globalThis.Blob = originalBlob;
  });

  it("gera CSV com BOM, header, linhas e metadados; escapa aspas/;/newline", async () => {
    exportListReportCsv<Row>({
      title: "Aprovações",
      subtitle: "Pendentes",
      meta: [
        { label: "Empresa", value: "ANA GAMING" },
        { label: "Filtro", value: "status = pending" },
      ],
      columns,
      rows,
      fileName: "aprovacoes",
    });

    expect(csvStrings).toHaveLength(1);
    const csv = csvStrings[0];

    // BOM UTF-8
    expect(csv.charCodeAt(0)).toBe(0xFEFF);

    // Metadados
    expect(csv).toContain("# Aprovações");
    expect(csv).toContain("# Pendentes");
    expect(csv).toContain("# Empresa: ANA GAMING");
    expect(csv).toContain("# Filtro: status = pending");

    // Header e primeira linha
    expect(csv).toContain("Fornecedor;Total;Obs");
    expect(csv).toMatch(/Fornecedor A;.*100,00.*;—/);

    // Escape: aspas duplicadas + campo com `;`
    expect(csv).toContain('"Nome; com ""aspas"""');
    // Escape de quebra de linha (campo entre aspas)
    expect(csv).toContain('"linha1\nlinha2"');

    // Arquivo com nome + .csv
    expect(downloads).toHaveLength(1);
    expect(downloads[0]).toMatch(/^aprovacoes_\d+\.csv$/);
  });

  it("só exporta as linhas passadas (respeita filtros aplicados)", async () => {
    const filteredRows: Row[] = [rows[0]];
    exportListReportCsv<Row>({ title: "Compras", columns, rows: filteredRows });
    const csv = csvStrings[csvStrings.length - 1];
    expect(csv).not.toContain("Nome; com");
    expect(csv).toContain("Fornecedor A");
  });
});
