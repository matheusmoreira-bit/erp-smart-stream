import type { Database } from "@/integrations/supabase/types";

type Sev = Database["public"]["Enums"]["audit_pay_severity"];
type QueueStatus = Database["public"]["Enums"]["audit_pay_queue_status"];
type SignalStatus = Database["public"]["Enums"]["audit_pay_signal_status"];

export const SEVERITY_LABELS: Record<Sev, { label: string; cls: string }> = {
  conforme: { label: "Conforme", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  baixa: { label: "Baixa", cls: "bg-sky-500/10 text-sky-400 border-sky-500/30" },
  media: { label: "Média", cls: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30" },
  alta: { label: "Alta", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  critica: { label: "Crítica", cls: "bg-destructive/15 text-destructive border-destructive/30" },
};

export const FINDING_LABELS: Record<string, string> = {
  desvio_valor: "Desvio de valor",
  troca_fornecedor: "Troca de fornecedor",
  troca_dados_bancarios: "Troca de dados bancários",
  alteracao_itens: "Alteração de itens",
  troca_centro_custo: "Troca de centro de custo",
  troca_projeto: "Troca de projeto",
  divergencia_solicitante: "Divergência de solicitante",
  alteracao_pos_aprovacao: "Alteração pós-aprovação",
  pagamento_sem_documento: "Pagamento sem documento",
  pagamento_duplicado: "Pagamento duplicado",
  pago_acima_aprovado: "Pago acima do aprovado",
};

export const SIGNAL_LABELS: Record<string, string> = {
  reincidencia: "Reincidência",
  fracionamento: "Fracionamento",
  alteracao_pos_aprovacao: "Alteração pós-aprovação",
  fornecedor_novo_alto_valor: "Fornecedor novo / alto valor",
  mudanca_bancaria_pre_pagamento: "Mudança bancária pré-pagamento",
  duplicidade: "Duplicidade",
  distribuicao_temporal_anomala: "Distribuição temporal anômala",
  valores_redondos: "Valores redondos",
  conluio_solicitante_aprovador: "Conluio solicitante ↔ aprovador",
};

const QUEUE_LABELS: Record<QueueStatus, { label: string; cls: string }> = {
  pending: { label: "Na fila", cls: "bg-muted text-muted-foreground border-border" },
  processing: { label: "Processando", cls: "bg-sky-500/15 text-sky-400 border-sky-500/30" },
  done: { label: "Concluído", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  error: { label: "Erro", cls: "bg-destructive/15 text-destructive border-destructive/30" },
  skipped: { label: "Ignorado", cls: "bg-muted text-muted-foreground border-border" },
};

export const SIGNAL_STATUS_LABELS: Record<SignalStatus, string> = {
  aberto: "Aberto",
  em_analise: "Em análise",
  confirmado_erro: "Confirmado (erro)",
  confirmado_fraude: "Confirmado (fraude)",
  descartado: "Descartado",
};

export function PaySeverityBadge({ severity }: { severity: Sev }) {
  const s = SEVERITY_LABELS[severity] ?? SEVERITY_LABELS.baixa;
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}

export function QueueStatusBadge({ status }: { status: QueueStatus }) {
  const s = QUEUE_LABELS[status] ?? QUEUE_LABELS.pending;
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}

export function formatBRL(value: number | string | null | undefined, currency = "BRL") {
  const n = Number(value ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(safe);
  } catch {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(safe);
  }
}
