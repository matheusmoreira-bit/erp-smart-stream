import { CloudOff } from "lucide-react";
import { useStandaloneMode } from "@/hooks/useStandaloneMode";

/** Aviso permanente enquanto a empresa opera sem o ERP. */
export function StandaloneModeBanner() {
  const { mode, isStandalone } = useStandaloneMode();
  if (!isStandalone || !mode) return null;

  const until = mode.ends_at
    ? new Date(mode.ends_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    : null;

  return (
    <div
      role="status"
      className="w-full border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm text-warning-foreground"
    >
      <div className="mx-auto flex max-w-7xl items-center gap-2">
        <CloudOff className="h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          <strong>Modo standalone ativo</strong> — o sistema está operando sem o ERP
          {until ? ` até ${until}` : ""}. Os cadastros são os copiados na última sincronização e os
          documentos aprovados entram no ERP automaticamente quando o modo for desligado.
          {mode.reason ? ` Motivo: ${mode.reason}.` : ""}
        </p>
      </div>
    </div>
  );
}
