/**
 * Monta a coleção DocumentLines completa para um PATCH no SAP B1.
 *
 * O PATCH com `B1S-ReplaceCollectionsOnPatch: true` substitui a coleção
 * inteira: tudo que não for enviado é recriado com o padrão do cadastro do
 * item — e é aí que o Service Layer recalcula o preço pela lista de preços e
 * grava 0 (pedido "sem valor" no SAP). Para evitar isso, lemos a linha atual
 * no SAP e reenviamos todos os campos editáveis dela (inclusive os campos
 * personalizados U_*), aplicando por cima os valores aprovados no ERP Flow.
 */

/** Campos de linha que o Service Layer aceita gravar (os demais são calculados). */
const EDITABLE_LINE_FIELDS = [
  "LineNum",
  "ItemCode",
  "ItemDescription",
  "Quantity",
  "UnitPrice",
  "Price",
  "Currency",
  "Rate",
  "DiscountPercent",
  "LineType",
  "WarehouseCode",
  "CostingCode",
  "CostingCode2",
  "CostingCode3",
  "CostingCode4",
  "CostingCode5",
  "ProjectCode",
  "AccountCode",
  "TaxCode",
  "VatGroup",
  "TaxLiable",
  "Usage",
  "FreeText",
  "MeasureUnit",
  "UoMEntry",
  "UoMCode",
  "UnitsOfMeasurment",
  "ShipDate",
  "RequiredDate",
  "SupplierCatNum",
  "TransactionType",
  "CFOPCode",
  "CSTCode",
] as const;

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/** Copia os campos editáveis (e os personalizados U_*) de uma linha lida do SAP. */
export function pickEditableLineFields(line: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of EDITABLE_LINE_FIELDS) {
    const value = line[field];
    if (!isEmpty(value)) out[field] = value;
  }
  for (const key of Object.keys(line)) {
    if (key.startsWith("U_") && !isEmpty(line[key])) out[key] = line[key];
  }
  return out;
}

export async function readSapDocumentLines(
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
    throw new Error(`Falha ao ler as linhas do documento no ERP [${res.status}]: ${msg}`);
  }
  return Array.isArray((body as any)?.DocumentLines) ? (body as any).DocumentLines : [];
}

/**
 * Combina as linhas atuais do SAP com as linhas desejadas (ERP Flow).
 * A correspondência é posicional: linha 1 do Flow ↔ linha 1 do SAP.
 * Linhas novas (além das existentes no SAP) vão como estão.
 */
export function mergeSapDocumentLines(
  currentLines: Record<string, unknown>[],
  desiredLines: Record<string, unknown>[],
): Record<string, unknown>[] {
  return desiredLines.map((desired, index) => {
    const current = currentLines[index];
    const base = current ? pickEditableLineFields(current) : {};
    const merged: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(desired)) {
      if (value !== undefined) merged[key] = value;
    }
    merged.LineNum = index;
    // Preço aprovado sempre nos dois campos — o SAP lê ora um, ora outro.
    const price = Number(desired.UnitPrice ?? desired.Price ?? merged.UnitPrice ?? merged.Price);
    if (Number.isFinite(price) && price > 0) {
      merged.UnitPrice = price;
      merged.Price = price;
    }
    // Item trocado: descrição/unidade do item antigo não devem ser herdadas.
    if (current && String(current.ItemCode ?? "") !== String(merged.ItemCode ?? "")) {
      if (desired.ItemDescription === undefined) delete merged.ItemDescription;
      if (desired.MeasureUnit === undefined) delete merged.MeasureUnit;
      if (desired.UoMEntry === undefined) delete merged.UoMEntry;
      if (desired.UoMCode === undefined) delete merged.UoMCode;
    }
    return merged;
  });
}

/** Lê as linhas atuais no SAP e devolve a coleção completa já mesclada. */
export async function buildFullPatchLines(
  baseUrl: string,
  cookies: string,
  endpoint: string,
  docEntry: number,
  desiredLines: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  let current: Record<string, unknown>[] = [];
  try {
    current = await readSapDocumentLines(baseUrl, cookies, endpoint, docEntry);
  } catch {
    current = [];
  }
  return mergeSapDocumentLines(current, desiredLines);
}
