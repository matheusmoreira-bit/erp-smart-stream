import type { NfEntradaImport } from "@/hooks/useNfEntrada";

/**
 * Estágios assertivos do fluxo Master Tax → ERP Flow → SAP.
 * O estágio é DERIVADO dos fatos do documento (pedido vinculado, esboço,
 * NF lançada) e não apenas do enum bruto — assim o rótulo nunca contradiz
 * o que já aconteceu no ERP.
 */
export type NfStage =
  | "cancelada"
  | "erro"
  | "recusada"
  | "nf_lancada"
  | "esboco_nf"
  | "pc_no_sap"
  | "pedido_erpflow"
  | "sem_pedido";

export type StageVariant = "default" | "secondary" | "destructive" | "outline";

export interface StagePresentation {
  stage: NfStage;
  label: string;
  variant: StageVariant;
  hint: string;
  /** Próxima ação esperada, em linguagem direta. */
  next: string;
}

const STAGE_META: Record<NfStage, { label: string; variant: StageVariant; next: string }> = {
  cancelada: { label: "Cancelada", variant: "outline", next: "Nenhuma ação — fluxo encerrado manualmente." },
  erro: { label: "Erro de integração", variant: "destructive", next: "Corrija os dados e use “Tentar integração novamente”." },
  recusada: { label: "Recusada", variant: "destructive", next: "Veja o histórico para o motivo e reprocesse." },
  nf_lancada: { label: "NF lançada no SAP", variant: "default", next: "Fluxo concluído." },
  esboco_nf: { label: "Esboço de NF no SAP", variant: "secondary", next: "Fiscal precisa conferir e efetivar o esboço no SAP." },
  pc_no_sap: { label: "PC no SAP · sem NF de entrada", variant: "secondary", next: "Lançar o esboço de NF de entrada contra o pedido." },
  pedido_erpflow: { label: "Pedido em andamento no ERP Flow", variant: "secondary", next: "Concluir aprovação/integração do pedido no ERP Flow." },
  sem_pedido: { label: "Sem pedido vinculado", variant: "outline", next: "Criar o pedido de compra ou vincular a um PC existente." },
};

/** Lista para o filtro de status da tela, na ordem do fluxo. */
export const STAGE_OPTIONS: Array<{ value: NfStage; label: string }> = (
  ["sem_pedido", "pedido_erpflow", "pc_no_sap", "esboco_nf", "nf_lancada", "recusada", "erro", "cancelada"] as NfStage[]
).map((s) => ({ value: s, label: STAGE_META[s].label }));

/**
 * Número do pedido de compra como o usuário vê no SAP (DocNum).
 * O DocEntry é apenas a chave interna e NÃO deve ser exibido como "PC".
 */
export function poDocNumber(it: NfEntradaImport): string | null {
  return it.sap_matched_po_doc_num ?? null;
}

/** Rótulo pronto: "PC #8031" / "esboço #123" (com o DocEntry só como apoio). */
export function poLabel(it: NfEntradaImport): string | null {
  if (!it.sap_matched_po_doc_entry) return null;
  const kind = it.sap_matched_po_is_draft ? "esboço" : "PC";
  const num = poDocNumber(it);
  return num ? `${kind} #${num}` : `${kind} (interno ${it.sap_matched_po_doc_entry})`;
}

/** Número da NF de entrada lançada no SAP, preferindo o DocNum. */
export function nfDocLabel(it: NfEntradaImport): string | null {
  if (!it.erp_invoice_doc_entry && !it.erp_invoice_doc_num) return null;
  return it.erp_invoice_doc_num ? `#${it.erp_invoice_doc_num}` : `interno ${it.erp_invoice_doc_entry}`;
}

export function nfStage(it: NfEntradaImport): NfStage {
  if (it.status === "cancelled") return "cancelada";
  if (it.erp_invoice_posted || it.status === "completed") return "nf_lancada";
  if (it.sap_invoice_draft_id) return "esboco_nf";
  if (it.status === "integration_error") return "erro";
  if (it.status === "erpflow_rejected" || it.status === "sap_rejected") return "recusada";
  if (it.sap_matched_po_doc_entry && it.sap_matched_po_is_draft !== true) return "pc_no_sap";
  if (it.sap_matched_po_doc_entry || it.expense_id) return "pedido_erpflow";
  return "sem_pedido";
}

export function nfStagePresentation(it: NfEntradaImport): StagePresentation {
  const stage = nfStage(it);
  const meta = STAGE_META[stage];
  let hint = "";
  switch (stage) {
    case "nf_lancada":
      hint = nfDocLabel(it)
        ? `NF de entrada ${nfDocLabel(it)} registrada no SAP.`
        : "NF de entrada registrada no SAP.";
      break;
    case "esboco_nf":
      hint = `Esboço ${it.sap_invoice_draft_id} criado no SAP, aguardando conferência do fiscal.`;
      break;
    case "pc_no_sap":
      hint = `Pedido ${poLabel(it)} existe no SAP; falta lançar a NF de entrada contra ele.`;
      break;
    case "pedido_erpflow":
      hint = it.sap_matched_po_is_draft
        ? `Pedido em esboço no SAP (${poLabel(it)}), ainda não efetivado.`
        : "Existe pedido de compra no ERP Flow que ainda não foi integrado ao SAP.";
      break;
    case "recusada":
      hint = it.rejection_reason || it.last_error || "Documento recusado no fluxo.";
      break;
    case "erro":
      hint = it.last_error || "A integração falhou.";
      break;
    case "cancelada":
      hint = "O fluxo desta NF foi cancelado manualmente.";
      break;
    default:
      hint = "NF capturada no Master Tax, ainda sem pedido de compra correspondente.";
  }
  return { stage, label: meta.label, variant: meta.variant, hint, next: meta.next };
}
