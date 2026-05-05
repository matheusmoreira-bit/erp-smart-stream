// ISO-3166 alpha-2 country list used by supplier forms.
// `default_currency` is a hint — the form still lets the user override.

export interface CountryOption {
  code: string; // ISO alpha-2
  name: string; // Portuguese name
  default_currency: string; // ISO 4217
  tax_id_label: string; // e.g. "CNPJ/CPF", "EIN", "VAT-ID"
  zip_label: string; // e.g. "CEP", "ZIP", "Postal Code"
  state_label: string; // e.g. "UF", "State", "Province"
}

export const COUNTRIES: CountryOption[] = [
  { code: "BR", name: "Brasil", default_currency: "BRL", tax_id_label: "CNPJ/CPF", zip_label: "CEP", state_label: "UF" },
  { code: "US", name: "Estados Unidos", default_currency: "USD", tax_id_label: "EIN", zip_label: "ZIP Code", state_label: "Estado" },
  { code: "CA", name: "Canadá", default_currency: "CAD", tax_id_label: "BN", zip_label: "Postal Code", state_label: "Província" },
  { code: "MX", name: "México", default_currency: "USD", tax_id_label: "RFC", zip_label: "Código Postal", state_label: "Estado" },
  { code: "AR", name: "Argentina", default_currency: "USD", tax_id_label: "CUIT", zip_label: "CP", state_label: "Província" },
  { code: "CL", name: "Chile", default_currency: "USD", tax_id_label: "RUT", zip_label: "CP", state_label: "Região" },
  { code: "CO", name: "Colômbia", default_currency: "USD", tax_id_label: "NIT", zip_label: "CP", state_label: "Departamento" },
  { code: "UY", name: "Uruguai", default_currency: "USD", tax_id_label: "RUT", zip_label: "CP", state_label: "Departamento" },
  { code: "PY", name: "Paraguai", default_currency: "USD", tax_id_label: "RUC", zip_label: "CP", state_label: "Departamento" },
  { code: "PE", name: "Peru", default_currency: "USD", tax_id_label: "RUC", zip_label: "CP", state_label: "Região" },
  { code: "GB", name: "Reino Unido", default_currency: "GBP", tax_id_label: "VAT-ID", zip_label: "Postcode", state_label: "Condado" },
  { code: "DE", name: "Alemanha", default_currency: "EUR", tax_id_label: "USt-IdNr.", zip_label: "PLZ", state_label: "Estado" },
  { code: "FR", name: "França", default_currency: "EUR", tax_id_label: "TVA", zip_label: "Code Postal", state_label: "Região" },
  { code: "IT", name: "Itália", default_currency: "EUR", tax_id_label: "P. IVA", zip_label: "CAP", state_label: "Província" },
  { code: "ES", name: "Espanha", default_currency: "EUR", tax_id_label: "NIF/CIF", zip_label: "CP", state_label: "Província" },
  { code: "PT", name: "Portugal", default_currency: "EUR", tax_id_label: "NIF", zip_label: "CP", state_label: "Distrito" },
  { code: "NL", name: "Países Baixos", default_currency: "EUR", tax_id_label: "BTW-ID", zip_label: "Postcode", state_label: "Província" },
  { code: "CH", name: "Suíça", default_currency: "EUR", tax_id_label: "MWST-Nr.", zip_label: "PLZ", state_label: "Cantão" },
  { code: "JP", name: "Japão", default_currency: "USD", tax_id_label: "Tax ID", zip_label: "Postal Code", state_label: "Prefeitura" },
  { code: "CN", name: "China", default_currency: "USD", tax_id_label: "Tax ID", zip_label: "Postal Code", state_label: "Província" },
  { code: "AU", name: "Austrália", default_currency: "USD", tax_id_label: "ABN", zip_label: "Postcode", state_label: "Estado" },
];

const FALLBACK: CountryOption = {
  code: "XX",
  name: "Outro",
  default_currency: "USD",
  tax_id_label: "Tax ID",
  zip_label: "Postal Code",
  state_label: "Estado/Província",
};

export function getCountry(code?: string | null): CountryOption {
  if (!code) return COUNTRIES[0];
  const found = COUNTRIES.find((c) => c.code === code.toUpperCase());
  return found || { ...FALLBACK, code: code.toUpperCase() };
}

export function isForeign(countryCode?: string | null): boolean {
  if (!countryCode) return false;
  return countryCode.toUpperCase() !== "BR";
}
