/**
 * Consulta do cadastro completo do parceiro de negócios (fornecedor/cliente)
 * direto do ERP, para que o usuário não precise abrir o SAP para conferir
 * CNPJ, dados bancários e chave PIX antes de lançar um documento.
 */

import { sapQuery, type SapSession } from "@/lib/sap-client";
import { formatCnpjCpf, onlyDigits } from "@/lib/supplier-search";

export interface BpBankAccount {
  bankName: string;
  bankCode: string;
  branch: string;
  branchDigit: string;
  account: string;
  accountDigit: string;
  accountType: string;
  iban: string;
  isDefault: boolean;
  pixKeyType: string;
  /** Chave PIX identificada em campos padrão/UDF da conta. */
  pixKey: string;
}

export interface BusinessPartnerDetails {
  cardCode: string;
  cardName: string;
  taxId: string;
  taxIdFormatted: string;
  taxIdDigits: string;
  stateTaxId: string;
  frozen: boolean;
  currency: string;
  paymentTerms: string;
  email: string;
  phone: string;
  address: string;
  bankAccounts: BpBankAccount[];
  /** Chaves PIX no nível do cadastro (UDFs do BP). */
  pixKeys: string[];
}

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
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

function businessPartnerRow(value: Record<string, unknown>): Record<string, unknown> {
  if (str(value.CardCode) || str(value.CardName)) return value;
  return collectionRows(value)[0] || value;
}

/** Procura chaves PIX em campos padrão e em UDFs (U_*) cujo nome contenha PIX. */
function collectPixKeys(row: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(row)) {
    if (!/pix/i.test(k) || /(tipo|type)/i.test(k)) continue;
    const val = str(v);
    if (val) out.push(val);
  }
  for (const account of collectionRows(row.BPBankAccounts)) {
    for (const [k, v] of Object.entries(account)) {
      if (!/pix/i.test(k) || /(tipo|type)/i.test(k)) continue;
      const val = str(v);
      if (val) out.push(val);
    }
  }
  return Array.from(new Set(out));
}

function fiscalTaxId(row: Record<string, unknown>, fallbackPixKey?: string): string {
  const direct = str(row.FederalTaxID) ||
    str(row.UnifiedFederalTaxID) ||
    str(row.VatRegistrationNumber) ||
    str(row.U_FGR_TAXID0) ||
    str(row.TaxId0) ||
    str(row.TaxId4);
  const directDigits = onlyDigits(direct);
  if (directDigits.length === 11 || directDigits.length === 14) return direct;

  const fiscalRows = collectionRows(row.BPFiscalTaxIDCollection);
  for (const fiscalRow of fiscalRows) {
    for (const [key, value] of Object.entries(fiscalRow)) {
      if (!/^TaxId\d+$/i.test(key)) continue;
      const candidate = str(value);
      const candidateDigits = onlyDigits(candidate);
      if (candidateDigits.length === 11 || candidateDigits.length === 14) return candidate;
    }
  }

  const pixDigits = onlyDigits(fallbackPixKey || "");
  return pixDigits.length === 11 || pixDigits.length === 14 ? fallbackPixKey || "" : "";
}

function inferPixKeyTypeFromKey(value: unknown): string {
  const text = str(value);
  if (!text) return "";
  const cleanDigits = onlyDigits(text);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) return "random";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.toLowerCase())) return "email";
  if (cleanDigits.length === 14) return "cnpj";
  if (cleanDigits.length === 11) return "cpf";
  if (cleanDigits.length >= 10 && cleanDigits.length <= 13 && /^[+()\d\s-]+$/.test(text)) return "phone";
  return "";
}

function normalizePixKeyType(value: unknown, pixKey?: unknown): string {
  const inferred = inferPixKeyTypeFromKey(pixKey);
  if (inferred) return inferred;
  const text = str(value).toLowerCase();
  if (!text) return "";
  if (text === "1" || text.includes("telefone") || text.includes("phone") || text.includes("celular")) return "phone";
  if (text === "2" || text.includes("email") || text.includes("mail")) return "email";
  if (text === "3" || text.includes("cnpj")) return "cnpj";
  if (text === "4" || text.includes("cpf")) return "cpf";
  if (text === "5" || text.includes("aleat") || text.includes("random") || text.includes("evp")) return "random";
  return text;
}

function normalizeAccountType(value: unknown): string {
  const text = str(value).toLowerCase();
  if (!text) return "";
  if (text === "2" || text.includes("poup") || text.includes("saving")) return "savings";
  if (text === "3" || text.includes("pagamento") || text.includes("payment")) return "payment";
  return "checking";
}

function matchesDefaults(
  account: { bankCode: string; branch: string; account: string },
  defaults: { bankCode: string; branch: string; account: string },
): boolean {
  const checks = [
    defaults.bankCode ? account.bankCode === defaults.bankCode : null,
    defaults.branch ? account.branch === defaults.branch : null,
    defaults.account ? account.account === defaults.account : null,
  ].filter((value): value is boolean => value !== null);
  return checks.length > 0 && checks.every(Boolean);
}

function mapBankAccount(
  row: Record<string, unknown>,
  defaults: { bankCode: string; branch: string; account: string },
): BpBankAccount {
  const pix = collectPixKeys(row);
  const bankCode = str(row.BankCode) || str(row.BankCode2) || str(row.BankKey);
  const branch = str(row.Branch) || str(row.BankBranch) || str(row.BranchCode);
  const account = str(row.AccountNo) || str(row.AccountNumber) || str(row.Account) || str(row.IBAN);
  const pixKey = pix[0] || "";
  return {
    bankName: str(row.BankName) || bankCode,
    bankCode,
    branch,
    branchDigit: str(row.AgencyControlKey) || str(row.BranchDigit),
    account,
    accountDigit: str(row.ControlKey) || str(row.AccountCheckDigit) || str(row.AccountDigit) || str(row.CheckDigit),
    accountType: normalizeAccountType(row.U_TipoConta || row.AccountType),
    iban: str(row.IBAN),
    isDefault: matchesDefaults({ bankCode, branch, account }, defaults),
    pixKeyType: normalizePixKeyType(row.U_TipoChavePix, pixKey),
    pixKey,
  };
}

/**
 * Busca o cadastro do BP no Service Layer. Sem `$select` para trazer também as
 * UDFs (onde o PIX costuma ficar) e a coleção `BPBankAccounts`.
 */
export async function fetchBusinessPartnerDetails(
  session: SapSession,
  cardCode: string,
): Promise<BusinessPartnerDetails> {
  const { data } = await sapQuery(
    session,
    `BusinessPartners('${encodeURIComponent(cardCode)}')`,
    undefined,
    false,
  );
  const row = businessPartnerRow((data || {}) as Record<string, unknown>);

  const accounts = collectionRows(row.BPBankAccounts);
  const defaults = {
    bankCode: str(row.DefaultBankCode) || str(row.BankCode) || str(row.BankCode2) || str(row.HouseBank),
    branch: str(row.DefaultBranch) || str(row.Branch) || str(row.BankBranch) || str(row.HouseBankBranch),
    account: str(row.DefaultAccount) || str(row.AccountNo) || str(row.AccountNumber) || str(row.HouseBankAccount),
  };

  const address = [
    str(row.Address),
    str(row.Block),
    str(row.City),
    str(row.State),
    str(row.ZipCode),
  ]
    .filter(Boolean)
    .join(" · ");

  const bankAccounts = accounts.map((a) => mapBankAccount(a, defaults));
  const pixKeys = Array.from(new Set([...collectPixKeys(row), ...bankAccounts.map((account) => account.pixKey)].filter(Boolean)));
  const taxId = fiscalTaxId(row, pixKeys[0]);

  return {
    cardCode: str(row.CardCode) || cardCode,
    cardName: str(row.CardName),
    taxId,
    taxIdFormatted: taxId ? formatCnpjCpf(taxId) : "",
    taxIdDigits: onlyDigits(taxId),
    stateTaxId: str(row.AdditionalID) || str(row.IndustryC),
    frozen: str(row.Frozen).toLowerCase() === "tyes",
    currency: str(row.Currency),
    paymentTerms: str(row.PayTermsGrpCode),
    email: str(row.EmailAddress),
    phone: str(row.Phone1) || str(row.Cellular),
    address,
    bankAccounts,
    pixKeys,
  };
}

/**
 * Confere se uma chave PIX informada (ex.: recebida do fornecedor) está
 * vinculada ao cadastro. Compara por dígitos quando a chave é CNPJ/CPF/telefone
 * e por texto normalizado nos demais casos (e-mail/aleatória).
 */
export function pixMatchesRegistration(
  details: BusinessPartnerDetails | null,
  pixKey: string,
): { known: boolean; matchesTaxId: boolean } {
  const key = str(pixKey);
  if (!details || !key) return { known: false, matchesTaxId: false };

  const digits = onlyDigits(key);
  const registered = [
    ...details.pixKeys,
    ...details.bankAccounts.map((b) => b.pixKey),
  ].filter(Boolean);

  const known = registered.some((r) => {
    const rd = onlyDigits(r);
    if (digits.length >= 11 && rd.length >= 11) return rd === digits;
    return r.trim().toLowerCase() === key.toLowerCase();
  });

  const matchesTaxId = digits.length >= 11 && !!details.taxIdDigits && details.taxIdDigits === digits;
  return { known, matchesTaxId };
}
