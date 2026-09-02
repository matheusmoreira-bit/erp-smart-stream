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

/** Procura chaves PIX em campos padrão e em UDFs (U_*) cujo nome contenha PIX. */
function collectPixKeys(row: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(row)) {
    if (!/pix/i.test(k) || /(tipo|type)/i.test(k)) continue;
    const val = str(v);
    if (val) out.push(val);
  }
  return Array.from(new Set(out));
}

function fiscalTaxId(row: Record<string, unknown>, fallbackPixKey?: string): string {
  const direct = str(row.FederalTaxID) || str(row.UnifiedFederalTaxID) || str(row.VatRegistrationNumber) || str(row.TaxId0) || str(row.TaxId4);
  const directDigits = onlyDigits(direct);
  if (directDigits.length === 11 || directDigits.length === 14) return direct;

  const fiscalRows = Array.isArray(row.BPFiscalTaxIDCollection) ? (row.BPFiscalTaxIDCollection as Record<string, unknown>[]) : [];
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

function normalizePixKeyType(value: unknown): string {
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
  const bankCode = str(row.BankCode);
  const branch = str(row.Branch) || str(row.BranchCode);
  const account = str(row.AccountNo) || str(row.Account) || str(row.IBAN);
  return {
    bankName: str(row.BankName) || bankCode,
    bankCode,
    branch,
    branchDigit: str(row.BranchDigit),
    account,
    accountDigit: str(row.ControlKey) || str(row.AccountDigit) || str(row.CheckDigit),
    accountType: normalizeAccountType(row.U_TipoConta || row.AccountType),
    iban: str(row.IBAN),
    isDefault: matchesDefaults({ bankCode, branch, account }, defaults),
    pixKeyType: normalizePixKeyType(row.U_TipoChavePix),
    pixKey: pix[0] || "",
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
  const row = (data || {}) as Record<string, unknown>;

  const accounts = Array.isArray(row.BPBankAccounts) ? (row.BPBankAccounts as Record<string, unknown>[]) : [];
  const defaults = {
    bankCode: str(row.DefaultBankCode) || str(row.BankCode),
    branch: str(row.DefaultBranch) || str(row.Branch) || str(row.HouseBankBranch),
    account: str(row.DefaultAccount) || str(row.AccountNo) || str(row.HouseBankAccount),
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
