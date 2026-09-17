// Builder do documento de CONTAS A PAGAR do Omie gerado pelo módulo de
// Compras do ERP Flow. Empresas que rodam sobre o Omie não usam Pedido de
// Compra: cada despesa aprovada vira um título em contas a pagar.
// Referência: https://developer.omie.com.br/service-list/#/Servicos/Financas/ContaPagar

export interface OmieApExpense {
  id: string;
  supplier_code?: string | null;
  supplier_name?: string | null;
  cost_center?: string | null;
  due_date?: string | null;
  doc_date?: string | null;
  remarks?: string | null;
  total_amount?: number | null;
  omie_ap_data?: OmieApData | null;
}

export interface OmieApItem {
  description?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  line_total?: number | null;
  cost_center?: string | null;
}

export interface OmieApTaxes {
  pis?: number | null;
  cofins?: number | null;
  csll?: number | null;
  ir?: number | null;
  iss?: number | null;
  inss?: number | null;
  retain_pis?: boolean;
  retain_cofins?: boolean;
  retain_csll?: boolean;
  retain_ir?: boolean;
  retain_iss?: boolean;
  retain_inss?: boolean;
}

export interface OmieApData {
  /** Conta corrente (id_conta_corrente) do Omie. */
  current_account_code?: string | number | null;
  /** Categoria financeira; quando ausente usa o centro de custo/categoria da despesa. */
  category_code?: string | null;
  /** Número da nota fiscal / documento. */
  invoice_number?: string | null;
  /** Chave de acesso da NF-e (44 dígitos). */
  nfe_key?: string | null;
  /** Tipo de documento Omie (ex.: NF, BOL, OUT). */
  document_type?: string | null;
  /** Código de barras do boleto. */
  barcode?: string | null;
  /** Previsão de pagamento (YYYY-MM-DD); default = vencimento. */
  payment_forecast_date?: string | null;
  taxes?: OmieApTaxes | null;
}

export interface OmieApPayload {
  codigo_lancamento_integracao: string;
  codigo_cliente_fornecedor: number;
  data_vencimento: string;
  data_previsao: string;
  data_emissao: string;
  data_registro: string;
  valor_documento: number;
  codigo_categoria: string;
  id_conta_corrente: number;
  numero_documento: string;
  numero_documento_fiscal?: string;
  numero_parcela: string;
  observacao: string;
  chave_nfe?: string;
  codigo_barras?: string;
  tipo_documento?: string;
  valor_pis?: number;
  retem_pis?: "S" | "N";
  valor_cofins?: number;
  retem_cofins?: "S" | "N";
  valor_csll?: number;
  retem_csll?: "S" | "N";
  valor_ir?: number;
  retem_ir?: "S" | "N";
  valor_iss?: number;
  retem_iss?: "S" | "N";
  valor_inss?: number;
  retem_inss?: "S" | "N";
}

function toOmieDate(value: unknown, label: string, fallback?: string): string {
  const raw = String(value ?? "").trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;
  if (fallback) return fallback;
  throw new Error(`${label} inválida para a Conta a Pagar do Omie.`);
}

function todayBr(): string {
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000); // horário de Brasília
  return toOmieDate(now.toISOString().slice(0, 10), "Data de registro");
}

function omieSupplierId(value: unknown): number {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d+)$/);
  if (!match) throw new Error(`Fornecedor: código Omie inválido (${raw || "não informado"}).`);
  return Number(match[1]);
}

function money(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function taxPair(
  payload: OmieApPayload,
  valueKey: keyof OmieApPayload,
  flagKey: keyof OmieApPayload,
  amount: unknown,
  retain: boolean | undefined,
) {
  const value = money(amount);
  if (value <= 0) return;
  (payload[valueKey] as unknown as number) = value;
  (payload[flagKey] as unknown as "S" | "N") = retain === false ? "N" : "S";
}

export function buildOmieAccountsPayablePayload(
  expense: OmieApExpense,
  items: OmieApItem[],
): OmieApPayload {
  const ap = expense.omie_ap_data || {};
  const supplierId = omieSupplierId(expense.supplier_code);

  const category = String(ap.category_code || expense.cost_center || items[0]?.cost_center || "").trim();
  if (!category) throw new Error("Categoria Omie é obrigatória para criar a Conta a Pagar.");

  const currentAccount = Number(String(ap.current_account_code ?? "").trim());
  if (!Number.isFinite(currentAccount) || currentAccount <= 0) {
    throw new Error("Conta corrente do Omie é obrigatória para criar a Conta a Pagar.");
  }

  const itemsTotal = (items || []).reduce(
    (sum, item) => sum + money(item.line_total ?? (Number(item.quantity) || 0) * (Number(item.unit_price) || 0)),
    0,
  );
  const amount = money(expense.total_amount) > 0 ? money(expense.total_amount) : money(itemsTotal);
  if (amount <= 0) throw new Error("Valor da Conta a Pagar deve ser maior que zero.");

  const dueDate = toOmieDate(expense.due_date, "Data de vencimento");
  const issueDate = toOmieDate(expense.doc_date, "Data de emissão", dueDate);
  const forecast = toOmieDate(ap.payment_forecast_date, "Previsão de pagamento", dueDate);

  const descriptions = (items || [])
    .map((item) => String(item.description || "").trim())
    .filter(Boolean)
    .join(" | ");
  const observation = [String(expense.remarks || "").trim(), descriptions]
    .filter(Boolean)
    .join(" - ")
    .slice(0, 490) || "Conta a pagar gerada pelo ERP Flow";

  const invoiceNumber = String(ap.invoice_number || "").trim();
  const nfeKey = String(ap.nfe_key || "").replace(/\D/g, "");
  const barcode = String(ap.barcode || "").replace(/\D/g, "");

  const payload: OmieApPayload = {
    codigo_lancamento_integracao: `ERPFLOW-${String(expense.id || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 20)}`,
    codigo_cliente_fornecedor: supplierId,
    data_vencimento: dueDate,
    data_previsao: forecast,
    data_emissao: issueDate,
    data_registro: todayBr(),
    valor_documento: amount,
    codigo_categoria: category,
    id_conta_corrente: currentAccount,
    numero_documento: (invoiceNumber || String(expense.id || "").slice(0, 8)).slice(0, 20),
    numero_parcela: "001/001",
    observacao: observation,
  };

  if (invoiceNumber) payload.numero_documento_fiscal = invoiceNumber.slice(0, 20);
  if (nfeKey.length === 44) payload.chave_nfe = nfeKey;
  if (barcode.length >= 44) payload.codigo_barras = barcode.slice(0, 48);
  const documentType = String(ap.document_type || "").trim().toUpperCase();
  if (documentType) payload.tipo_documento = documentType.slice(0, 10);

  const taxes = ap.taxes || {};
  taxPair(payload, "valor_pis", "retem_pis", taxes.pis, taxes.retain_pis);
  taxPair(payload, "valor_cofins", "retem_cofins", taxes.cofins, taxes.retain_cofins);
  taxPair(payload, "valor_csll", "retem_csll", taxes.csll, taxes.retain_csll);
  taxPair(payload, "valor_ir", "retem_ir", taxes.ir, taxes.retain_ir);
  taxPair(payload, "valor_iss", "retem_iss", taxes.iss, taxes.retain_iss);
  taxPair(payload, "valor_inss", "retem_inss", taxes.inss, taxes.retain_inss);

  return payload;
}
