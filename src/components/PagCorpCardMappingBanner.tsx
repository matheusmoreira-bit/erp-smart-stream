import { AlertTriangle, CheckCircle2, ExternalLink, Info } from "lucide-react";
import type { CardMappingStatus } from "@/hooks/usePagCorpCardMapping";

interface Props {
  status: CardMappingStatus;
  source: "card" | "fallback" | null;
  missingFields: string[];
  cardKey: string | null;
}

export function PagCorpCardMappingBanner({ status, source, missingFields, cardKey }: Props) {
  const openMapping = () => {
    const url = cardKey
      ? `/cartoes/mapeamento?card=${encodeURIComponent(cardKey)}`
      : `/cartoes/mapeamento`;
    window.open(url, "_blank", "noopener");
  };

  // Sem cartão identificável — nada a mostrar
  if (!cardKey && status === "none") return null;

  if (status === "full" && source === "card") {
    return (
      <div className="flex items-start gap-2 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
        <p className="text-xs text-foreground flex-1">
          Mapeamento do cartão aplicado (Centro de Custo, Projeto e Item).
        </p>
      </div>
    );
  }

  if (status === "full" && source === "fallback") {
    return (
      <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30">
        <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <p className="text-xs text-foreground flex-1">
          Aplicado o <strong>fallback da empresa</strong>. Crie um mapeamento específico para este cartão se desejar.
        </p>
        <button
          type="button"
          onClick={openMapping}
          className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1 shrink-0"
        >
          Abrir mapeamento <ExternalLink className="w-3 h-3" />
        </button>
      </div>
    );
  }

  if (status === "partial") {
    return (
      <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30">
        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-foreground">
            Mapeamento {source === "fallback" ? "(fallback) " : ""}incompleto — faltando:{" "}
            <strong>{missingFields.join(", ")}</strong>. Preencha manualmente abaixo ou edite o mapeamento.
          </p>
        </div>
        <button
          type="button"
          onClick={openMapping}
          className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1 shrink-0"
        >
          Abrir mapeamento <ExternalLink className="w-3 h-3" />
        </button>
      </div>
    );
  }

  // status === "none"
  return (
    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30">
      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
      <p className="text-xs text-foreground flex-1">
        Nenhum mapeamento encontrado para este cartão e não há <em>fallback</em> configurado.
        Preencha Centro de Custo, Projeto e Item manualmente.
      </p>
      <button
        type="button"
        onClick={openMapping}
        className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1 shrink-0"
      >
        Abrir mapeamento <ExternalLink className="w-3 h-3" />
      </button>
    </div>
  );
}
