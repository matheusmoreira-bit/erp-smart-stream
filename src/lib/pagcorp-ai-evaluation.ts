import type { PagCorpTransaction } from "@/hooks/usePagCorp";
import { isPagCorpAiEligible } from "@/lib/pagcorp-document-classification";

export type AiCheckStatus = "ok" | "warning" | "error" | "idle";

export interface AiCheck {
  key: "fiscal_document" | "amount_match";
  /** Nome curto exibido no tooltip. */
  title: string;
  /** Explicação do que foi avaliado e do resultado. */
  detail: string;
  status: AiCheckStatus;
}

function money(value: number, currency?: string | null): string {
  const code = currency && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : "BRL";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(value);
  } catch {
    return `${code} ${value.toFixed(2)}`;
  }
}

/** Tolerância: 0,5% do valor ou R$ 0,02 (o que for maior). */
export function amountsMatch(a: number, b: number): boolean {
  const tolerance = Math.max(0.02, Math.max(Math.abs(a), Math.abs(b)) * 0.005);
  return Math.abs(a - b) <= tolerance;
}

export function evaluatePagCorpAi(t: PagCorpTransaction): AiCheck[] {
  const eligible = isPagCorpAiEligible(t);
  const status = t.documentAnalysisStatus;
  const hasAttachments =
    (Array.isArray(t.receipts) ? t.receipts.length : 0) +
      (Array.isArray(t.attachments) ? t.attachments.length : 0) > 0;

  // --- 1) Documento fiscal ---
  let fiscal: AiCheck;
  if (!eligible || !status || status === "pending") {
    fiscal = {
      key: "fiscal_document",
      title: "Documento fiscal",
      detail: !hasAttachments
        ? "Análise não realizada — a transação ainda não tem comprovantes anexados."
        : "Análise de documento fiscal ainda não realizada para esta transação.",
      status: "idle",
    };
  } else if (status === "processing") {
    fiscal = {
      key: "fiscal_document",
      title: "Documento fiscal",
      detail: "Em processamento — a IA está lendo os comprovantes anexados.",
      status: "warning",
    };
  } else if (status === "error") {
    fiscal = {
      key: "fiscal_document",
      title: "Documento fiscal",
      detail: `Erro na leitura dos documentos${t.documentAnalysisError ? `: ${t.documentAnalysisError}` : "."}`,
      status: "error",
    };
  } else if (t.hasFiscalDocument === true) {
    const origem = t.documentsInternational === true ? "internacional" : "nacional";
    fiscal = {
      key: "fiscal_document",
      title: "Documento fiscal",
      detail: `Documento fiscal ${origem} identificado nos comprovantes${
        t.documentKinds?.length ? ` (${t.documentKinds.join(", ")})` : ""
      }.`,
      status: "ok",
    };
  } else {
    fiscal = {
      key: "fiscal_document",
      title: "Documento fiscal",
      detail: hasAttachments
        ? "Apenas comprovantes — nenhuma nota fiscal ou invoice identificada nos anexos."
        : "Sem comprovantes anexados, portanto sem documento fiscal.",
      status: "warning",
    };
  }

  // --- 2) Valor da prestação x soma dos comprovantes ---
  let amount: AiCheck;
  if (!eligible || !status || status === "pending") {
    amount = {
      key: "amount_match",
      title: "Valor dos comprovantes",
      detail: "Conferência de valores ainda não realizada.",
      status: "idle",
    };
  } else if (status === "processing") {
    amount = {
      key: "amount_match",
      title: "Valor dos comprovantes",
      detail: "Em processamento — somando os valores dos comprovantes.",
      status: "warning",
    };
  } else if (status === "error") {
    amount = {
      key: "amount_match",
      title: "Valor dos comprovantes",
      detail: "Erro na leitura — não foi possível somar os valores dos comprovantes.",
      status: "error",
    };
  } else if (t.documentsCount == null && t.documentsTotal == null) {
    amount = {
      key: "amount_match",
      title: "Valor dos comprovantes",
      detail: "Conferência de valores não realizada nesta leitura — reprocesse a IA para comparar os valores.",
      status: "idle",
    };
  } else if (typeof t.documentsTotal !== "number" || !Number.isFinite(t.documentsTotal) || t.documentsTotal <= 0) {
    amount = {
      key: "amount_match",
      title: "Valor dos comprovantes",
      detail: "Dados não disponíveis — a IA não conseguiu ler o valor nos comprovantes.",
      status: "error",
    };
  } else {
    const docCurrency = (t.documentsCurrency || t.currency || "BRL").toUpperCase();
    const txCurrency = (t.currency || "BRL").toUpperCase();
    const docs = money(t.documentsTotal, docCurrency);
    const tx = money(t.amount, txCurrency);
    if (docCurrency !== txCurrency) {
      amount = {
        key: "amount_match",
        title: "Valor dos comprovantes",
        detail: `Atenção: comprovantes em ${docCurrency} (${docs}) e transação em ${txCurrency} (${tx}) — conferir conversão.`,
        status: "warning",
      };
    } else if (amountsMatch(t.documentsTotal, t.amount)) {
      amount = {
        key: "amount_match",
        title: "Valor dos comprovantes",
        detail: `Valores conferem: soma dos comprovantes ${docs} = valor da transação ${tx}.`,
        status: "ok",
      };
    } else {
      const diff = money(Math.abs(t.documentsTotal - t.amount), txCurrency);
      amount = {
        key: "amount_match",
        title: "Valor dos comprovantes",
        detail: `Divergência: soma dos comprovantes ${docs} contra ${tx} da transação (diferença ${diff}).`,
        status: "error",
      };
    }
  }

  return [fiscal, amount];
}
