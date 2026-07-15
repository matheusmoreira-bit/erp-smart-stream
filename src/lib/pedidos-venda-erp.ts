import { supabase } from "@/integrations/supabase/client";

/**
 * Registra um pedido/NF de venda criado através do ERP Flow na tabela
 * `pedidos_venda_erp`, que é usada pela tela de Vendas para pintar o badge
 * "ERP Flow" ao lado do documento. Idempotente por `(company_db, doc_entry)`.
 *
 * Chame este helper SEMPRE que uma Sales Order / Invoice for criada no SAP
 * a partir do ERP Flow (por exemplo, no modal "Novo Pedido de Venda").
 */
export interface RegisterPedidoVendaErpInput {
  companyDb: string;
  docEntry: number;
  docNum?: number | null;
  cardCode?: string | null;
  docType?: "Orders" | "Invoices" | string | null;
}

export async function registerPedidoVendaErp(input: RegisterPedidoVendaErpInput): Promise<{
  ok: boolean;
  error?: string;
}> {
  if (!input.companyDb || !Number.isFinite(input.docEntry)) {
    return { ok: false, error: "companyDb e docEntry são obrigatórios" };
  }

  const { data: userData } = await supabase.auth.getUser();
  const criadoPor = userData?.user?.id;

  const { error } = await supabase.from("pedidos_venda_erp").upsert(
    {
      company_db: input.companyDb,
      doc_entry: input.docEntry,
      doc_num: input.docNum ?? null,
      card_code: input.cardCode ?? null,
      criado_por: criadoPor,
    },
    { onConflict: "company_db,doc_entry" },
  );

  if (error) {
    console.warn("registerPedidoVendaErp falhou:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
