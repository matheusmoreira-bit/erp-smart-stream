import type { SapSession } from "@/lib/sap-client";
import { sapFunctionFetch } from "@/lib/auth-fetch";

/**
 * Sincroniza uma baixa de recebimento (baixas_recebimento + itens) com o SAP B1
 * criando um IncomingPayment via sap-b1-proxy. Reaproveitado tanto na criação
 * inicial quanto no retry a partir da tela de histórico.
 *
 * Estados possíveis ao final:
 *  - "sincronizado": SAP aceitou, doc_entry salvo em sap_incoming_payment_doc_entry
 *  - "erro": SAP recusou, mensagem em sap_error_message
 */
export interface SyncBaixaResult {
  ok: boolean;
  sapDocEntry: number | null;
  errorMessage: string | null;
  baixaId?: string | null;
}

export interface CreateBaixaInput {
  companyDb: string;
  cardCode: string;
  cardName: string;
  dataRecebimento: string;
  contaContabilCodigo: string;
  contaContabilNome?: string | null;
  contaJurosMultaCodigo?: string | null;
  contaJurosMultaNome?: string | null;
  valorTotal: number;
  valorJurosMulta: number;
  itens: Array<{
    invoiceDocEntry: number;
    invoiceDocNum: string | number;
    valorBaixado: number;
    /** 'invoice' (padrão) ou 'journal_entry' (Saldo Inicial). */
    invoiceType?: "invoice" | "journal_entry";
    /** Linha do JournalEntry — obrigatório quando invoiceType='journal_entry'. */
    invoiceDocLine?: number | null;
  }>;
}

async function callBaixaFunction(body: Record<string, unknown>): Promise<SyncBaixaResult> {
  try {
    const response = await sapFunctionFetch("baixa-recebimento", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    const sapDocEntry = Number.isFinite(Number(data.sapDocEntry)) ? Number(data.sapDocEntry) : null;
    const errorMessage = data.errorMessage || data.error || null;

    if (!response.ok || !data.ok) {
      return { ok: false, sapDocEntry, errorMessage: errorMessage || `Falha ao lançar baixa (${response.status})`, baixaId: data.baixaId || null };
    }

    return { ok: true, sapDocEntry, errorMessage: null, baixaId: data.baixaId || null };
  } catch (e) {
    const msg = (e as Error).message || "Falha ao criar IncomingPayment no SAP";
    return { ok: false, sapDocEntry: null, errorMessage: msg };
  }
}

async function ensureServiceLayerSession(session: SapSession): Promise<boolean> {
  if (session?.sessionId) return true;
  const { resolveSapSession } = await import("@/lib/sap-session-broker");
  const resolved = await resolveSapSession(session?.companyDB || "", true);
  return !!resolved?.sessionId;
}

export async function createBaixaRecebimentoAndSync(
  session: SapSession,
  input: CreateBaixaInput,
): Promise<SyncBaixaResult> {
  if (!(await ensureServiceLayerSession(session))) {
    return { ok: false, sapDocEntry: null, errorMessage: "Sessão SAP indisponível." };
  }
  return callBaixaFunction({ action: "createAndSync", input });
}

export async function syncBaixaRecebimentoToSap(
  session: SapSession,
  baixaId: string,
): Promise<SyncBaixaResult> {
  if (!(await ensureServiceLayerSession(session))) {
    return { ok: false, sapDocEntry: null, errorMessage: "Sessão SAP indisponível.", baixaId };
  }
  return callBaixaFunction({ action: "syncExisting", baixaId });
}

