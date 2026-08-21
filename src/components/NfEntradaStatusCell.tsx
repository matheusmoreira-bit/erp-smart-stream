import { Badge } from "@/components/ui/badge";
import { Clock, AlertTriangle } from "lucide-react";
import type { NfEntradaImport, NfEntradaStatus } from "@/hooks/useNfEntrada";

type StatusVariant = "default" | "secondary" | "destructive" | "outline";

export type StatusPresentation = { label: string; variant: StatusVariant; hint: string; next?: string };

/** De onde vem o status exibido: do fluxo interno ou de uma leitura do SAP. */
export function statusOrigin(it: NfEntradaImport): { source: "erpflow" | "sap"; label: string; hint: string } {
  const sapDriven: NfEntradaStatus[] = ["awaiting_sap", "awaiting_invoice", "sap_rejected", "completed"];
  if (it.sap_invoice_draft_id || sapDriven.includes(it.status)) {
    return {
      source: "sap",
      label: "SAP",
      hint: "Status determinado pela leitura do SAP (watcher / reconferência no Service Layer).",
    };
  }
  return {
    source: "erpflow",
    label: "ERP Flow",
    hint: "Status determinado pelo fluxo interno do ERP Flow (pedido, aprovação, integração).",
  };
}

const STALE_HOURS = 6;

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "agora há pouco";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}

export function watcherState(it: NfEntradaImport) {
  const awaitsSap = it.status === "awaiting_sap" || it.status === "awaiting_invoice";
  const lastPollAt = it.last_poll_at ?? null;
  const ageMs = lastPollAt ? Date.now() - new Date(lastPollAt).getTime() : null;
  const stale = awaitsSap && (ageMs === null || ageMs > STALE_HOURS * 3600_000);
  return { awaitsSap, lastPollAt, stale };
}

/** Célula de status com origem, última varredura e aviso de atraso. */
export function NfEntradaStatusCell({ item, presentation }: { item: NfEntradaImport; presentation: StatusPresentation }) {
  const origin = statusOrigin(item);
  const { awaitsSap, lastPollAt, stale } = watcherState(item);

  return (
    <div className="space-y-1 max-w-[240px]">
      <div className="flex flex-wrap items-center gap-1">
        <Badge variant={presentation.variant} title={presentation.hint}>{presentation.label}</Badge>
        <span
          title={origin.hint}
          className={
            "inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium border " +
            (origin.source === "sap"
              ? "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400"
              : "border-border bg-muted text-muted-foreground")
          }
        >
          {origin.label}
        </span>
      </div>

      <div className="text-[10px] text-muted-foreground leading-snug">{presentation.hint}</div>
      {presentation.next && (
        <div className="text-[10px] text-foreground/70 leading-snug">
          <span className="font-medium">Próxima ação: </span>{presentation.next}
        </div>
      )}


      {awaitsSap && (
        <div className="flex flex-wrap items-center gap-1 text-[10px]">
          {stale ? (
            <span
              title={`Sem leitura do SAP há mais de ${STALE_HOURS}h — o watcher pode não estar rodando.`}
              className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 font-medium text-destructive"
            >
              <AlertTriangle className="w-2.5 h-2.5" aria-hidden="true" /> Varredura atrasada
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1 text-muted-foreground" title={lastPollAt ? new Date(lastPollAt).toLocaleString("pt-BR") : undefined}>
            <Clock className="w-2.5 h-2.5" aria-hidden="true" />
            {lastPollAt ? `Verificado no SAP ${relativeTime(lastPollAt)}` : "Nunca verificado no SAP"}
          </span>
        </div>
      )}
    </div>
  );
}
