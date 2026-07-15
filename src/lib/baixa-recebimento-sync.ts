import { supabase } from "@/integrations/supabase/client";
import { sapAction } from "@/lib/sap-client";
import type { ErpSession } from "@/contexts/SapContext";

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
}

export async function syncBaixaRecebimentoToSap(
  session: SapSession,
  baixaId: string,
): Promise<SyncBaixaResult> {
  // 1) Carrega baixa + itens do Supabase
  const { data: baixa, error: baixaErr } = await supabase
    .from("baixas_recebimento")
    .select("*")
    .eq("id", baixaId)
    .single();

  if (baixaErr || !baixa) {
    return { ok: false, sapDocEntry: null, errorMessage: baixaErr?.message || "Baixa não encontrada" };
  }

  if (baixa.status === "sincronizado" && baixa.sap_incoming_payment_doc_entry) {
    return {
      ok: true,
      sapDocEntry: baixa.sap_incoming_payment_doc_entry,
      errorMessage: null,
    };
  }

  const { data: itens, error: itensErr } = await supabase
    .from("baixas_recebimento_itens")
    .select("invoice_doc_entry,valor_baixado")
    .eq("baixa_id", baixaId);

  if (itensErr || !itens || itens.length === 0) {
    const msg = itensErr?.message || "Baixa sem itens";
    await supabase
      .from("baixas_recebimento")
      .update({ status: "erro", sap_error_message: msg })
      .eq("id", baixaId);
    return { ok: false, sapDocEntry: null, errorMessage: msg };
  }

  const excedente = Number(baixa.valor_juros_multa || 0);

  const payload: Record<string, unknown> = {
    DocType: "rCustomer",
    CardCode: baixa.card_code,
    DocDate: baixa.data_recebimento,
    TransferDate: baixa.data_recebimento,
    TransferAccount: baixa.conta_contabil_codigo,
    TransferSum: Number(baixa.valor_total),
    PaymentInvoices: itens.map((it) => ({
      DocEntry: Number(it.invoice_doc_entry),
      SumApplied: Number(it.valor_baixado),
      InvoiceType: "it_Invoice",
    })),
  };

  if (excedente > 0 && baixa.conta_juros_multa_codigo) {
    payload.PaymentAccounts = [
      {
        AccountCode: baixa.conta_juros_multa_codigo,
        SumPaid: excedente,
      },
    ];
  }

  try {
    const result = await sapAction(session, "IncomingPayments", "POST", payload);
    const data = result?.data as { DocEntry?: number; error?: unknown } | undefined;
    if (data && typeof data === "object" && data.error) {
      throw new Error(typeof data.error === "string" ? data.error : "SAP retornou erro");
    }
    const sapDocEntry =
      data && typeof data.DocEntry === "number" ? data.DocEntry : null;

    await supabase
      .from("baixas_recebimento")
      .update({
        status: "sincronizado",
        sap_incoming_payment_doc_entry: sapDocEntry,
        sap_error_message: null,
      })
      .eq("id", baixaId);

    return { ok: true, sapDocEntry, errorMessage: null };
  } catch (e) {
    const msg = (e as Error).message || "Falha ao criar IncomingPayment no SAP";
    await supabase
      .from("baixas_recebimento")
      .update({ status: "erro", sap_error_message: msg })
      .eq("id", baixaId);
    return { ok: false, sapDocEntry: null, errorMessage: msg };
  }
}
