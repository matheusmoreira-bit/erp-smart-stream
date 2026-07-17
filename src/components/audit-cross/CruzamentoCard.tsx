import { ExternalLink, MoreVertical, CheckCircle2, EyeOff, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CruzamentoRow, CenarioCruzamento } from "@/hooks/useAuditCrossFiscal";

function money(v: number | null | undefined) {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("pt-BR");
}

const BORDER: Record<CenarioCruzamento, string> = {
  pago_sem_nota: "border-l-4 border-l-destructive",
  conciliado: "border-l-4 border-l-emerald-500",
  nota_sem_pagamento: "border-l-4 border-l-amber-500",
};

interface Props {
  row: CruzamentoRow;
  onOpen: (row: CruzamentoRow) => void;
  onConfirm: (row: CruzamentoRow) => void;
  onIgnore: (row: CruzamentoRow) => void;
}

export function CruzamentoCard({ row, onOpen, onConfirm, onIgnore }: Props) {
  const isConciliado = row.cenario === "conciliado";
  const isNota = row.cenario === "nota_sem_pagamento";
  const isPago = row.cenario === "pago_sem_nota";

  return (
    <div
      className={`group rounded-md border bg-card p-3 shadow-sm hover:shadow transition-shadow cursor-pointer ${BORDER[row.cenario]}`}
      onClick={() => onOpen(row)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">
            {row.razao_social_fornecedor || "Fornecedor não identificado"}
          </div>
          <div className="text-[11px] font-mono text-muted-foreground truncate">
            {row.cnpj_fornecedor}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="h-6 w-6 opacity-60 hover:opacity-100">
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={() => onOpen(row)}>
              <Info className="w-4 h-4 mr-2" /> Ver detalhes
            </DropdownMenuItem>
            {row.conta_paga_link_origem && (
              <DropdownMenuItem asChild>
                <a href={row.conta_paga_link_origem} target="_blank" rel="noreferrer">
                  <ExternalLink className="w-4 h-4 mr-2" /> Abrir no ERP
                </a>
              </DropdownMenuItem>
            )}
            {row.status_match === "ambiguo" && (
              <DropdownMenuItem onClick={() => onConfirm(row)}>
                <CheckCircle2 className="w-4 h-4 mr-2" /> Confirmar match
              </DropdownMenuItem>
            )}
            {row.status_match !== "ignorado" && (
              <DropdownMenuItem onClick={() => onIgnore(row)}>
                <EyeOff className="w-4 h-4 mr-2" /> Ignorar
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-2 space-y-1 text-xs">
        {(isNota || isConciliado) && row.nota_valor != null && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              NF {row.nota_numero || "—"} · {fmtDate(row.nota_data_emissao)}
            </span>
            <span className="font-medium tabular-nums">{money(row.nota_valor)}</span>
          </div>
        )}
        {(isPago || isConciliado) && row.conta_paga_valor != null && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              Pago {fmtDate(row.conta_paga_data_baixa)}
              {row.conta_paga_forma_pagamento ? ` · ${row.conta_paga_forma_pagamento}` : ""}
            </span>
            <span className="font-medium tabular-nums">{money(row.conta_paga_valor)}</span>
          </div>
        )}
        {isConciliado && (row.diferenca_valor != null || row.diferenca_dias != null) && (
          <div className="flex justify-between text-[11px] pt-1 border-t">
            <span className="text-muted-foreground">
              Δ {money(row.diferenca_valor)} · {row.diferenca_dias ?? 0}d
            </span>
            {row.score_confianca != null && (
              <span className="tabular-nums text-muted-foreground">
                score {(row.score_confianca * 100).toFixed(0)}%
              </span>
            )}
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center gap-1 flex-wrap">
        {row.erp_origem && (
          <Badge variant="outline" className="text-[10px] py-0 h-4">
            {row.erp_origem.toUpperCase()}
          </Badge>
        )}
        <Badge
          variant={
            row.status_match === "ambiguo"
              ? "destructive"
              : row.status_match === "confirmado_manual"
                ? "default"
                : row.status_match === "ignorado"
                  ? "outline"
                  : "secondary"
          }
          className="text-[10px] py-0 h-4"
        >
          {row.status_match}
        </Badge>
      </div>
    </div>
  );
}
