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
  account: string;
  iban: string;
  isDefault: boolean;
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
    if (!/pix/i.test(k)) continue;
    const val = str(v);
    if (val) out.push(val);
  }
  return Array.from(new Set(out));
}

function mapBankAccount(row: Record<string, unknown>, defaultAccountKey: string): BpBankAccount {
  const pix = collectPixKeys(row);
  return {
    bankName: str(row.BankName) || str(row.BankCode),
    bankCode: str(row.BankCode),
    branch: str(row.Branch),
    account: str(row.AccountNo),
    iban: str(row.IBAN),
    isDefault: defaultAccountKey !== "" && str(row.InternalKey) === defaultAccountKey,
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

  const taxId = str(row.FederalTaxID) || str(row.UnifiedFederalTaxID);
  const accounts = Array.isArray(row.BPBankAccounts) ? (row.BPBankAccounts as Record<string, unknown>[]) : [];
  const defaultKey = str(row.DefaultBankCode) ? "" : str(row.BankCode);

  const address = [
    str(row.Address),
    str(row.Block),
    str(row.City),
    str(row.State),
    str(row.ZipCode),
  ]
    .filter(Boolean)
    .join(" · ");

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
    bankAccounts: accounts.map((a) => mapBankAccount(a, defaultKey)),
    pixKeys: collectPixKeys(row),
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
