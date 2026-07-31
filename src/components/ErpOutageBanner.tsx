import { AlertTriangle } from "lucide-react";

/**
 * Aviso temporário de indisponibilidade do ERP (SAP B1) na tela de login.
 * Remover este componente (e seu uso em SapLoginForm) quando o ERP normalizar.
 */
export function ErpOutageBanner() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-6 rounded-xl border border-destructive/40 bg-destructive/10 p-4 flex gap-3"
    >
      <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">
          ERP temporariamente indisponível
        </p>
        <p className="text-xs text-muted-foreground">
          O SAP está fora do ar neste momento. O login e as operações de compras, vendas,
          aprovações e integrações estão momentaneamente fora de serviço. Estamos monitorando
          e o acesso será restabelecido assim que o ERP voltar.
        </p>
      </div>
    </div>
  );
}
