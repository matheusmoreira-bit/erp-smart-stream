import { publicFunctionFetch, sapFunctionFetch } from "@/lib/auth-fetch";
import type { PagCorpTransaction } from "@/hooks/usePagCorp";

export interface PagCorpAttachment {
  name: string;
  url: string;
}

export interface PagCorpDocumentClassification {
  status: "pending" | "processing" | "completed" | "error";
  hasFiscalDocument: boolean | null;
  documentKinds: string[];
  confidence: number | null;
  errorMessage?: string;
}

export function isPagCorpAiEligible(
  transaction: Pick<PagCorpTransaction, "accountabilityApproved" | "integrated" | "integrationStatusResolved" | "isReversed">,
): boolean {
  return transaction.integrationStatusResolved === true &&
    transaction.accountabilityApproved === true &&
    transaction.integrated !== true &&
    transaction.isReversed !== true;
}

export function hasInvoiceEquivalent(documents: unknown[]): boolean {
  const invoiceKinds = new Set([
    "invoice",
    "commercial_invoice",
    "nota_fiscal",
    "nfe",
    "nfse",
    "nfce",
    "cupom_fiscal",
  ]);
  return documents.some((value) => {
    const document = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return document.is_invoice_equivalent === true ||
      (document.is_invoice_equivalent == null && invoiceKinds.has(String(document.document_kind || "").toLowerCase()));
  });
}

export function collectPagCorpAttachments(transaction: Pick<PagCorpTransaction, "receipts" | "attachments">): PagCorpAttachment[] {
  const out: PagCorpAttachment[] = [];
  const seen = new Set<string>();
  const push = (rawUrl: unknown, rawName?: unknown) => {
    if (typeof rawUrl !== "string") return;
    const url = rawUrl.trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({
      url,
      name: typeof rawName === "string" && rawName.trim()
        ? rawName.trim()
        : url.split("/").pop()?.split("?")[0] || "documento",
    });
  };
  const visit = (value: unknown) => {
    const entry = value && typeof value === "object" ? value as Record<string, unknown> : null;
    if (!entry || typeof entry !== "object") return;
    push(entry.downloadUrl, entry.fileName || entry.name);
    push(entry.fileUrl, entry.fileName || entry.name);
    push(entry.receiptUrl, entry.fileName || entry.name);
    push(entry.imageUrl, entry.fileName || entry.name);
    push(entry.url, entry.fileName || entry.name);
    if (entry.file && typeof entry.file === "object") visit(entry.file);
    if (Array.isArray(entry.files)) entry.files.forEach(visit);
    if (Array.isArray(entry.attachments)) entry.attachments.forEach(visit);
  };
  (transaction.receipts || []).forEach(visit);
  (transaction.attachments || []).forEach(visit);
  return out;
}

async function persist(
  companyDb: string,
  expenseId: string | number,
  classification: object,
): Promise<{ blocked: boolean }> {
  const response = await sapFunctionFetch("pagcorp-integration-status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyDb, classification: { expenseId, ...classification } }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(payload.error || payload.warning || `Falha ao salvar classificação (${response.status})`));
  }
  if (payload.classificationBlocked) return { blocked: true };
  if (payload.classificationStoreUnavailable) {
    throw new Error(String(payload.warning || "Armazenamento da classificação IA indisponível"));
  }
  return { blocked: false };
}

async function readPersisted(
  companyDb: string,
  expenseId: string | number,
): Promise<PagCorpDocumentClassification | null> {
  try {
    const response = await sapFunctionFetch("pagcorp-integration-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyDb, expenseIds: [expenseId] }),
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => ({})) as { classifications?: unknown[] };
    const row = Array.isArray(payload.classifications)
      ? payload.classifications
        .map((item) => item && typeof item === "object" ? item as Record<string, unknown> : {})
        .find((item) => Number(item.pagcorp_expense_id) === Number(expenseId))
      : null;
    if (!row || !["processing", "completed", "error"].includes(String(row.status))) return null;
    return {
      status: String(row.status) as PagCorpDocumentClassification["status"],
      hasFiscalDocument: row.has_fiscal_document == null ? null : row.has_fiscal_document === true,
      documentKinds: Array.isArray(row.document_kinds) ? row.document_kinds.map((kind) => String(kind)) : [],
      confidence: row.confidence == null ? null : Number(row.confidence),
      errorMessage: row.error_message == null ? undefined : String(row.error_message),
    };
  } catch {
    return null;
  }
}

export async function classifyPagCorpDocuments(
  transaction: PagCorpTransaction,
  companyDb: string,
  options: { force?: boolean } = {},
): Promise<PagCorpDocumentClassification> {
  if (!isPagCorpAiEligible(transaction)) {
    return {
      status: "pending",
      hasFiscalDocument: null,
      documentKinds: [],
      confidence: null,
    };
  }

  // Sempre lemos o que já existe: sem `force` serve de cache; com `force`
  // serve de rede de proteção — se o reprocessamento falhar, restauramos a
  // classificação anterior em vez de perdê-la.
  const persisted = await readPersisted(companyDb, transaction.id);
  if (!options.force && persisted) return persisted;
  const previousCompleted = persisted?.status === "completed" ? persisted : null;


  const attachments = collectPagCorpAttachments(transaction);
  try {
    if (attachments.length === 0) {
      const result: PagCorpDocumentClassification = {
        status: "completed",
        hasFiscalDocument: false,
        documentKinds: [],
        confidence: 1,
      };
      await persist(companyDb, transaction.id, result);
      return result;
    }

    const claim = await persist(companyDb, transaction.id, {
      status: "processing",
      accountabilityApproved: true,
      requireUnintegrated: true,
    });
    if (claim.blocked) {
      return {
        status: "pending",
        hasFiscalDocument: null,
        documentKinds: [],
        confidence: null,
      };
    }
    const files: File[] = [];
    for (const attachment of attachments.slice(0, 8)) {
      const params = new URLSearchParams({ action: "receipt", url: attachment.url, companyDb });
      const response = await sapFunctionFetch(`pagcorp-proxy?${params.toString()}`);
      if (!response.ok) continue;
      const blob = await response.blob();
      files.push(new File([blob], attachment.name, { type: blob.type || "application/octet-stream" }));
    }
    if (files.length === 0) throw new Error("Não foi possível baixar os anexos para análise");

    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    formData.append("company_db", companyDb);
    formData.append("cache_scope", "pagcorp");
    formData.append("pagcorp_expense_id", String(transaction.id));
    const response = await publicFunctionFetch("process-expense-doc", {
      method: "POST",
      body: formData,
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(String(payload.error || `IA retornou HTTP ${response.status}`));
    const docs: unknown[] = (Array.isArray(payload.result) ? payload.result : [payload.result]).filter(Boolean);
    if (docs.length === 0) throw new Error("IA não retornou classificação dos anexos");

    const hasFiscalDocument = hasInvoiceEquivalent(docs);
    const documentKinds: string[] = Array.from(
      new Set<string>(docs.map((value) => {
        const document = value && typeof value === "object" ? value as Record<string, unknown> : {};
        return String(document.document_kind || "outro");
      })),
    );
    const confidenceValues = docs
      .map((value) => {
        const document = value && typeof value === "object" ? value as Record<string, unknown> : {};
        return Number(document.confidence);
      })
      .filter((value): value is number => Number.isFinite(value));
    const confidence = confidenceValues.length > 0 ? Math.max(...confidenceValues) : null;
    const result: PagCorpDocumentClassification = {
      status: "completed",
      hasFiscalDocument,
      documentKinds,
      confidence,
    };
    await persist(companyDb, transaction.id, result);
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (previousCompleted) {
      // Reprocessamento falhou: mantém (e regrava) o resultado anterior válido.
      const restored: PagCorpDocumentClassification = {
        ...previousCompleted,
        errorMessage: `Reprocessamento falhou (${errorMessage}). Mantida a leitura anterior.`,
      };
      await persist(companyDb, transaction.id, {
        status: "completed",
        hasFiscalDocument: previousCompleted.hasFiscalDocument,
        documentKinds: previousCompleted.documentKinds,
        confidence: previousCompleted.confidence,
        errorMessage: restored.errorMessage,
      }).catch(() => undefined);
      return restored;
    }
    const result: PagCorpDocumentClassification = {
      status: "error",
      hasFiscalDocument: null,
      documentKinds: [],
      confidence: null,
      errorMessage,
    };
    await persist(companyDb, transaction.id, result).catch(() => undefined);
    return result;
  }
}

