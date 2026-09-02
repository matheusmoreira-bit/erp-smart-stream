export interface SicoobBankAccount {
  bankCode?: string;
  legalName: string;
  taxId: string;
  agreementCode: string;
  agency: string;
  agencyDigit?: string;
  accountNumber: string;
  accountDigit: string;
  agencyAccountDigit?: string;
}

export type SicoobPaymentMethod = "boleto" | "pix" | "ted";

export interface SicoobPaymentTitle {
  id: string;
  paymentMethod?: SicoobPaymentMethod;
  barcode?: string | null;
  supplierName: string;
  supplierTaxId?: string | null;
  dueDate: string;
  paymentDate: string;
  amount: number;
  companyReference: string;
  bankCode?: string | null;
  branch?: string | null;
  branchDigit?: string | null;
  accountNumber?: string | null;
  accountDigit?: string | null;
  accountType?: string | null;
  pixKeyType?: string | null;
  pixKey?: string | null;
}

export interface SicoobRemittanceInput {
  account: SicoobBankAccount;
  fileSequence: number;
  generatedAt?: Date;
  titles: SicoobPaymentTitle[];
}

export interface SicoobRemittanceResult {
  content: string;
  records: string[];
  lotCount: number;
  titleCount: number;
  totalAmount: number;
}

export type SicoobReturnStatus = "paid" | "scheduled" | "rejected" | "unknown";

export interface SicoobReturnTitle {
  lineNumber: number;
  lotNumber: number;
  sequence: number;
  barcode: string;
  supplierName: string;
  dueDate: string | null;
  nominalAmount: number;
  paymentDate: string | null;
  paymentAmount: number;
  companyReference: string;
  bankReference: string;
  occurrenceCodes: string[];
  status: SicoobReturnStatus;
}

export interface SicoobReturnFile {
  bankCode: string;
  fileSequence: number;
  generatedDate: string | null;
  titles: SicoobReturnTitle[];
  recordCount: number;
}

type FieldKind = "alpha" | "numeric";

function onlyDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function ascii(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .toUpperCase();
}

function field(value: unknown, length: number, kind: FieldKind): string {
  const normalized = kind === "numeric" ? onlyDigits(value) : ascii(value);
  if (normalized.length > length) return normalized.slice(0, length);
  return kind === "numeric"
    ? normalized.padStart(length, "0")
    : normalized.padEnd(length, " ");
}

function blankRecord(): string[] {
  return Array(240).fill(" ");
}

function put(record: string[], start: number, end: number, value: unknown, kind: FieldKind = "alpha") {
  const text = field(value, end - start + 1, kind);
  for (let i = 0; i < text.length; i++) record[start - 1 + i] = text[i];
}

function finish(record: string[]): string {
  const value = record.join("");
  if (value.length !== 240) throw new Error(`Registro CNAB inválido: ${value.length} posições.`);
  return value;
}

function dateToCnab(value: string | Date): string {
  const iso = typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Data inválida para CNAB: ${String(value)}`);
  return `${match[3]}${match[2]}${match[1]}`;
}

function timeToCnab(value: Date): string {
  return `${String(value.getHours()).padStart(2, "0")}${String(value.getMinutes()).padStart(2, "0")}${String(value.getSeconds()).padStart(2, "0")}`;
}

function cnabDateToIso(value: string): string | null {
  if (!/^\d{8}$/.test(value) || value === "00000000") return null;
  const iso = `${value.slice(4, 8)}-${value.slice(2, 4)}-${value.slice(0, 2)}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : iso;
}

function amountToCnab(value: number, length: number): string {
  if (!Number.isFinite(value) || value < 0) throw new Error(`Valor CNAB inválido: ${value}`);
  return field(Math.round(value * 100), length, "numeric");
}

function cnabToAmount(value: string): number {
  const cents = Number(onlyDigits(value));
  return Number.isFinite(cents) ? cents / 100 : 0;
}

function registrationType(taxId: string | null | undefined): string {
  const length = onlyDigits(taxId).length;
  if (!length) return "0";
  return length <= 11 ? "1" : "2";
}

function assertAccount(account: SicoobBankAccount) {
  if (onlyDigits(account.taxId).length !== 11 && onlyDigits(account.taxId).length !== 14) {
    throw new Error("CPF/CNPJ da empresa deve ter 11 ou 14 dígitos.");
  }
  if (!account.legalName.trim() || !account.agreementCode.trim() || !onlyDigits(account.agency) || !onlyDigits(account.accountNumber)) {
    throw new Error("Configuração bancária incompleta para gerar o CNAB.");
  }
}

function titleMethod(title: SicoobPaymentTitle): SicoobPaymentMethod {
  return title.paymentMethod || "boleto";
}

function assertTitle(title: SicoobPaymentTitle) {
  const method = titleMethod(title);
  if (method === "boleto" && !/^\d{44}$/.test(onlyDigits(title.barcode))) throw new Error(`Código de barras inválido para ${title.id}.`);
  if (method === "ted" && (!onlyDigits(title.bankCode) || !onlyDigits(title.branch) || !onlyDigits(title.accountNumber))) {
    throw new Error(`Dados bancários incompletos para TED em ${title.id}.`);
  }
  if (method === "pix" && (!String(title.pixKeyType || "").trim() || !String(title.pixKey || "").trim())) {
    throw new Error(`Chave PIX incompleta para ${title.id}.`);
  }
  if ((method === "pix" || method === "ted") && !onlyDigits(title.supplierTaxId)) {
    throw new Error(`CPF/CNPJ do favorecido obrigatório para ${title.id}.`);
  }
  if (!title.companyReference.trim() || title.companyReference.length > 20) throw new Error(`Referência inválida para ${title.id}.`);
  if (!Number.isFinite(title.amount) || title.amount <= 0) throw new Error(`Valor inválido para ${title.id}.`);
  dateToCnab(title.dueDate);
  dateToCnab(title.paymentDate);
}

function accountFields(record: string[], account: SicoobBankAccount) {
  put(record, 18, 18, registrationType(account.taxId), "numeric");
  put(record, 19, 32, account.taxId, "numeric");
  put(record, 33, 52, account.agreementCode);
  put(record, 53, 57, account.agency, "numeric");
  put(record, 58, 58, account.agencyDigit || "");
  put(record, 59, 70, account.accountNumber, "numeric");
  put(record, 71, 71, account.accountDigit, "numeric");
  put(record, 72, 72, account.agencyAccountDigit || "");
  put(record, 73, 102, account.legalName);
}

function fileHeader(account: SicoobBankAccount, sequence: number, generatedAt: Date): string {
  const r = blankRecord();
  put(r, 1, 3, account.bankCode || "756", "numeric");
  put(r, 4, 7, "0000", "numeric");
  put(r, 8, 8, "0", "numeric");
  accountFields(r, account);
  put(r, 103, 132, "SICOOB");
  put(r, 143, 143, "1", "numeric");
  put(r, 144, 151, dateToCnab(generatedAt), "numeric");
  put(r, 152, 157, timeToCnab(generatedAt), "numeric");
  put(r, 158, 163, sequence, "numeric");
  put(r, 164, 166, "087", "numeric");
  put(r, 167, 171, "00000", "numeric");
  return finish(r);
}

type LaunchForm = "03" | "30" | "31" | "45";

function lotHeader(account: SicoobBankAccount, lot: number, launchForm: LaunchForm): string {
  const r = blankRecord();
  put(r, 1, 3, account.bankCode || "756", "numeric");
  put(r, 4, 7, lot, "numeric");
  put(r, 8, 8, "1", "numeric");
  put(r, 9, 9, "C");
  put(r, 10, 11, "20", "numeric");
  put(r, 12, 13, launchForm, "numeric");
  put(r, 14, 16, "040", "numeric");
  accountFields(r, account);
  return finish(r);
}

function segmentJ(title: SicoobPaymentTitle, lot: number, sequence: number): string {
  const r = blankRecord();
  put(r, 1, 3, "756", "numeric");
  put(r, 4, 7, lot, "numeric");
  put(r, 8, 8, "3", "numeric");
  put(r, 9, 13, sequence, "numeric");
  put(r, 14, 14, "J");
  put(r, 15, 15, "0", "numeric");
  put(r, 16, 17, "00", "numeric");
  put(r, 18, 61, title.barcode || "", "numeric");
  put(r, 62, 91, title.supplierName);
  put(r, 92, 99, dateToCnab(title.dueDate), "numeric");
  put(r, 100, 114, amountToCnab(title.amount, 15), "numeric");
  put(r, 115, 129, 0, "numeric");
  put(r, 130, 144, 0, "numeric");
  put(r, 145, 152, dateToCnab(title.paymentDate), "numeric");
  put(r, 153, 167, amountToCnab(title.amount, 15), "numeric");
  put(r, 168, 182, 0, "numeric");
  put(r, 183, 202, title.companyReference);
  put(r, 223, 224, "09", "numeric");
  return finish(r);
}

function movementFields(record: string[], lot: number, sequence: number, segment: "A" | "B") {
  put(record, 1, 3, "756", "numeric");
  put(record, 4, 7, lot, "numeric");
  put(record, 8, 8, "3", "numeric");
  put(record, 9, 13, sequence, "numeric");
  put(record, 14, 14, segment);
  put(record, 15, 15, "0", "numeric");
  put(record, 16, 17, "00", "numeric");
}

function segmentA(title: SicoobPaymentTitle, lot: number, sequence: number): string {
  const r = blankRecord();
  movementFields(r, lot, sequence, "A");
  put(r, 18, 20, title.paymentMethod === "pix" ? "009" : "018", "numeric");
  put(r, 21, 23, title.bankCode || "", "numeric");
  put(r, 24, 28, title.branch || "", "numeric");
  put(r, 29, 29, title.branchDigit || "");
  put(r, 30, 41, title.accountNumber || "", "numeric");
  put(r, 42, 42, title.accountDigit || "");
  put(r, 44, 73, title.supplierName);
  put(r, 74, 93, title.companyReference);
  put(r, 94, 101, dateToCnab(title.paymentDate), "numeric");
  put(r, 102, 104, "BRL");
  put(r, 105, 119, 0, "numeric");
  put(r, 120, 134, amountToCnab(title.amount, 15), "numeric");
  put(r, 178, 217, title.paymentMethod === "pix" ? `PIX ${title.pixKeyType || ""}` : "TED");
  put(r, 230, 230, "0", "numeric");
  return finish(r);
}

function segmentB(title: SicoobPaymentTitle, lot: number, sequence: number): string {
  const r = blankRecord();
  movementFields(r, lot, sequence, "B");
  put(r, 18, 18, registrationType(title.supplierTaxId), "numeric");
  put(r, 19, 32, title.supplierTaxId || "", "numeric");
  put(r, 33, 62, title.supplierName);
  put(r, 128, 232, title.paymentMethod === "pix" ? `${title.pixKeyType || ""}:${title.pixKey || ""}` : title.companyReference);
  return finish(r);
}

function segmentJ52(account: SicoobBankAccount, title: SicoobPaymentTitle, lot: number, sequence: number): string {
  const r = blankRecord();
  put(r, 1, 3, "756", "numeric");
  put(r, 4, 7, lot, "numeric");
  put(r, 8, 8, "3", "numeric");
  put(r, 9, 13, sequence, "numeric");
  put(r, 14, 14, "J");
  put(r, 16, 17, "00", "numeric");
  put(r, 18, 19, "52", "numeric");
  put(r, 20, 20, registrationType(account.taxId), "numeric");
  put(r, 21, 35, account.taxId, "numeric");
  put(r, 36, 75, account.legalName);
  put(r, 76, 76, registrationType(title.supplierTaxId), "numeric");
  put(r, 77, 91, title.supplierTaxId || "0", "numeric");
  put(r, 92, 131, title.supplierName);
  put(r, 132, 132, "0", "numeric");
  put(r, 133, 147, "0", "numeric");
  return finish(r);
}

function lotTrailer(lot: number, recordCount: number, totalAmount: number): string {
  const r = blankRecord();
  put(r, 1, 3, "756", "numeric");
  put(r, 4, 7, lot, "numeric");
  put(r, 8, 8, "5", "numeric");
  put(r, 18, 23, recordCount, "numeric");
  put(r, 24, 41, amountToCnab(totalAmount, 18), "numeric");
  put(r, 42, 59, 0, "numeric");
  put(r, 60, 65, 0, "numeric");
  return finish(r);
}

function fileTrailer(lotCount: number, recordCount: number): string {
  const r = blankRecord();
  put(r, 1, 3, "756", "numeric");
  put(r, 4, 7, "9999", "numeric");
  put(r, 8, 8, "9", "numeric");
  put(r, 18, 23, lotCount, "numeric");
  put(r, 24, 29, recordCount, "numeric");
  put(r, 30, 35, 0, "numeric");
  return finish(r);
}

/** Gera Pagamento de Fornecedor (serviço 20). Boleto usa J/J-52; TED e PIX usam A/B. */
export function generateSicoobCnab240(input: SicoobRemittanceInput): SicoobRemittanceResult {
  assertAccount(input.account);
  if (!Number.isInteger(input.fileSequence) || input.fileSequence <= 0) throw new Error("Sequência de arquivo inválida.");
  if (!input.titles.length) throw new Error("Selecione ao menos um título para a remessa.");
  input.titles.forEach(assertTitle);

  const generatedAt = input.generatedAt || new Date();
  const boletoTitles = input.titles.filter((t) => titleMethod(t) === "boleto");
  const ownBank = boletoTitles.filter((t) => onlyDigits(t.barcode).slice(0, 3) === "756");
  const otherBank = boletoTitles.filter((t) => onlyDigits(t.barcode).slice(0, 3) !== "756");
  const tedTitles = input.titles.filter((t) => titleMethod(t) === "ted");
  const pixTitles = input.titles.filter((t) => titleMethod(t) === "pix");
  const groups: Array<{ form: LaunchForm; titles: SicoobPaymentTitle[] }> = [];
  if (ownBank.length) groups.push({ form: "30", titles: ownBank });
  if (otherBank.length) groups.push({ form: "31", titles: otherBank });
  if (tedTitles.length) groups.push({ form: "03", titles: tedTitles });
  if (pixTitles.length) groups.push({ form: "45", titles: pixTitles });

  const records: string[] = [fileHeader(input.account, input.fileSequence, generatedAt)];
  groups.forEach((group, groupIndex) => {
    const lot = groupIndex + 1;
    records.push(lotHeader(input.account, lot, group.form));
    let sequence = 1;
    for (const title of group.titles) {
      if (titleMethod(title) === "boleto") {
        records.push(segmentJ(title, lot, sequence++));
        records.push(segmentJ52(input.account, title, lot, sequence++));
      } else {
        records.push(segmentA(title, lot, sequence++));
        records.push(segmentB(title, lot, sequence++));
      }
    }
    const total = group.titles.reduce((sum, title) => sum + title.amount, 0);
    records.push(lotTrailer(lot, group.titles.length * 2 + 2, total));
  });
  records.push(fileTrailer(groups.length, records.length + 1));

  return {
    content: `${records.join("\r\n")}\r\n`,
    records,
    lotCount: groups.length,
    titleCount: input.titles.length,
    totalAmount: input.titles.reduce((sum, title) => sum + title.amount, 0),
  };
}

function occurrenceCodes(raw: string): string[] {
  const codes: string[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    const code = raw.slice(i, i + 2).trim();
    if (code) codes.push(code);
  }
  return codes;
}

function returnStatus(codes: string[]): SicoobReturnStatus {
  if (codes.includes("00")) return "paid";
  if (codes.includes("BD") || codes.includes("PD")) return "scheduled";
  return codes.length ? "rejected" : "unknown";
}

/** Interpreta o retorno Sicoob sem executar efeitos financeiros. */
export function parseSicoobReturn(content: string): SicoobReturnFile {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length < 3) throw new Error("Arquivo de retorno CNAB vazio ou incompleto.");
  lines.forEach((line, index) => {
    if (line.length !== 240) throw new Error(`Linha ${index + 1} possui ${line.length} posições; esperado: 240.`);
  });
  const header = lines[0];
  if (header.slice(0, 3) !== "756" || header[7] !== "0") throw new Error("O arquivo não é um CNAB 240 do Sicoob.");
  if (header[142] !== "2") throw new Error("O arquivo informado não está marcado como retorno bancário.");

  const titles: SicoobReturnTitle[] = [];
  lines.forEach((line, index) => {
    if (line[7] !== "3") return;
    if (line[13] === "A") {
      const codes = occurrenceCodes(line.slice(230, 240));
      titles.push({
        lineNumber: index + 1,
        lotNumber: Number(line.slice(3, 7)) || 0,
        sequence: Number(line.slice(8, 13)) || 0,
        barcode: "",
        supplierName: line.slice(43, 73).trim(),
        dueDate: null,
        nominalAmount: cnabToAmount(line.slice(119, 134)),
        paymentDate: cnabDateToIso(line.slice(93, 101)),
        paymentAmount: cnabToAmount(line.slice(119, 134)),
        companyReference: line.slice(73, 93).trim(),
        bankReference: line.slice(134, 154).trim(),
        occurrenceCodes: codes,
        status: returnStatus(codes),
      });
      return;
    }
    if (line[13] !== "J" || line.slice(17, 19) === "52") return;
    const codes = occurrenceCodes(line.slice(230, 240));
    titles.push({
      lineNumber: index + 1,
      lotNumber: Number(line.slice(3, 7)) || 0,
      sequence: Number(line.slice(8, 13)) || 0,
      barcode: line.slice(17, 61).trim(),
      supplierName: line.slice(61, 91).trim(),
      dueDate: cnabDateToIso(line.slice(91, 99)),
      nominalAmount: cnabToAmount(line.slice(99, 114)),
      paymentDate: cnabDateToIso(line.slice(144, 152)),
      paymentAmount: cnabToAmount(line.slice(152, 167)),
      companyReference: line.slice(182, 202).trim(),
      bankReference: line.slice(202, 222).trim(),
      occurrenceCodes: codes,
      status: returnStatus(codes),
    });
  });

  return {
    bankCode: header.slice(0, 3),
    fileSequence: Number(header.slice(157, 163)) || 0,
    generatedDate: cnabDateToIso(header.slice(143, 151)),
    titles,
    recordCount: lines.length,
  };
}
