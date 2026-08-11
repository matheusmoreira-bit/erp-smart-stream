import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Fila de escrita no ERP do módulo de NF de Entrada.
 *
 * A UI nunca escreve direto no ERP: ela registra a INTENÇÃO (enqueue) e
 * acompanha o estado (pending → processing → synced | error). Isso dá
 * idempotência, retentativa e histórico sem travar a tela.
 */

export type QueueStatus = "pending" | "processing" | "synced" | "error";

export interface NfEntradaQueueItem {
  id: string;
  import_id: string;
  company_db: string;
  erp_type: string;
  operation: string;
  status: QueueStatus;
  attempts: number;
  erp_document_id: string | null;
  erp_document_type: string | null;
  error_message: string | null;
  requested_by: string | null;
  processed_at: string | null;
  created_at: string;
}

export interface PreviewLinhaPedido {
  line_num: number;
  item_code: string | null;
  descricao: string | null;
  centro_custo: string | null;
  projeto: string | null;
  quantidade: number | null;
  valor_unitario: number | null;
  valor_total: number | null;
}

export interface NfEntradaPreview {
  ok: boolean;
  erp_type: string;
  nota: {
    id: string;
    numero: string | null;
    chave: string;
    fornecedor: string | null;
    cnpj: string | null;
    valor_total: number | null;
    data_emissao: string | null;
    itens: Array<{
      descricao?: string | null;
      codigo?: string | null;
      quantidade?: number | null;
      valor_unitario?: number | null;
      valor_total?: number | null;
    }>;
  };
  pedido: {
    id: string;
    numero: string | null;
    fornecedor_id: string | null;
    fornecedor_nome: string | null;
    valor_total: number | null;
    linhas: PreviewLinhaPedido[];
  };
  ja_lancada: { id: string; numero: string | null } | null;
  divergencia: {
    valor_nota: number;
    valor_pedido: number;
    diferenca: number;
    percentual: number;
    bloqueante: boolean;
    linhas_diferentes: boolean;
    override_aplicado: boolean;
    override_motivo: string | null;
  };
}

async function callQueue<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("nf-entrada-erp-queue", { body });
  const detail = (data as { error?: string } | null)?.error;
  if (error) throw new Error(detail || error.message);
  if (detail) throw new Error(detail);
  return data as T;
}

export function useNfEntradaQueue(importIds?: string[]) {
  const [queue, setQueue] = useState<NfEntradaQueueItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshQueue = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("nf_entrada_write_queue")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);
    if (importIds?.length) q = q.in("import_id", importIds);
    const { data } = await q;
    setQueue((data || []) as NfEntradaQueueItem[]);
    setLoading(false);
  }, [importIds?.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { refreshQueue(); }, [refreshQueue]);

  /** Monta o de-para nota x pedido para conferência antes de qualquer escrita. */
  const preview = useCallback(
    (importId: string) => callQueue<NfEntradaPreview>({ action: "preview", import_id: importId }),
    [],
  );

  const enqueue = useCallback(async (args: {
    importIds: string[];
    operation?: "invoice_draft" | "purchase_order";
    payload?: Record<string, unknown>;
    overrideReason?: string;
  }) => {
    const res = await callQueue<{
      results: Array<{ import_id: string; queued: boolean; queue_id?: string; reason?: string }>;
    }>({
      action: "enqueue",
      import_ids: args.importIds,
      operation: args.operation || "invoice_draft",
      payload: args.payload ?? {},
      override_reason: args.overrideReason,
    });
    await refreshQueue();
    return res.results;
  }, [refreshQueue]);

  /** Dispara o processamento da fila (o cron também roda periodicamente). */
  const processQueue = useCallback(async (queueId?: string) => {
    const res = await callQueue<{
      processed: Array<{ id: string; status: string; document_id?: string; error?: string }>;
    }>({ action: "process", queue_id: queueId });
    await refreshQueue();
    return res.processed;
  }, [refreshQueue]);

  /** Pergunta ao ERP se o PC vinculado já tem NF de Entrada lançada. */
  const recheckErp = useCallback(async (importIds: string[]) => {
    const res = await callQueue<{
      results: Array<{ id: string; posted: boolean; doc?: string | null; error?: string }>;
    }>({ action: "recheck", import_ids: importIds });
    return res.results;
  }, []);

  return { queue, loading, refreshQueue, preview, enqueue, processQueue, recheckErp };
}

/** Estado mais recente da fila por nota, para exibir na listagem. */
export function queueStateByImport(queue: NfEntradaQueueItem[]): Record<string, NfEntradaQueueItem> {
  const map: Record<string, NfEntradaQueueItem> = {};
  for (const item of queue) {
    if (!map[item.import_id]) map[item.import_id] = item;
  }
  return map;
}
