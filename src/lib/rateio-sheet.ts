// Leitura de planilhas/textos de rateio anexados ao pedido de compra.
// O usuário anexa um arquivo com uma linha por centro de custo (e opcionalmente
// item, projeto/marca, quantidade e descrição) e essas linhas viram as linhas
// do pedido. Nada é enviado ao servidor: o parsing acontece no navegador.

export interface RateioRow {
  item_code: string;
  description: string;
  quantity: number;
  unit_price: number;
  cost_center: string;
  project: string;
}

export interface RateioParseResult {
  rows: RateioRow[];
  total: number;
  /** Colunas reconhecidas no cabeçalho (para exibir ao usuário). */
  columns: string[];
}

const SHEET_EXT = ["xlsx", "xls", "xlsm", "ods"];
const TEXT_EXT = ["csv", "txt", "tsv"];

function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

/** Arquivos que podem conter uma referência de rateio (planilha ou texto). */
export function isRateioCandidate(file: File): boolean {
  const e = ext(file.name);
  return SHEET_EXT.includes(e) || TEXT_EXT.includes(e);
}

const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

type Field = "item_code" | "description" | "quantity" | "unit_price" | "cost_center" | "project";

function matchField(header: string): Field | null {
  const h = norm(header);
  if (!h) return null;
  if (/(centro de custo|centro custo|^cc$|costing ?code|centro)/.test(h)) return "cost_center";
  if (/(projeto|marca|brand|project)/.test(h)) return "project";
  if (/(quantidade|^qtd|^qtde|^qty|quant)/.test(h)) return "quantity";
  if (/(preco|valor|unitario|total|amount|price)/.test(h)) return "unit_price";
  if (/(descricao|description|historico|observacao)/.test(h)) return "description";
  if (/item|codigo|cod |^cod$|sku|material/.test(h)) return "item_code";
  return null;
}

function parseNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  let s = String(value ?? "").trim();
  if (!s) return 0;
  s = s.replace(/[R$\s\u00a0]/gi, "");
  if (s.includes(",") && s.includes(".")) {
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function splitDelimited(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const sample = lines.slice(0, 5).join("\n");
  const counts: Array<[string, number]> = [
    ["\t", (sample.match(/\t/g) || []).length],
    [";", (sample.match(/;/g) || []).length],
    [",", (sample.match(/,/g) || []).length],
    ["|", (sample.match(/\|/g) || []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  const delim = counts[0][1] > 0 ? counts[0][0] : /\s{2,}/;
  return lines.map((line) =>
    (typeof delim === "string" ? line.split(delim) : line.split(delim)).map((c) =>
      c.trim().replace(/^"(.*)"$/, "$1").trim(),
    ),
  );
}

function fromMatrix(matrix: unknown[][]): RateioParseResult | null {
  // Procura a linha de cabeçalho nas 10 primeiras linhas.
  for (let h = 0; h < Math.min(matrix.length, 10); h++) {
    const header = (matrix[h] || []).map((c) => String(c ?? ""));
    const map = new Map<Field, number>();
    header.forEach((cell, idx) => {
      const f = matchField(cell);
      if (f && !map.has(f)) map.set(f, idx);
    });
    // Exige pelo menos centro de custo + valor: é o mínimo de um rateio.
    if (!map.has("cost_center") || !map.has("unit_price")) continue;

    const rows: RateioRow[] = [];
    for (let r = h + 1; r < matrix.length; r++) {
      const line = matrix[r] || [];
      const cell = (f: Field) => (map.has(f) ? line[map.get(f)!] : undefined);
      const cost_center = String(cell("cost_center") ?? "").trim();
      const unit_price = parseNumber(cell("unit_price"));
      if (!cost_center && unit_price === 0) continue;
      if (!cost_center) continue;
      const quantity = map.has("quantity") ? parseNumber(cell("quantity")) || 1 : 1;
      rows.push({
        item_code: String(cell("item_code") ?? "").trim(),
        description: String(cell("description") ?? "").trim(),
        quantity,
        unit_price,
        cost_center,
        project: String(cell("project") ?? "").trim(),
      });
    }
    if (rows.length === 0) continue;
    return {
      rows,
      total: rows.reduce((s, r) => s + r.quantity * r.unit_price, 0),
      columns: Array.from(map.keys()).map((f) => header[map.get(f)!]).filter(Boolean),
    };
  }
  return null;
}

/**
 * Tenta interpretar o arquivo como referência de rateio.
 * Retorna null quando o arquivo não tem a estrutura esperada.
 */
export async function parseRateioFile(file: File): Promise<RateioParseResult | null> {
  try {
    const e = ext(file.name);
    if (TEXT_EXT.includes(e)) {
      const text = await file.text();
      return fromMatrix(splitDelimited(text));
    }
    if (!SHEET_EXT.includes(e)) return null;
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    for (const name of wb.SheetNames) {
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
        header: 1,
        blankrows: false,
        defval: "",
      });
      const parsed = fromMatrix(matrix as unknown[][]);
      if (parsed) return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
