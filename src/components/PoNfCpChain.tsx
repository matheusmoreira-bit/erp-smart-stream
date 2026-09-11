import { Link2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { usePoNfCpChain, type PoNfCpLink } from "@/hooks/usePoNfCpChain";

const fmtMoney = (v?: number | null) =>
  typeof v === "number" ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";

export function statusVariant(status?: string | null): "default" | "secondary" | "destructive" | "outline" {
  const s = (status || "").toLowerCase();
  if (s.includes("pago") || s.includes("liquidad")) return "default";
  if (s.includes("pendente")) return "secondary";
  if (s.includes("cancel") || s.includes("vencid")) return "destructive";
  return "outline";
}

interface Props {
  companyDb: string | null | undefined;
  poDocEntry: number | string | null | undefined;
}

/** Mostra a cadeia Pedido de Compra -> NF de Entrada -> Contas a Pagar vinda do ERP. */
export function PoNfCpChain({ companyDb, poDocEntry }: Props) {
  const { links, loading, error } = usePoNfCpChain(companyDb, poDocEntry);

  if (!companyDb || poDocEntry === null || poDocEntry === undefined) return null;

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 sm:p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Link2 className="w-4 h-4 text-primary" aria-hidden="true" />
        <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
          Pedido · Nota de entrada · Contas a pagar
        </span>
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" aria-hidden="true" />}
      </div>

      {error && <p className="text-xs text-destructive">Não foi possível carregar a ligação agora.</p>}

      {!loading && !error && links.length === 0 && (
        <p className="text-[11px] text-muted-foreground italic">
          Ainda não há nota de entrada ou conta a pagar ligada a este pedido.
        </p>
      )}

      {links.length > 0 && (
        <ul className="space-y-2">
          {links.map((l: PoNfCpLink) => (
            <li key={l.id} className="rounded-md border bg-card p-2.5 text-xs space-y-1">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-medium truncate">{l.nome_fornecedor || l.cod_fornecedor || "—"}</span>
                <div className="flex items-center gap-2">
                  <span className="font-semibold whitespace-nowrap">{fmtMoney(l.valor)}</span>
                  {l.status_geral && <Badge variant={statusVariant(l.status_geral)}>{l.status_geral}</Badge>}
                </div>
              </div>
              <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 font-mono">
                {l.id_pedido_compra && <span>Pedido {l.id_pedido_compra}</span>}
                {l.numero_nota_fiscal && <span>Nota {l.numero_nota_fiscal}</span>}
                {l.id_nf_entrada && <span>Entrada {l.id_nf_entrada}</span>}
                {l.id_contas_pagar ? <span>A pagar {l.id_contas_pagar}</span> : <span>Sem conta a pagar</span>}
              </div>
              {l.referencia_valor && (
                <p className="text-[11px] text-muted-foreground">{l.referencia_valor}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
