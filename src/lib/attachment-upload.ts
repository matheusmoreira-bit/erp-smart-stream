import { sapFunctionFetch } from "@/lib/auth-fetch";

export interface UploadedAttachment {
  file_path: string;
  file_name: string;
  file_size: number;
  mime_type: string;
}

/** Erros que não adianta repetir (validação/permissão/limite). */
const NON_RETRYABLE = new Set([400, 401, 403, 404, 413]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Envia um anexo para o gateway `expense-attachment-storage` com retentativa
 * automática em falhas transitórias (rede instável, 5xx, timeout do gateway).
 * Uploads eram perdidos silenciosamente quando a rede oscilava durante o
 * processamento da IA, gerando pedidos de compra sem anexo.
 */
export async function uploadExpenseAttachment(
  target: { expenseId?: string; advanceId?: string },
  file: File,
  attempts = 3,
): Promise<UploadedAttachment> {
  let lastError: Error = new Error("Falha desconhecida no upload");

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const fd = new FormData();
      if (target.expenseId) fd.append("expense_id", target.expenseId);
      if (target.advanceId) fd.append("advance_id", target.advanceId);
      fd.append("file", file, file.name);

      const res = await sapFunctionFetch("expense-attachment-storage", { method: "POST", body: fd });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        const err = new Error(data?.error || `upload retornou ${res.status}`);
        if (NON_RETRYABLE.has(res.status)) throw err;
        lastError = err;
      } else {
        return {
          file_path: data.file_path as string,
          file_name: data.file_name as string,
          file_size: data.file_size as number,
          mime_type: data.mime_type as string,
        };
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      // Erro lançado explicitamente como não-retentável acima.
      if (/\b(400|401|403|404|413)\b/.test(e.message) && attempt > 1) throw e;
      lastError = e;
    }

    if (attempt < attempts) await sleep(600 * attempt);
  }

  throw lastError;
}
