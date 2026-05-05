// Friendly translator for SAP B1 Service Layer error messages.
// Input is typically the raw thrown message from sap-b1-proxy, e.g.:
//   SAP BusinessPartners failed [400]: {"error":{"code":"-8112","message":"Value too long in property 'State' of 'BPAddress'"}}

const FIELD_LABELS: Record<string, { label: string; hint: string }> = {
  State: {
    label: "Estado/UF",
    hint: "O SAP aceita no máximo 3 caracteres. Use a sigla (ex.: SP, RJ) ou deixe em branco para endereços internacionais.",
  },
  ZipCode: {
    label: "CEP / ZIP",
    hint: "Verifique o formato; o SAP limita a 20 caracteres.",
  },
  City: {
    label: "Cidade",
    hint: "Reduza o nome da cidade (limite ~100 caracteres).",
  },
  Street: {
    label: "Endereço (rua)",
    hint: "Reduza o texto da rua (limite ~100 caracteres).",
  },
  Block: {
    label: "Bairro",
    hint: "Reduza o nome do bairro (limite ~100 caracteres).",
  },
  BuildingFloorRoom: {
    label: "Complemento (número/andar)",
    hint: "Reduza o complemento (limite ~100 caracteres).",
  },
  Country: {
    label: "País",
    hint: "Use o código ISO de 2 letras (ex.: BR, US, IE).",
  },
  CardName: {
    label: "Nome do fornecedor",
    hint: "Reduza o nome (limite 100 caracteres no SAP).",
  },
  FederalTaxID: {
    label: "CNPJ/CPF/Tax ID",
    hint: "Verifique o formato; pode estar duplicado ou exceder o tamanho permitido.",
  },
  EmailAddress: {
    label: "E-mail",
    hint: "Verifique o e-mail (limite 100 caracteres).",
  },
  Phone1: { label: "Telefone 1", hint: "Reduza o telefone (limite 20 caracteres)." },
  Phone2: { label: "Telefone 2", hint: "Reduza o telefone (limite 20 caracteres)." },
};

export interface ParsedSapError {
  /** Headline shown as toast title */
  title: string;
  /** Long description shown as toast description */
  description: string;
  /** SAP-side field name when identified (e.g. "State") */
  field?: string;
  /** Original raw message for debugging */
  raw: string;
}

export function parseSapError(input: unknown): ParsedSapError {
  const raw = input instanceof Error ? input.message : typeof input === "string" ? input : String(input);

  // Try to pull the JSON payload after the first ":" or "{"
  let sapMessage: string | null = null;
  let sapCode: string | null = null;
  const jsonStart = raw.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart));
      sapMessage = parsed?.error?.message ?? null;
      sapCode = parsed?.error?.code ?? null;
    } catch {
      // ignore
    }
  }

  const message = sapMessage || raw;

  // Pattern: "Value too long in property 'X' of 'Y'"
  const tooLong = /Value too long in property '([^']+)'(?: of '([^']+)')?/i.exec(message);
  if (tooLong) {
    const field = tooLong[1];
    const owner = tooLong[2];
    const meta = FIELD_LABELS[field];
    if (meta) {
      return {
        title: `Campo "${meta.label}" muito longo para o SAP`,
        description: meta.hint,
        field,
        raw,
      };
    }
    return {
      title: `Campo "${field}" muito longo para o SAP`,
      description: owner ? `Reduza o valor de "${field}" em ${owner}.` : `Reduza o valor de "${field}".`,
      field,
      raw,
    };
  }

  // Pattern: "Invalid BP code [OPOR.CardCode] , 'F001583'"
  const invalidBp = /Invalid BP code\s*\[?[^\]]*\]?\s*,?\s*'?([^']+)'?/i.exec(message);
  if (invalidBp) {
    return {
      title: "Fornecedor não encontrado no SAP",
      description: `Código ${invalidBp[1]} não existe. Cadastre o fornecedor no SAP antes de continuar.`,
      field: "CardCode",
      raw,
    };
  }

  // Pattern: duplicated / unique key
  if (/duplicate|already exists|unique/i.test(message)) {
    return {
      title: "Registro duplicado no SAP",
      description: message,
      raw,
    };
  }

  // Generic property mention: "property 'X'"
  const generic = /property '([^']+)'/i.exec(message);
  if (generic) {
    const field = generic[1];
    const meta = FIELD_LABELS[field];
    return {
      title: meta ? `Problema no campo "${meta.label}"` : `Problema no campo "${field}"`,
      description: meta?.hint || message,
      field,
      raw,
    };
  }

  return {
    title: "Erro ao salvar no SAP",
    description: sapCode ? `[${sapCode}] ${message}` : message,
    raw,
  };
}
