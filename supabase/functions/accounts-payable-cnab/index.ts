import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders as baseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireAdminOrSapModule, authErrorResponse, parseSapHeaders } from "../_shared/auth.ts";
import { buildSapBaseUrl, loadSapCreds, sapSessionLogin, sapLogoutSession } from "../_shared/sap-cache.ts";
import {
  generateSicoobCnab240,
  parseSicoobReturn,
  type SicoobBankAccount,
  type SicoobPaymentTitle,
  type SicoobReturnTitle,
} from "../_shared/sicoob-cnab240.ts";

const corsHeaders = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-company-db, x-sap-session, x-sap-route, x-sap-user, x-sap-auth-token, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type AdminClient = ReturnType<typeof createClient>;

interface SapInvoice {
  DocEntry: number;
  DocNum: number;
  CardCode: string;
  CardName: string;
  FederalTaxID?: string;
  DocDate: string;
  DocDueDate: string;
  TaxDate?: string;
  DocTotal: number;
  PaidToDate: number;
  DocCurrency: string;
  DocumentStatus: string;
  Cancelled: string;
  Comments?: string;
  BPL_IDAssignedToInvoice?: number;
  DocumentInstallments?: Array<Record<string, unknown>>;
  DocumentLines?: Array<Record<string, unknown>>;
}

type PaymentMethod = "boleto" | "pix" | "ted" | "unknown";
type SupplierPaymentMethod = "pix" | "ted";

interface PaymentProfile {
  payment_method: PaymentMethod;
  payment_method_label: string;
  boleto_barcode: string | null;
  boleto_digitable_line: string | null;
  beneficiary_name: string | null;
  beneficiary_tax_id: string | null;
  bank_code: string | null;
  branch: string | null;
  branch_digit: string | null;
  account_number: string | null;
  account_digit: string | null;
  account_type: string | null;
  pix_key_type: string | null;
  pix_key: string | null;
  bank_account_summary: string | null;
  payment_data_source: string | null;
}

interface SupplierPaymentProfileRow {
  company_db: string;
  supplier_code: string;
  supplier_name: string | null;
  supplier_tax_id: string | null;
  payment_method: SupplierPaymentMethod;
  beneficiary_name: string;
  beneficiary_tax_id: string;
  bank_code: string | null;
  branch: string | null;
  branch_digit: string | null;
  account_number: string | null;
  account_digit: string | null;
  account_type: string | null;
  pix_key_type: string | null;
  pix_key: string | null;
  metadata?: Record<string, unknown> | null;
}

interface OpenTitle {
  key: string;
  sap_doc_entry: number;
  sap_doc_num: number;
  installment_id: number;
  supplier_code: string;
  supplier_name: string;
  supplier_tax_id: string | null;
  document_date: string;
  due_date: string;
  open_amount: number;
  currency: string;
  description: string;
  cost_centers: string[];
  projects: string[];
  payment_method: PaymentMethod;
  payment_method_label: string;
  boleto_barcode?: string | null;
  boleto_digitable_line?: string | null;
  beneficiary_name?: string | null;
  beneficiary_tax_id?: string | null;
  bank_code?: string | null;
  branch?: string | null;
  branch_digit?: string | null;
  account_number?: string | null;
  account_digit?: string | null;
  account_type?: string | null;
  pix_key_type?: string | null;
  pix_key?: string | null;
  bank_account_summary?: string | null;
  payment_data_source?: string | null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function message(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const parts = [record.message, record.details, record.hint, record.code]
      .map((part) => String(part ?? "").trim())
      .filter(Boolean);
    if (parts.length) return parts.join(" | ");
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function digits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function boletoBarcodeFrom(value: unknown): string {
  const clean = digits(value);
  if (clean.length === 44) return clean;
  if (clean.length === 47) {
    return `${clean.slice(0, 4)}${clean.slice(32, 33)}${clean.slice(33, 47)}${clean.slice(4, 9)}${clean.slice(10, 20)}${clean.slice(21, 31)}`;
  }
  if (clean.length === 48) {
    return `${clean.slice(0, 11)}${clean.slice(12, 23)}${clean.slice(24, 35)}${clean.slice(36, 47)}`;
  }
  return clean;
}

function day(value: unknown): string {
  return String(value ?? "").slice(0, 10);
}

function isoDayOffset(days: number): string {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function requestDate(value: unknown): string | null {
  const text = day(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function roundMoney(value: unknown): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizeCurrency(value: unknown): string {
  const text = String(value ?? "").trim().toUpperCase();
  if (!text || text === "R$" || text === "RS" || text === "REAL" || text === "REAIS") return "BRL";
  if (text === "BRL") return "BRL";
  return /^[A-Z]{3}$/.test(text) ? text : "BRL";
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))).sort();
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function collectionRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of ["value", "results"]) {
    const nested = value[key];
    if (Array.isArray(nested)) return nested.filter(isRecord);
  }
  for (const [key, nested] of Object.entries(value)) {
    if (key.includes("/") && Array.isArray(nested)) return nested.filter(isRecord);
  }
  return [];
}

function businessPartnerRow(value: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  if (firstText(value.CardCode, value.CardName)) return value;
  return collectionRows(value)[0] || value;
}

function isMissingColumn(error: unknown): boolean {
  return /column .* does not exist|schema cache|Could not find the .* column/i.test(message(error));
}

function paymentLabel(method: PaymentMethod): string {
  if (method === "boleto") return "Boleto";
  if (method === "pix") return "PIX";
  if (method === "ted") return "TED";
  return "Sem dados";
}

function normalizeSupplierPaymentMethod(value: unknown): SupplierPaymentMethod {
  const method = String(value || "").trim().toLowerCase();
  if (method === "pix") return "pix";
  if (method === "ted") return "ted";
  throw new Error("Forma de pagamento do fornecedor inválida.");
}

function normalizeRemittancePaymentMethod(value: unknown): PaymentMethod {
  const method = String(value || "").trim().toLowerCase();
  if (method === "boleto" || method === "pix" || method === "ted") return method;
  return "unknown";
}

function normalizeSapPaymentMethod(value: unknown): PaymentMethod | null {
  const method = String(value || "").trim().toLowerCase();
  if (!method) return null;
  if (method.includes("pix")) return "pix";
  if (method.includes("ted")) return "ted";
  if (method.includes("bol") || method.includes("boleto")) return "boleto";
  return null;
}

function inferPixKeyTypeFromKey(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const textLower = text.toLowerCase();
  const cleanDigits = digits(text);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) return "random";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(textLower)) return "email";
  if (cleanDigits.length === 14) return "cnpj";
  if (cleanDigits.length === 11) return "cpf";
  if (cleanDigits.length >= 10 && cleanDigits.length <= 13 && /^[+()\d\s-]+$/.test(text)) return "phone";
  return null;
}

function normalizePixKeyType(value: unknown, pixKey?: unknown): string | null {
  const inferred = inferPixKeyTypeFromKey(pixKey);
  if (inferred) return inferred;
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  if (text === "1" || text.includes("telefone") || text.includes("phone") || text.includes("celular")) return "phone";
  if (text === "2" || text.includes("email") || text.includes("mail")) return "email";
  if (text === "3" || text.includes("cnpj")) return "cnpj";
  if (text === "4" || text.includes("cpf")) return "cpf";
  if (text === "5" || text.includes("aleat") || text.includes("random") || text.includes("evp")) return "random";
  return text;
}

function normalizeAccountType(value: unknown): string | null {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  if (text === "2" || text.includes("poup") || text.includes("saving")) return "savings";
  if (text === "3" || text.includes("pagamento") || text.includes("payment")) return "payment";
  return "checking";
}

function isMissingSupplierProfileStorage(error: unknown): boolean {
  return /accounts_payable_supplier_payment_profiles|schema cache|does not exist|Could not find/i.test(message(error));
}

function collectPixKeys(row: Record<string, unknown> | null | undefined): string[] {
  const bp = businessPartnerRow(row);
  if (!bp) return [];
  const found: string[] = [];
  for (const [key, value] of Object.entries(bp)) {
    if (/pix/i.test(key) && !/(tipo|type)/i.test(key)) {
      const text = firstText(value);
      if (text) found.push(text);
    }
  }
  const accounts = collectionRows(bp.BPBankAccounts);
  for (const account of accounts) {
    for (const [key, value] of Object.entries(account)) {
      if (/pix/i.test(key) && !/(tipo|type)/i.test(key)) {
        const text = firstText(value);
        if (text) found.push(text);
      }
    }
  }
  return uniqueStrings(found);
}

function fiscalTaxIdFromBp(row: Record<string, unknown> | null | undefined, fallbackPixKey?: unknown): string | null {
  const bp = businessPartnerRow(row);
  const direct = digits(
    firstText(
      bp?.FederalTaxID,
      bp?.UnifiedFederalTaxID,
      bp?.VatRegistrationNumber,
      bp?.U_FGR_TAXID0,
      bp?.TaxId0,
      bp?.TaxId4,
    ),
  );
  if (direct.length === 11 || direct.length === 14) return direct;

  const fiscalRows = collectionRows(bp?.BPFiscalTaxIDCollection);
  for (const fiscalRow of fiscalRows) {
    for (const [key, value] of Object.entries(fiscalRow)) {
      if (!/^TaxId\d+$/i.test(key)) continue;
      const taxId = digits(value);
      if (taxId.length === 11 || taxId.length === 14) return taxId;
    }
  }

  const pixDigits = digits(fallbackPixKey);
  return pixDigits.length === 11 || pixDigits.length === 14 ? pixDigits : null;
}

function bankAccountSummary(row: Record<string, unknown> | null | undefined): string | null {
  const bp = businessPartnerRow(row);
  const accounts = collectionRows(bp?.BPBankAccounts);
  const defaultBank = firstText(bp?.DefaultBankCode, bp?.BankCode, bp?.BankCode2, bp?.HouseBank);
  const defaultBranch = firstText(bp?.DefaultBranch, bp?.Branch, bp?.BankBranch, bp?.HouseBankBranch);
  const defaultAccount = firstText(bp?.DefaultAccount, bp?.AccountNo, bp?.AccountNumber, bp?.HouseBankAccount);
  const account = accounts.find((item) => {
    const accountBank = firstText(item.BankCode, item.BankCode2, item.BankKey, item.BankName);
    const accountNumber = firstText(item.AccountNo, item.AccountNumber, item.Account, item.IBAN);
    if (defaultBank && accountBank && accountBank !== defaultBank) return false;
    if (defaultAccount && accountNumber && accountNumber !== defaultAccount) return false;
    return Boolean(defaultBank || defaultAccount);
  }) || accounts.find((item) => String(item.Default || item.IsDefault || "").toLowerCase() === "tyes") || accounts[0];
  const bank = firstText(account?.BankCode, account?.BankCode2, account?.BankKey, account?.BankName, defaultBank);
  const branch = firstText(account?.Branch, account?.BankBranch, account?.BranchCode, defaultBranch);
  const number = firstText(account?.AccountNo, account?.AccountNumber, account?.Account, account?.IBAN, defaultAccount);
  const digit = firstText(account?.ControlKey, account?.AccountCheckDigit, account?.AccountDigit, account?.CheckDigit);
  const accountText = number ? `${number}${digit ? `-${digit}` : ""}` : null;
  const parts = [bank ? `Banco ${bank}` : null, branch ? `Ag. ${branch}` : null, accountText ? `Conta ${accountText}` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

function supplierBankSummary(row: Partial<SupplierPaymentProfileRow> | null | undefined): string | null {
  if (!row) return null;
  const bank = firstText(row.bank_code);
  const branch = firstText(row.branch);
  const account = firstText(row.account_number);
  const accountDigit = firstText(row.account_digit);
  const accountText = account ? `${account}${accountDigit ? `-${accountDigit}` : ""}` : null;
  const parts = [bank ? `Banco ${bank}` : null, branch ? `Ag. ${branch}` : null, accountText ? `Conta ${accountText}` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

function paymentProfileFromStored(row: SupplierPaymentProfileRow | null): PaymentProfile | null {
  if (!row) return null;
  const base = {
    beneficiary_name: firstText(row.beneficiary_name, row.supplier_name),
    beneficiary_tax_id: digits(row.beneficiary_tax_id || row.supplier_tax_id) || null,
    bank_code: firstText(row.bank_code),
    branch: firstText(row.branch),
    branch_digit: firstText(row.branch_digit),
    account_number: firstText(row.account_number),
    account_digit: firstText(row.account_digit),
    account_type: firstText(row.account_type),
    pix_key_type: firstText(row.pix_key_type),
  };
  if (row.payment_method === "pix" && firstText(row.pix_key)) {
    return {
      payment_method: "pix",
      payment_method_label: paymentLabel("pix"),
      boleto_barcode: null,
      boleto_digitable_line: null,
      ...base,
      pix_key: firstText(row.pix_key),
      bank_account_summary: supplierBankSummary(row),
      payment_data_source: "Dados complementares do fornecedor",
    };
  }
  if (row.payment_method === "ted" && supplierBankSummary(row)) {
    return {
      payment_method: "ted",
      payment_method_label: paymentLabel("ted"),
      boleto_barcode: null,
      boleto_digitable_line: null,
      ...base,
      pix_key: null,
      bank_account_summary: supplierBankSummary(row),
      payment_data_source: "Dados complementares do fornecedor",
    };
  }
  return null;
}

function inferPaymentProfile(bp: Record<string, unknown> | null, hidden: Partial<PaymentProfile> | null, stored: SupplierPaymentProfileRow | null = null): PaymentProfile {
  const row = businessPartnerRow(bp);
  const bank = firstBankAccountDetails(row);
  const defaultBeneficiaryName = firstText(row?.CardName);
  const sapDefaultMethod = normalizeSapPaymentMethod(row?.PeymentMethodCode || row?.PaymentMethodCode || row?.DefaultPaymentMethod);
  const boletoBarcode = boletoBarcodeFrom(hidden?.boleto_barcode || hidden?.boleto_digitable_line);
  const pixKey = bank.pix_key || collectPixKeys(row)[0] || null;
  const defaultBeneficiaryTaxId = fiscalTaxIdFromBp(bp, pixKey);
  if (boletoBarcode.length === 44) {
    return {
      payment_method: "boleto",
      payment_method_label: paymentLabel("boleto"),
      boleto_barcode: boletoBarcode,
      boleto_digitable_line: hidden?.boleto_digitable_line || null,
      beneficiary_name: defaultBeneficiaryName,
      beneficiary_tax_id: defaultBeneficiaryTaxId,
      bank_code: bank.bank_code || null,
      branch: bank.branch || null,
      branch_digit: bank.branch_digit || null,
      account_number: bank.account_number || null,
      account_digit: bank.account_digit || null,
      account_type: bank.account_type || null,
      pix_key_type: null,
      pix_key: null,
      bank_account_summary: null,
      payment_data_source: "Boleto capturado no pedido",
    };
  }

  const storedProfile = paymentProfileFromStored(stored);
  if (storedProfile) return storedProfile;

  if (sapDefaultMethod === "pix" || pixKey) {
    return {
      payment_method: "pix",
      payment_method_label: paymentLabel("pix"),
      boleto_barcode: null,
      boleto_digitable_line: null,
      beneficiary_name: defaultBeneficiaryName,
      beneficiary_tax_id: defaultBeneficiaryTaxId,
      bank_code: bank.bank_code || null,
      branch: bank.branch || null,
      branch_digit: bank.branch_digit || null,
      account_number: bank.account_number || null,
      account_digit: bank.account_digit || null,
      account_type: bank.account_type || null,
      pix_key_type: bank.pix_key_type || normalizePixKeyType(row?.U_TipoChavePix, pixKey) || null,
      pix_key: pixKey,
      bank_account_summary: bankAccountSummary(row),
      payment_data_source: "Dados do fornecedor",
    };
  }

  const bankSummary = bankAccountSummary(row);
  if (bankSummary) {
    return {
      payment_method: "ted",
      payment_method_label: paymentLabel("ted"),
      boleto_barcode: null,
      boleto_digitable_line: null,
      beneficiary_name: defaultBeneficiaryName,
      beneficiary_tax_id: defaultBeneficiaryTaxId,
      bank_code: bank.bank_code || null,
      branch: bank.branch || null,
      branch_digit: bank.branch_digit || null,
      account_number: bank.account_number || null,
      account_digit: bank.account_digit || null,
      account_type: bank.account_type || null,
      pix_key_type: null,
      pix_key: null,
      bank_account_summary: bankSummary,
      payment_data_source: "Dados bancários do fornecedor",
    };
  }

  return {
    payment_method: "unknown",
    payment_method_label: paymentLabel("unknown"),
    boleto_barcode: null,
    boleto_digitable_line: null,
    beneficiary_name: defaultBeneficiaryName,
    beneficiary_tax_id: defaultBeneficiaryTaxId,
    bank_code: bank.bank_code || null,
    branch: bank.branch || null,
    branch_digit: bank.branch_digit || null,
    account_number: bank.account_number || null,
    account_digit: bank.account_digit || null,
    account_type: bank.account_type || null,
    pix_key_type: null,
    pix_key: null,
    bank_account_summary: null,
    payment_data_source: null,
  };
}

function invoiceOpenAmount(invoice: SapInvoice): number {
  return Math.max(0, roundMoney(Number(invoice.DocTotal) - Number(invoice.PaidToDate || 0)));
}

function installmentTitles(invoice: SapInvoice, paymentProfile?: PaymentProfile): OpenTitle[] {
  const costCenters = uniqueStrings(
    (invoice.DocumentLines || []).flatMap((line) => [line.CostingCode, line.CostingCode2, line.CostingCode3, line.CostingCode4, line.CostingCode5]),
  );
  const projects = uniqueStrings((invoice.DocumentLines || []).map((line) => line.ProjectCode || line.Project));
  const invoiceOpen = invoiceOpenAmount(invoice);
  const installments = Array.isArray(invoice.DocumentInstallments) ? invoice.DocumentInstallments : [];
  const openInstallments = installments.flatMap((installment, index) => {
    const total = Number(installment.Total ?? installment.TotalFC ?? installment.TotalSys ?? 0);
    const paid = Number(installment.PaidToDate ?? installment.PaidToDateFC ?? 0);
    const open = Math.max(0, roundMoney(total - paid));
    if (open <= 0.005) return [];
    const rawId = Number(installment.InstallmentId ?? installment.InstallmentNumber ?? index + 1);
    return [{ id: Number.isFinite(rawId) ? rawId : index + 1, due: day(installment.DueDate) || day(invoice.DocDueDate), open }];
  });
  const parts = openInstallments.length ? openInstallments : [{ id: 0, due: day(invoice.DocDueDate), open: invoiceOpen }];

  const profile = paymentProfile || inferPaymentProfile(null, null);
  return parts.filter((part) => part.open > 0.005).map((part) => ({
    key: `${invoice.DocEntry}:${part.id}`,
    sap_doc_entry: Number(invoice.DocEntry),
    sap_doc_num: Number(invoice.DocNum),
    installment_id: part.id,
    supplier_code: invoice.CardCode || "",
    supplier_name: invoice.CardName || invoice.CardCode || "Fornecedor",
    supplier_tax_id: digits(invoice.FederalTaxID) || null,
    document_date: day(invoice.DocDate),
    due_date: part.due,
    open_amount: Math.min(part.open, invoiceOpen || part.open),
    currency: normalizeCurrency(invoice.DocCurrency),
    description: String(invoice.Comments || "").slice(0, 200),
    cost_centers: costCenters,
    projects,
    payment_method: profile.payment_method,
    payment_method_label: profile.payment_method_label,
    boleto_barcode: profile.boleto_barcode,
    boleto_digitable_line: profile.boleto_digitable_line,
    beneficiary_name: profile.beneficiary_name,
    beneficiary_tax_id: profile.beneficiary_tax_id,
    bank_code: profile.bank_code,
    branch: profile.branch,
    branch_digit: profile.branch_digit,
    account_number: profile.account_number,
    account_digit: profile.account_digit,
    account_type: profile.account_type,
    pix_key_type: profile.pix_key_type,
    pix_key: profile.pix_key,
    bank_account_summary: profile.bank_account_summary,
    payment_data_source: profile.payment_data_source,
  }));
}

function sapCookie(session: { sessionId: string; routeId?: string }): string {
  return `B1SESSION=${session.sessionId}${session.routeId ? `; ROUTEID=${session.routeId}` : ""}`;
}

async function sapJson(baseUrl: string, cookie: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}/${path.replace(/^\/+/, "")}`, {
    ...init,
    headers: { Cookie: cookie, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!response.ok) {
    throw new Error(`SAP ${path.split("?")[0]} [${response.status}]: ${(await response.text().catch(() => "")).slice(0, 500)}`);
  }
  if (response.status === 204) return null;
  return await response.json();
}

function requestSapSession(req: Request, companyDb: string): { sessionId: string; routeId?: string } | null {
  const headers = parseSapHeaders(req);
  if (!headers || headers.companyDB !== companyDb) return null;
  return { sessionId: headers.sapSession, routeId: headers.routeId || "" };
}

async function loadSapServiceLayerUrl(admin: AdminClient, companyDb: string): Promise<string | null> {
  const { data: credential, error: credentialError } = await admin
    .from("system_credentials")
    .select("credential_value")
    .eq("system_name", "sap")
    .eq("company_db", companyDb)
    .eq("credential_key", "service_layer_url")
    .maybeSingle();
  if (credentialError) throw new Error(`URL SAP: ${message(credentialError)}`);

  const credentialUrl = String(credential?.credential_value || "").trim();
  if (credentialUrl) return buildSapBaseUrl(credentialUrl);

  const { data: company, error: companyError } = await admin
    .from("companies")
    .select("service_layer_url")
    .eq("company_db", companyDb)
    .maybeSingle();
  if (companyError) throw new Error(`Empresa SAP: ${message(companyError)}`);

  const companyUrl = String(company?.service_layer_url || "").trim();
  const fallbackUrl = String(Deno.env.get("SAP_DEFAULT_BASE_URL") || "").trim();
  const rawUrl = companyUrl || fallbackUrl;
  return rawUrl ? buildSapBaseUrl(rawUrl) : null;
}

async function withSap<T>(admin: AdminClient, companyDb: string, req: Request, fn: (baseUrl: string, cookie: string) => Promise<T>): Promise<T> {
  const creds = await loadSapCreds(admin as never, companyDb, { requireApiuser: true });
  if (creds) {
    const baseUrl = buildSapBaseUrl(creds.service_layer_url);
    const session = await sapSessionLogin(baseUrl, companyDb, creds.username, creds.password);
    try {
      return await fn(baseUrl, sapCookie(session));
    } finally {
      try { await sapLogoutSession(baseUrl, session); } catch { /* sessão expira naturalmente */ }
    }
  }

  const currentSession = requestSapSession(req, companyDb);
  if (currentSession) {
    const baseUrl = await loadSapServiceLayerUrl(admin, companyDb);
    if (!baseUrl) throw new Error(`URL do Service Layer não configurada para ${companyDb}.`);
    return await fn(baseUrl, sapCookie(currentSession));
  }

  throw new Error(`Credencial Apiuser do SAP não configurada para ${companyDb}. Entre na empresa SAP para usar sua sessão local ou configure o Apiuser.`);
}

const INVOICE_SELECT = [
  "DocEntry", "DocNum", "CardCode", "CardName", "FederalTaxID", "DocDate", "DocDueDate", "TaxDate",
  "DocTotal", "PaidToDate", "DocCurrency", "DocumentStatus", "Cancelled", "Comments",
  "BPL_IDAssignedToInvoice", "DocumentInstallments", "DocumentLines",
].join(",");

async function getInvoice(baseUrl: string, cookie: string, docEntry: number): Promise<SapInvoice> {
  return await sapJson(baseUrl, cookie, `PurchaseInvoices(${docEntry})?$select=${encodeURIComponent(INVOICE_SELECT)}`) as SapInvoice;
}

async function getBusinessPartner(baseUrl: string, cookie: string, cardCode: string): Promise<Record<string, unknown> | null> {
  const key = cardCode.replace(/'/g, "''");
  try {
    return await sapJson(baseUrl, cookie, `BusinessPartners('${key}')`) as Record<string, unknown>;
  } catch (error) {
    console.warn("[accounts-payable-cnab] business partner payment profile skipped", cardCode, message(error));
    return null;
  }
}

function firstBankAccountDetails(bp: Record<string, unknown> | null): Record<string, string> {
  const row = businessPartnerRow(bp);
  const accounts = collectionRows(row?.BPBankAccounts);
  const defaultBank = firstText(row?.DefaultBankCode, row?.BankCode, row?.BankCode2, row?.HouseBank);
  const defaultBranch = firstText(row?.DefaultBranch, row?.Branch, row?.BankBranch, row?.HouseBankBranch);
  const defaultAccount = firstText(row?.DefaultAccount, row?.AccountNo, row?.AccountNumber, row?.HouseBankAccount);
  const account = accounts.find((item) => {
    const accountBank = firstText(item.BankCode, item.BankCode2, item.BankKey, item.BankName);
    const accountBranch = firstText(item.Branch, item.BankBranch, item.BranchCode);
    const accountNumber = firstText(item.AccountNo, item.AccountNumber, item.Account, item.IBAN);
    if (defaultBank && accountBank && accountBank !== defaultBank) return false;
    if (defaultBranch && accountBranch && accountBranch !== defaultBranch) return false;
    if (defaultAccount && accountNumber && accountNumber !== defaultAccount) return false;
    return Boolean(defaultBank || defaultBranch || defaultAccount);
  }) || accounts.find((item) => String(item.Default || item.IsDefault || "").toLowerCase() === "tyes") || accounts[0] || {};
  const pixKey = firstText(account.U_ChavePix, account.PixKey, row?.U_ChavePix, row?.PixKey) || "";
  return {
    bank_code: firstText(account.BankCode, account.BankCode2, account.BankKey, defaultBank) || "",
    branch: firstText(account.Branch, account.BankBranch, account.BranchCode, defaultBranch) || "",
    branch_digit: firstText(account.AgencyControlKey, account.BranchDigit) || "",
    account_number: firstText(account.AccountNo, account.AccountNumber, account.Account, account.IBAN, defaultAccount) || "",
    account_digit: firstText(account.ControlKey, account.AccountCheckDigit, account.AccountDigit, account.CheckDigit) || "",
    account_type: normalizeAccountType(account.U_TipoConta || account.AccountType) || "",
    pix_key_type: normalizePixKeyType(account.U_TipoChavePix || row?.U_TipoChavePix, pixKey) || "",
    pix_key: pixKey,
  };
}

async function loadStoredSupplierPaymentProfile(
  admin: AdminClient,
  companyDb: string,
  supplierCode: string,
): Promise<SupplierPaymentProfileRow | null> {
  try {
    const { data, error } = await admin
      .from("accounts_payable_supplier_payment_profiles")
      .select("*")
      .eq("company_db", companyDb)
      .eq("supplier_code", supplierCode)
      .maybeSingle();
    if (error) {
      if (isMissingSupplierProfileStorage(error)) return null;
      throw error;
    }
    return data as SupplierPaymentProfileRow | null;
  } catch (error) {
    if (!isMissingSupplierProfileStorage(error)) console.warn("[accounts-payable-cnab] supplier payment profile skipped", message(error));
    return null;
  }
}

function supplierPaymentResponse(
  supplierCode: string,
  bp: Record<string, unknown> | null,
  stored: SupplierPaymentProfileRow | null,
) {
  const row = businessPartnerRow(bp);
  const bank = firstBankAccountDetails(row);
  const pixKeys = collectPixKeys(row);
  const pixKey = bank.pix_key || pixKeys[0] || "";
  const bpTaxId = fiscalTaxIdFromBp(row, pixKey) || "";
  const supplierTaxId = digits(stored?.supplier_tax_id) || bpTaxId;
  const beneficiaryTaxId = digits(stored?.beneficiary_tax_id) || supplierTaxId;
  const sapDefaultMethod = normalizeSapPaymentMethod(row?.PeymentMethodCode || row?.PaymentMethodCode || row?.DefaultPaymentMethod);
  return {
    supplier_code: supplierCode,
    supplier_name: stored?.supplier_name || firstText(row?.CardName) || "",
    supplier_tax_id: supplierTaxId,
    method: stored?.payment_method || sapDefaultMethod || (pixKeys[0] ? "pix" : bank.bank_code || bank.account_number ? "ted" : "ted"),
    beneficiary_name: stored?.beneficiary_name || firstText(row?.CardName) || "",
    beneficiary_tax_id: beneficiaryTaxId,
    bank_code: stored?.bank_code || bank.bank_code,
    branch: stored?.branch || bank.branch,
    branch_digit: stored?.branch_digit || bank.branch_digit,
    account_number: stored?.account_number || bank.account_number,
    account_digit: stored?.account_digit || bank.account_digit,
    account_type: stored?.account_type || bank.account_type,
    pix_key_type: stored?.pix_key_type || bank.pix_key_type || "",
    pix_key: stored?.pix_key || pixKey,
  };
}

async function auditSupplierPaymentProfile(
  admin: AdminClient,
  companyDb: string,
  supplierCode: string,
  actor: string,
  details: Record<string, unknown>,
) {
  const { error } = await admin.rpc("insert_audit_log", {
    p_action: "accounts_payable_supplier_payment_profile_updated",
    p_entity_type: "business_partner",
    p_entity_id: supplierCode,
    p_company_db: companyDb,
    p_actor_email: actor,
    p_details: details,
  });
  if (error) throw new Error(`Falha ao registrar auditoria: ${message(error)}`);
}

async function patchSapSupplierPayment(
  baseUrl: string,
  cookie: string,
  supplierCode: string,
  method: SupplierPaymentMethod,
  profile: Record<string, unknown>,
  bp: Record<string, unknown> | null,
): Promise<{ patched: boolean; fields: string[] }> {
  const payload: Record<string, unknown> = {};
  if (method === "ted") {
    const bankCode = digits(profile.bank_code);
    const branch = digits(profile.branch);
    const accountNumber = digits(profile.account_number);
    if (bankCode) payload.DefaultBankCode = bankCode;
    if (branch) payload.DefaultBranch = branch;
    if (accountNumber) payload.DefaultAccount = accountNumber;
    payload.PeymentMethodCode = "CPTED";
  } else {
    payload.PeymentMethodCode = "CPPIX";
    if (Object.prototype.hasOwnProperty.call(bp || {}, "U_ChavePix")) payload.U_ChavePix = firstText(profile.pix_key);
    if (Object.prototype.hasOwnProperty.call(bp || {}, "U_TipoChavePix")) payload.U_TipoChavePix = firstText(profile.pix_key_type);
  }

  const fields = Object.keys(payload);
  if (!fields.length) return { patched: false, fields: [] };
  const key = supplierCode.replace(/'/g, "''");
  await sapJson(baseUrl, cookie, `BusinessPartners('${key}')`, { method: "PATCH", body: JSON.stringify(payload) });
  return { patched: true, fields };
}

async function getSupplierPaymentProfile(admin: AdminClient, companyDb: string, body: Record<string, unknown>, req: Request) {
  const supplierCode = String(body.supplier_code || "").trim();
  if (!supplierCode) throw new Error("Fornecedor não informado.");
  return await withSap(admin, companyDb, req, async (baseUrl, cookie) => {
    const [bp, stored] = await Promise.all([
      getBusinessPartner(baseUrl, cookie, supplierCode),
      loadStoredSupplierPaymentProfile(admin, companyDb, supplierCode),
    ]);
    return { profile: supplierPaymentResponse(supplierCode, bp, stored) };
  });
}

async function saveSupplierPaymentProfile(admin: AdminClient, companyDb: string, body: Record<string, unknown>, actor: string, req: Request) {
  const supplierCode = String(body.supplier_code || "").trim();
  const rawProfile = (body.profile && typeof body.profile === "object" ? body.profile : body) as Record<string, unknown>;
  if (!supplierCode) throw new Error("Fornecedor não informado.");
  const method = normalizeSupplierPaymentMethod(rawProfile.method || rawProfile.payment_method);
  const beneficiaryName = firstText(rawProfile.beneficiary_name) || "";
  const beneficiaryTaxId = digits(rawProfile.beneficiary_tax_id);
  if (!beneficiaryName) throw new Error("Nome do favorecido é obrigatório.");
  if (!beneficiaryTaxId) throw new Error("CPF/CNPJ do favorecido é obrigatório.");

  const payload: Record<string, unknown> = {
    company_db: companyDb,
    supplier_code: supplierCode,
    supplier_name: firstText(rawProfile.supplier_name) || null,
    supplier_tax_id: digits(rawProfile.supplier_tax_id) || beneficiaryTaxId,
    payment_method: method,
    beneficiary_name: beneficiaryName,
    beneficiary_tax_id: beneficiaryTaxId,
    bank_code: null,
    branch: null,
    branch_digit: null,
    account_number: null,
    account_digit: null,
    account_type: null,
    pix_key_type: null,
    pix_key: null,
    updated_by: actor,
  };

  if (method === "ted") {
    const bankCode = digits(rawProfile.bank_code);
    const branch = digits(rawProfile.branch);
    const accountNumber = digits(rawProfile.account_number);
    if (!bankCode) throw new Error("Banco é obrigatório para TED.");
    if (!branch) throw new Error("Agência é obrigatória para TED.");
    if (!accountNumber) throw new Error("Conta é obrigatória para TED.");
    payload.bank_code = bankCode;
    payload.branch = branch;
    payload.branch_digit = firstText(rawProfile.branch_digit) || null;
    payload.account_number = accountNumber;
    payload.account_digit = digits(rawProfile.account_digit) || null;
    payload.account_type = firstText(rawProfile.account_type) || null;
  } else {
    const pixKeyType = firstText(rawProfile.pix_key_type);
    const pixKey = firstText(rawProfile.pix_key);
    if (!pixKeyType) throw new Error("Tipo da chave PIX é obrigatório.");
    if (!pixKey) throw new Error("Chave PIX é obrigatória.");
    payload.pix_key_type = pixKeyType;
    payload.pix_key = pixKey;
  }

  return await withSap(admin, companyDb, req, async (baseUrl, cookie) => {
    const bp = await getBusinessPartner(baseUrl, cookie, supplierCode);
    const bpRow = businessPartnerRow(bp);
    const oldStored = await loadStoredSupplierPaymentProfile(admin, companyDb, supplierCode);
    const oldProfile = supplierPaymentResponse(supplierCode, bpRow, oldStored);
    payload.supplier_name = payload.supplier_name || firstText(bpRow?.CardName) || null;
    payload.supplier_tax_id = payload.supplier_tax_id || fiscalTaxIdFromBp(bpRow, payload.pix_key) || null;

    let sapPatch: { patched: boolean; fields: string[] } = { patched: false, fields: [] };
    try {
      sapPatch = await patchSapSupplierPayment(baseUrl, cookie, supplierCode, method, payload, bpRow);
    } catch (error) {
      console.warn("[accounts-payable-cnab] supplier SAP payment patch failed", supplierCode, message(error));
    }

    const { data, error } = await admin
      .from("accounts_payable_supplier_payment_profiles")
      .upsert({ ...payload, created_by: actor }, { onConflict: "company_db,supplier_code" })
      .select("*")
      .single();
    if (error) throw new Error(`Falha ao salvar dados do fornecedor: ${message(error)}`);

    await auditSupplierPaymentProfile(admin, companyDb, supplierCode, actor, {
      previous: oldProfile,
      next: supplierPaymentResponse(supplierCode, bpRow, data as SupplierPaymentProfileRow),
      sap_patch: sapPatch,
      source: "accounts_payable_screen",
    });

    return { profile: supplierPaymentResponse(supplierCode, bpRow, data as SupplierPaymentProfileRow), sap_patch: sapPatch };
  });
}

async function loadExpensePaymentProfile(admin: AdminClient, companyDb: string, invoice: SapInvoice): Promise<Partial<PaymentProfile> | null> {
  try {
    const { data, error } = await admin
      .from("expenses")
      .select("payment_method,payment_boleto_barcode,payment_boleto_digitable_line,payment_metadata")
      .eq("company_db", companyDb)
      .or(`sap_doc_entry.eq.${Number(invoice.DocEntry)},sap_doc_num.eq.${Number(invoice.DocNum)}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      if (isMissingColumn(error)) return null;
      throw error;
    }
    const row = data as Record<string, unknown> | null;
    if (!row) return null;
    return {
      payment_method: String(row.payment_method || "") as PaymentMethod,
      boleto_barcode: firstText(row.payment_boleto_barcode) || null,
      boleto_digitable_line: firstText(row.payment_boleto_digitable_line) || null,
    };
  } catch (error) {
    if (!isMissingColumn(error)) console.warn("[accounts-payable-cnab] expense payment data skipped", message(error));
    return null;
  }
}

async function listOpenInvoices(
  admin: AdminClient,
  companyDb: string,
  baseUrl: string,
  cookie: string,
  filters: { dueFrom?: string | null; dueTo?: string | null } = {},
): Promise<OpenTitle[]> {
  const titles: OpenTitle[] = [];
  const bpCache = new Map<string, Record<string, unknown> | null>();
  const supplierProfileCache = new Map<string, SupplierPaymentProfileRow | null>();
  const dueFrom = requestDate(filters.dueFrom) || isoDayOffset(-10);
  const dueTo = requestDate(filters.dueTo) || isoDayOffset(0);
  const filter = [
    "DocumentStatus eq 'bost_Open'",
    "Cancelled eq 'tNO'",
    `DocDueDate ge '${dueFrom}'`,
    `DocDueDate le '${dueTo}'`,
  ].join(" and ");
  let next: string | null = `PurchaseInvoices?$select=${encodeURIComponent(INVOICE_SELECT)}&$filter=${encodeURIComponent(filter)}&$orderby=DocDueDate asc`;
  let pages = 0;
  while (next && pages < 50) {
    const response: Response = await fetch(next.startsWith("http") ? next : `${baseUrl}/${next}`, {
      headers: { Cookie: cookie, Prefer: "odata.maxpagesize=200" },
    });
    if (!response.ok) throw new Error(`SAP PurchaseInvoices [${response.status}]: ${(await response.text()).slice(0, 500)}`);
    const page = await response.json();
    for (const invoice of (page.value || []) as SapInvoice[]) {
      if (invoiceOpenAmount(invoice) > 0.005) {
        const hidden = await loadExpensePaymentProfile(admin, companyDb, invoice);
        const cardCode = String(invoice.CardCode || "");
        if (cardCode && !bpCache.has(cardCode)) bpCache.set(cardCode, await getBusinessPartner(baseUrl, cookie, cardCode));
        if (cardCode && !supplierProfileCache.has(cardCode)) {
          supplierProfileCache.set(cardCode, await loadStoredSupplierPaymentProfile(admin, companyDb, cardCode));
        }
        const profile = inferPaymentProfile(
          cardCode ? bpCache.get(cardCode) || null : null,
          hidden,
          cardCode ? supplierProfileCache.get(cardCode) || null : null,
        );
        titles.push(...installmentTitles(invoice, profile));
      }
    }
    const link = page["odata.nextLink"] || page["@odata.nextLink"];
    next = link ? (String(link).startsWith("http") ? String(link) : String(link).replace(/^\/+/, "")) : null;
    pages++;
  }
  return titles;
}

const ACTIVE_REMITTANCE_STATUSES = ["remitted", "scheduled", "paid", "sap_processing", "sap_error"];

async function listAvailableTitles(admin: AdminClient, companyDb: string, req: Request, body: Record<string, unknown>): Promise<OpenTitle[]> {
  const openTitles = await withSap(admin, companyDb, req, (baseUrl, cookie) => listOpenInvoices(admin, companyDb, baseUrl, cookie, {
    dueFrom: body.due_from,
    dueTo: body.due_to,
  }));
  const { data, error } = await admin
    .from("accounts_payable_batch_items")
    .select("sap_doc_entry, installment_id")
    .eq("company_db", companyDb)
    .in("status", ACTIVE_REMITTANCE_STATUSES);
  if (error) throw new Error(`Remessas em andamento: ${message(error)}`);
  const unavailable = new Set((data || []).map((item) => `${item.sap_doc_entry}:${item.installment_id}`));
  return openTitles.filter((title) => !unavailable.has(`${title.sap_doc_entry}:${title.installment_id}`));
}

async function sha256(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bankAccount(row: Record<string, unknown>): SicoobBankAccount {
  return {
    bankCode: String(row.bank_code || "756"),
    legalName: String(row.legal_name || ""),
    taxId: String(row.tax_id || ""),
    agreementCode: String(row.agreement_code || ""),
    agency: String(row.agency || ""),
    agencyDigit: String(row.agency_digit || ""),
    accountNumber: String(row.account_number || ""),
    accountDigit: String(row.account_digit || ""),
    agencyAccountDigit: String(row.agency_account_digit || ""),
  };
}

async function loadBankConfig(admin: AdminClient, companyDb: string) {
  const { data, error } = await admin.from("accounts_payable_bank_accounts").select("*").eq("company_db", companyDb).maybeSingle();
  if (error) throw new Error(`Configuração bancária: ${message(error)}`);
  return data as Record<string, unknown> | null;
}

async function saveBankConfig(admin: AdminClient, companyDb: string, body: Record<string, unknown>, actor: string) {
  const required = ["legal_name", "tax_id", "agreement_code", "agency", "account_number", "account_digit", "sap_transfer_account"];
  for (const key of required) if (!String(body[key] ?? "").trim()) throw new Error(`Campo obrigatório ausente: ${key}.`);
  const payload = {
    company_db: companyDb,
    bank_code: "756",
    legal_name: String(body.legal_name).trim(),
    tax_id: digits(body.tax_id),
    agreement_code: String(body.agreement_code).trim(),
    agency: digits(body.agency),
    agency_digit: String(body.agency_digit || "").trim(),
    account_number: digits(body.account_number),
    account_digit: digits(body.account_digit),
    agency_account_digit: String(body.agency_account_digit || "").trim(),
    sap_transfer_account: String(body.sap_transfer_account).trim(),
    active: body.active !== false,
    created_by: actor,
  };
  const { data, error } = await admin.from("accounts_payable_bank_accounts").upsert(payload, { onConflict: "company_db" }).select("*").single();
  if (error) throw new Error(`Falha ao salvar configuração: ${message(error)}`);
  return data;
}

async function reserveSequence(admin: AdminClient, companyDb: string) {
  const { data, error } = await admin.rpc("reserve_accounts_payable_file_sequence", { p_company_db: companyDb });
  if (error || !data?.[0]) throw new Error(error ? message(error) : "Não foi possível reservar a sequência do arquivo.");
  return { bankAccountId: data[0].bank_account_id as string, sequence: Number(data[0].file_sequence) };
}

async function insertBatchItems(admin: AdminClient, rows: Array<Record<string, unknown>>) {
  const { error } = await admin.from("accounts_payable_batch_items").insert(rows);
  if (!error) return;
  if (!isMissingColumn(error)) throw error;

  const safeRows = rows.map((row) => {
    const next = { ...row };
    delete next.payment_method;
    delete next.payment_metadata;
    return next;
  });
  const fallback = await admin.from("accounts_payable_batch_items").insert(safeRows);
  if (fallback.error) throw fallback.error;
}

function stableReference(id: string): string {
  return `AP${id.replace(/-/g, "").slice(0, 18)}`;
}

async function generateBatch(admin: AdminClient, companyDb: string, body: Record<string, unknown>, actor: string, req: Request) {
  const requested = Array.isArray(body.titles) ? body.titles as Array<Record<string, unknown>> : [];
  if (!requested.length) throw new Error("Selecione ao menos um título.");
  const paymentDate = day(body.payment_date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) throw new Error("Data de pagamento inválida.");
  const config = await loadBankConfig(admin, companyDb);
  if (!config || config.active === false) throw new Error("Configure uma conta Sicoob ativa antes de gerar a remessa.");

  const requestedEntries = requested.map((title) => Number(title.sap_doc_entry)).filter(Number.isInteger);
  const { data: activeItems, error: activeError } = await admin
    .from("accounts_payable_batch_items")
    .select("sap_doc_entry, installment_id")
    .eq("company_db", companyDb)
    .in("sap_doc_entry", requestedEntries)
    .in("status", ACTIVE_REMITTANCE_STATUSES);
  if (activeError) throw new Error(`Validação de remessas: ${message(activeError)}`);
  const activeKeys = new Set((activeItems || []).map((item) => `${item.sap_doc_entry}:${item.installment_id}`));
  const duplicated = requested.find((title) => activeKeys.has(`${Number(title.sap_doc_entry)}:${Number(title.installment_id || 0)}`));
  if (duplicated) throw new Error(`O documento ${duplicated.sap_doc_entry} já possui uma remessa em andamento.`);

  return await withSap(admin, companyDb, req, async (baseUrl, cookie) => {
    const validated: Array<Record<string, unknown> & { id: string; reference: string }> = [];
    for (const input of requested) {
      const docEntry = Number(input.sap_doc_entry);
      const installmentId = Number(input.installment_id || 0);
      const amount = roundMoney(input.amount);
      const paymentMethod = normalizeRemittancePaymentMethod(input.payment_method || "boleto");
      const barcode = digits(input.barcode);
      const bankCode = digits(input.bank_code);
      const branch = digits(input.branch);
      const branchDigit = firstText(input.branch_digit);
      const accountNumber = digits(input.account_number);
      const accountDigit = firstText(input.account_digit);
      const accountType = firstText(input.account_type);
      const pixKeyType = firstText(input.pix_key_type);
      const pixKey = firstText(input.pix_key);
      const supplierTaxId = digits(input.supplier_tax_id);
      const beneficiaryName = firstText(input.beneficiary_name);
      const beneficiaryTaxId = digits(input.beneficiary_tax_id || input.supplier_tax_id);
      if (!Number.isInteger(docEntry) || docEntry <= 0 || amount <= 0 || paymentMethod === "unknown") {
        throw new Error("Título inválido: documento, valor e forma de pagamento são obrigatórios.");
      }
      if (paymentMethod === "boleto" && barcode.length !== 44) {
        throw new Error("Título inválido: código de barras do boleto é obrigatório.");
      }
      if (paymentMethod === "ted" && (!bankCode || !branch || !accountNumber || !beneficiaryTaxId)) {
        throw new Error("Título inválido: TED exige banco, agência, conta e CPF/CNPJ do favorecido.");
      }
      if (paymentMethod === "pix" && (!pixKeyType || !pixKey || !beneficiaryTaxId)) {
        throw new Error("Título inválido: PIX exige tipo da chave, chave PIX e CPF/CNPJ do favorecido.");
      }
      const invoice = await getInvoice(baseUrl, cookie, docEntry);
      const current = installmentTitles(invoice).find((title) => title.installment_id === installmentId) || installmentTitles(invoice)[0];
      if (!current || current.open_amount + 0.005 < amount) {
        throw new Error(`NF ${invoice.DocNum}: saldo atual insuficiente para a remessa.`);
      }
      const invoiceCurrency = normalizeCurrency(invoice.DocCurrency);
      if (invoiceCurrency !== "BRL") throw new Error(`NF ${invoice.DocNum}: CNAB disponível inicialmente apenas para títulos em BRL.`);
      const id = crypto.randomUUID();
      validated.push({
        id,
        reference: stableReference(id),
        ...current,
        barcode,
        payment_method: paymentMethod,
        beneficiary_name: beneficiaryName || current.beneficiary_name || current.supplier_name,
        beneficiary_tax_id: beneficiaryTaxId || digits(current.beneficiary_tax_id || current.supplier_tax_id) || null,
        bank_code: bankCode || current.bank_code || null,
        branch: branch || current.branch || null,
        branch_digit: branchDigit || current.branch_digit || null,
        account_number: accountNumber || current.account_number || null,
        account_digit: accountDigit || current.account_digit || null,
        account_type: accountType || current.account_type || null,
        pix_key_type: pixKeyType || current.pix_key_type || null,
        pix_key: pixKey || current.pix_key || null,
        amount,
        supplier_tax_id: supplierTaxId || digits(current.supplier_tax_id) || null,
      });
    }

    const reserved = await reserveSequence(admin, companyDb);
    const cnabTitles: SicoobPaymentTitle[] = validated.map((title) => ({
      id: title.id,
      paymentMethod: title.payment_method as "boleto" | "pix" | "ted",
      barcode: title.barcode ? String(title.barcode) : null,
      supplierName: String(title.beneficiary_name || title.supplier_name),
      supplierTaxId: title.beneficiary_tax_id ? String(title.beneficiary_tax_id) : title.supplier_tax_id ? String(title.supplier_tax_id) : null,
      dueDate: String(title.due_date),
      paymentDate,
      amount: Number(title.amount),
      companyReference: title.reference,
      bankCode: title.bank_code ? String(title.bank_code) : null,
      branch: title.branch ? String(title.branch) : null,
      branchDigit: title.branch_digit ? String(title.branch_digit) : null,
      accountNumber: title.account_number ? String(title.account_number) : null,
      accountDigit: title.account_digit ? String(title.account_digit) : null,
      accountType: title.account_type ? String(title.account_type) : null,
      pixKeyType: title.pix_key_type ? String(title.pix_key_type) : null,
      pixKey: title.pix_key ? String(title.pix_key) : null,
    }));
    const remittance = generateSicoobCnab240({ account: bankAccount(config), fileSequence: reserved.sequence, titles: cnabTitles });
    const contentHash = await sha256(remittance.content);
    const filename = `PAG_${paymentDate.replace(/-/g, "")}_${String(reserved.sequence).padStart(6, "0")}.REM`;
    const batchId = crypto.randomUUID();
    const batchPayload = {
      id: batchId,
      company_db: companyDb,
      bank_account_id: reserved.bankAccountId,
      file_sequence: reserved.sequence,
      filename,
      payment_date: paymentDate,
      title_count: validated.length,
      total_amount: remittance.totalAmount,
      content: remittance.content,
      content_sha256: contentHash,
      generated_by: actor,
    };
    let { error: batchError } = await admin.from("accounts_payable_batches").insert(batchPayload);
    if (batchError && isMissingColumn(batchError)) {
      const safePayload = { ...batchPayload };
      delete (safePayload as Record<string, unknown>).content;
      ({ error: batchError } = await admin.from("accounts_payable_batches").insert(safePayload));
    }
    if (batchError) throw new Error(`Falha ao registrar remessa: ${message(batchError)}`);

    const rows = validated.map((title) => ({
      id: title.id,
      batch_id: batchId,
      company_db: companyDb,
      sap_doc_entry: title.sap_doc_entry,
      sap_doc_num: title.sap_doc_num,
      installment_id: title.installment_id,
      supplier_code: title.supplier_code,
      supplier_name: title.supplier_name,
      supplier_tax_id: title.supplier_tax_id,
      due_date: title.due_date,
      scheduled_date: paymentDate,
      amount: title.amount,
      currency: title.currency,
      barcode: title.payment_method === "boleto" ? title.barcode : null,
      payment_method: title.payment_method,
      payment_metadata: {
        beneficiary_name: title.beneficiary_name,
        beneficiary_tax_id: title.beneficiary_tax_id,
        bank_code: title.bank_code,
        branch: title.branch,
        branch_digit: title.branch_digit,
        account_number: title.account_number,
        account_digit: title.account_digit,
        account_type: title.account_type,
        pix_key_type: title.pix_key_type,
        pix_key: title.pix_key,
      },
      company_reference: title.reference,
      idempotency_key: `${companyDb}:${batchId}:${title.sap_doc_entry}:${title.installment_id}`,
    }));
    try {
      await insertBatchItems(admin, rows);
    } catch (itemError) {
      await admin.from("accounts_payable_batches").delete().eq("id", batchId);
      throw new Error(`Falha ao registrar títulos: ${message(itemError)}`);
    }
    return { batch_id: batchId, filename, content: remittance.content, sequence: reserved.sequence, title_count: validated.length, total_amount: remittance.totalAmount };
  });
}

async function listBatches(admin: AdminClient, companyDb: string) {
  const { data: batches, error } = await admin
    .from("accounts_payable_batches")
    .select("id, company_db, bank_account_id, file_sequence, filename, payment_date, title_count, total_amount, status, content_sha256, return_filename, return_sha256, generated_by, generated_at, processed_at, error_message, created_at, updated_at")
    .eq("company_db", companyDb)
    .order("generated_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`Lotes: ${message(error)}`);

  const batchIds = (batches || []).map((batch: { id: string }) => batch.id).filter(Boolean);
  if (!batchIds.length) return [];

  const { data: items, error: itemsError } = await admin
    .from("accounts_payable_batch_items")
    .select("*")
    .eq("company_db", companyDb)
    .in("batch_id", batchIds);
  if (itemsError) throw new Error(`Itens dos lotes: ${message(itemsError)}`);

  const byBatch = new Map<string, unknown[]>();
  for (const item of items || []) {
    const key = String(item.batch_id || "");
    byBatch.set(key, [...(byBatch.get(key) || []), item]);
  }

  return (batches || []).map((batch: { id: string }) => ({
    ...batch,
    accounts_payable_batch_items: byBatch.get(batch.id) || [],
  }));
}

function batchItemTitle(item: Record<string, unknown>, paymentDate: string): SicoobPaymentTitle {
  const metadata = isRecord(item.payment_metadata) ? item.payment_metadata : {};
  const method = normalizeRemittancePaymentMethod(item.payment_method || (item.barcode ? "boleto" : "ted"));
  if (method === "unknown") throw new Error(`Título ${item.sap_doc_num || item.company_reference}: forma de pagamento ausente.`);
  return {
    id: String(item.id || crypto.randomUUID()),
    paymentMethod: method,
    barcode: method === "boleto" ? String(item.barcode || "") : null,
    supplierName: String(metadata.beneficiary_name || item.supplier_name || ""),
    supplierTaxId: firstText(metadata.beneficiary_tax_id, item.supplier_tax_id),
    dueDate: day(item.due_date),
    paymentDate,
    amount: roundMoney(item.amount),
    companyReference: String(item.company_reference || ""),
    bankCode: firstText(metadata.bank_code),
    branch: firstText(metadata.branch),
    branchDigit: firstText(metadata.branch_digit),
    accountNumber: firstText(metadata.account_number),
    accountDigit: firstText(metadata.account_digit),
    accountType: firstText(metadata.account_type),
    pixKeyType: firstText(metadata.pix_key_type),
    pixKey: firstText(metadata.pix_key),
  };
}

async function downloadBatch(admin: AdminClient, companyDb: string, body: Record<string, unknown>) {
  const batchId = String(body.batch_id || "").trim();
  if (!batchId) throw new Error("batch_id é obrigatório.");
  const { data: batch, error } = await admin
    .from("accounts_payable_batches")
    .select("*")
    .eq("company_db", companyDb)
    .eq("id", batchId)
    .maybeSingle();
  if (error) throw new Error(`Lote: ${message(error)}`);
  if (!batch) throw new Error("Lote não encontrado.");
  if (String(batch.content || "")) return { filename: batch.filename, content: batch.content, regenerated: false };

  const config = await loadBankConfig(admin, companyDb);
  if (!config || config.active === false) throw new Error("Configure uma conta Sicoob ativa antes de reconstruir a remessa.");
  const { data: items, error: itemsError } = await admin
    .from("accounts_payable_batch_items")
    .select("*")
    .eq("company_db", companyDb)
    .eq("batch_id", batchId)
    .order("created_at", { ascending: true });
  if (itemsError) throw new Error(`Itens do lote: ${message(itemsError)}`);
  const titles = (items || []).map((item: Record<string, unknown>) => batchItemTitle(item, day(batch.payment_date)));
  if (!titles.length) throw new Error("Lote sem títulos para reconstrução.");
  const remittance = generateSicoobCnab240({
    account: bankAccount(config),
    fileSequence: Number(batch.file_sequence),
    generatedAt: new Date(String(batch.generated_at || Date.now())),
    titles,
  });
  return { filename: batch.filename, content: remittance.content, regenerated: true };
}

async function matchReturn(admin: AdminClient, companyDb: string, parsedTitles: SicoobReturnTitle[]) {
  const references = parsedTitles.map((title) => title.companyReference).filter(Boolean);
  if (!references.length) return [];
  const { data, error } = await admin
    .from("accounts_payable_batch_items")
    .select("*")
    .eq("company_db", companyDb)
    .in("company_reference", references);
  if (error) throw new Error(`Títulos do retorno: ${message(error)}`);
  const byReference = new Map((data || []).map((row) => [row.company_reference, row]));
  return parsedTitles.map((title) => ({ ...title, item: byReference.get(title.companyReference) || null }));
}

async function previewReturn(admin: AdminClient, companyDb: string, content: string) {
  const parsed = parseSicoobReturn(content);
  return { ...parsed, matches: await matchReturn(admin, companyDb, parsed.titles) };
}

async function postVendorPayment(baseUrl: string, cookie: string, invoice: SapInvoice, item: Record<string, unknown>, paid: SicoobReturnTitle, transferAccount: string) {
  const amount = roundMoney(paid.paymentAmount || item.amount);
  const paymentDate = paid.paymentDate || day(item.scheduled_date);
  const paymentInvoice: Record<string, unknown> = {
    DocEntry: invoice.DocEntry,
    InvoiceType: "it_PurchaseInvoice",
    SumApplied: amount,
  };
  if (Number(item.installment_id) > 0) paymentInvoice.InstallmentId = Number(item.installment_id);
  const payload = {
    DocType: "rSupplier",
    CardCode: invoice.CardCode,
    DocDate: paymentDate,
    TaxDate: paymentDate,
    DueDate: paymentDate,
    JournalRemarks: `PAGAMENTO CNAB REF. CP ${invoice.DocNum}`.slice(0, 50),
    Reference1: String(invoice.DocNum),
    Reference2: String(item.company_reference),
    TransferAccount: transferAccount,
    TransferSum: amount,
    TransferDate: paymentDate,
    DocCurrency: "BRL",
    ...(invoice.BPL_IDAssignedToInvoice != null ? { BPLID: invoice.BPL_IDAssignedToInvoice } : {}),
    PaymentInvoices: [paymentInvoice],
  };
  return await sapJson(baseUrl, cookie, "VendorPayments", { method: "POST", body: JSON.stringify(payload) });
}

async function processReturn(admin: AdminClient, companyDb: string, content: string, filename: string, actor: string, req: Request) {
  const parsed = parseSicoobReturn(content);
  const returnHash = await sha256(content);
  const { data: batch, error: batchError } = await admin
    .from("accounts_payable_batches")
    .select("*, accounts_payable_bank_accounts(sap_transfer_account)")
    .eq("company_db", companyDb)
    .eq("file_sequence", parsed.fileSequence)
    .maybeSingle();
  if (batchError) throw new Error(`Lote do retorno: ${message(batchError)}`);
  if (!batch) throw new Error(`Não existe remessa ${parsed.fileSequence} para esta empresa.`);
  if (batch.return_sha256 && batch.return_sha256 !== returnHash) throw new Error("Este lote já recebeu outro arquivo de retorno.");
  const matches = await matchReturn(admin, companyDb, parsed.titles);
  const accountRelation = Array.isArray(batch.accounts_payable_bank_accounts)
    ? batch.accounts_payable_bank_accounts[0]
    : batch.accounts_payable_bank_accounts;
  const transferAccount = String(accountRelation?.sap_transfer_account || "");
  if (!transferAccount) throw new Error("Conta contábil de saída não configurada.");

  await admin.from("accounts_payable_batches").update({
    status: "processing",
    return_filename: filename || `RET_${parsed.fileSequence}.RET`,
    return_sha256: returnHash,
    return_imported_by: actor,
    return_imported_at: new Date().toISOString(),
    error_message: null,
  }).eq("id", batch.id);

  const results: Array<Record<string, unknown>> = [];
  const paidMatches: typeof matches = [];
  for (const match of matches) {
    const item = match.item as Record<string, unknown> | null;
    const eventStatus = match.status === "paid" ? "paid" : match.status === "scheduled" ? "scheduled" : match.status === "rejected" ? "rejected" : "ignored";
    await admin.from("accounts_payable_return_events").upsert({
      batch_id: batch.id,
      item_id: item?.id || null,
      company_db: companyDb,
      return_sha256: returnHash,
      line_number: match.lineNumber,
      segment: "J",
      occurrence_codes: match.occurrenceCodes,
      processing_status: eventStatus,
      payload: {
        reference: match.companyReference,
        bank_reference: match.bankReference,
        payment_date: match.paymentDate,
        payment_amount: match.paymentAmount,
      },
    }, { onConflict: "return_sha256,line_number" });

    if (!item) {
      results.push({ reference: match.companyReference, status: "unmatched" });
    } else if (match.status !== "paid") {
      await admin.from("accounts_payable_batch_items").update({
        status: match.status === "scheduled" ? "scheduled" : match.status === "rejected" ? "bank_rejected" : item.status,
        return_occurrences: match.occurrenceCodes,
        bank_protocol: match.bankReference || null,
      }).eq("id", item.id);
      results.push({ reference: match.companyReference, status: match.status });
    } else if (item.sap_payment_doc_entry) {
      results.push({ reference: match.companyReference, status: "already_processed", sap_doc_entry: item.sap_payment_doc_entry });
    } else {
      paidMatches.push(match);
    }
  }

  if (paidMatches.length) {
    try {
      await withSap(admin, companyDb, req, async (baseUrl, cookie) => {
        for (const match of paidMatches) {
          const item = match.item as Record<string, unknown>;
          const { data: claimed, error: claimError } = await admin.rpc("claim_accounts_payable_item", { p_item_id: item.id });
          if (claimError || !claimed?.[0]) {
            results.push({ reference: match.companyReference, status: "already_claimed" });
            continue;
          }
          await admin.from("accounts_payable_batch_items").update({
            return_occurrences: match.occurrenceCodes,
            bank_protocol: match.bankReference || null,
            paid_date: match.paymentDate,
            paid_amount: match.paymentAmount || item.amount,
          }).eq("id", item.id);

          try {
            const invoice = await getInvoice(baseUrl, cookie, Number(item.sap_doc_entry));
            const open = invoiceOpenAmount(invoice);
            if (open <= 0.005 || invoice.DocumentStatus === "bost_Close") {
              await admin.from("accounts_payable_batch_items").update({ status: "already_settled" }).eq("id", item.id);
              results.push({ reference: match.companyReference, status: "already_settled" });
              continue;
            }
            const paidAmount = roundMoney(match.paymentAmount || item.amount);
            if (paidAmount > open + 0.005) throw new Error(`Valor pago (${paidAmount}) excede saldo atual da NF (${open}).`);
            const payment = await postVendorPayment(baseUrl, cookie, invoice, item, match, transferAccount);
            await admin.from("accounts_payable_batch_items").update({
              status: "sap_settled",
              sap_payment_doc_entry: Number(payment.DocEntry),
              sap_payment_doc_num: Number(payment.DocNum ?? payment.DocEntry),
              sap_error: null,
            }).eq("id", item.id);
            await admin.from("accounts_payable_return_events").update({ processing_status: "sap_settled" })
              .eq("return_sha256", returnHash).eq("line_number", match.lineNumber);
            results.push({ reference: match.companyReference, status: "sap_settled", sap_doc_entry: payment.DocEntry });
          } catch (error) {
            await admin.from("accounts_payable_batch_items").update({ status: "sap_error", sap_error: message(error).slice(0, 1000) }).eq("id", item.id);
            await admin.from("accounts_payable_return_events").update({ processing_status: "sap_error" })
              .eq("return_sha256", returnHash).eq("line_number", match.lineNumber);
            results.push({ reference: match.companyReference, status: "sap_error", error: message(error) });
          }
        }
      });
    } catch (error) {
      await admin.from("accounts_payable_batches").update({ status: "error", error_message: message(error).slice(0, 1000) }).eq("id", batch.id);
      throw error;
    }
  }

  const failures = results.filter((result) => result.status === "sap_error" || result.status === "unmatched").length;
  const successes = results.filter((result) => result.status === "sap_settled" || result.status === "already_processed" || result.status === "already_settled").length;
  const status = failures ? (successes ? "partial" : "error") : "processed";
  await admin.from("accounts_payable_batches").update({ status, error_message: failures ? `${failures} ocorrência(s) exigem revisão.` : null }).eq("id", batch.id);
  return { batch_id: batch.id, status, results };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  let auth: Record<string, unknown>;
  try {
    auth = await requireAdminOrSapModule(req, "financial_review") as Record<string, unknown>;
  } catch (error) {
    return authErrorResponse(error, corsHeaders) ?? json({ error: "Acesso negado." }, 403);
  }

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action || "");
    const companyDb = String(body.company_db || "").trim();
    if (!companyDb) return json({ error: "company_db é obrigatório." }, 400);
    if (auth.companyDB && String(auth.companyDB) !== companyDb) return json({ error: "Empresa divergente da sessão autenticada." }, 403);
    const actor = String(auth.email || auth.userName || auth.id || "unknown");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (action === "get_config") return json({ config: await loadBankConfig(admin, companyDb) });
    if (action === "save_config") return json({ config: await saveBankConfig(admin, companyDb, body, actor) });
    if (action === "get_supplier_payment_profile") return json(await getSupplierPaymentProfile(admin, companyDb, body, req));
    if (action === "save_supplier_payment_profile") return json(await saveSupplierPaymentProfile(admin, companyDb, body, actor, req));
    if (action === "list_open") return json({ titles: await listAvailableTitles(admin, companyDb, req, body) });
    if (action === "generate") return json(await generateBatch(admin, companyDb, body, actor, req));
    if (action === "list_batches") return json({ batches: await listBatches(admin, companyDb) });
    if (action === "download_batch") return json(await downloadBatch(admin, companyDb, body));
    if (action === "preview_return") return json(await previewReturn(admin, companyDb, String(body.content || "")));
    if (action === "process_return") return json(await processReturn(admin, companyDb, String(body.content || ""), String(body.filename || ""), actor, req));
    return json({ error: "Ação inválida." }, 400);
  } catch (error) {
    console.error("[accounts-payable-cnab]", message(error));
    return json({ error: message(error) }, 500);
  }
});
