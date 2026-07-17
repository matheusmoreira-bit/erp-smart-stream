import { ExternalLink } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CruzamentoRow } from "@/hooks/useAuditCrossFiscal";

function money(v: number | null | undefined) {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("pt-BR");
}

interface Props {
  row: CruzamentoRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (row: CruzamentoRow) => void;
  onIgnore: (row: CruzamentoRow) => void;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5 border-b border-border/50">
      <span className="text-[11px] uppercase text-muted-foreground">{label}</span>
      <span className="text-sm break-words">{value ?? "—"}</span>
    </div>
  );
}

export function CruzamentoDetailDrawer({ row, open, onOpenChange, onConfirm, onIgnore }: Props) {
  if (!row) return null;
  const candidatos = (row as unknown as { candidatos_ambiguos?: Array<{ id_externo: string; valor: number; data_baixa: string; score: number }> }).candidatos_ambiguos;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{row.razao_social_fornecedor || "Fornecedor"}</SheetTitle>
          <SheetDescription className="font-mono text-xs">{row.cnpj_fornecedor}</SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge variant="outline">{row.cenario}</Badge>
          <Badge variant={row.status_match === "ambiguo" ? "destructive" : "secondary"}>
            {row.status_match}
          </Badge>
          {row.erp_origem && <Badge variant="outline">{row.erp_origem.toUpperCase()}</Badge>}
        </div>

        <div className="mt-4 space-y-4">
          <section>
            <h4 className="text-sm font-semibold mb-1">Nota fiscal (MasterTax)</h4>
            <Field label="Número" value={row.nota_numero} />
            <Field label="Valor" value={money(row.nota_valor)} />
            <Field label="Emissão" value={fmtDate(row.nota_data_emissao)} />
            <Field label="Chave de acesso" value={<span className="font-mono text-xs">{row.nota_chave_acesso}</span>} />
          </section>

          <section>
            <h4 className="text-sm font-semibold mb-1">Pagamento (ERP)</h4>
            <Field label="ID externo" value={<span className="font-mono text-xs">{row.conta_paga_id_externo}</span>} />
            <Field label="Valor pago" value={money(row.conta_paga_valor)} />
            <Field label="Data baixa" value={fmtDate(row.conta_paga_data_baixa)} />
            <Field label="Forma de pagamento" value={row.conta_paga_forma_pagamento} />
            {row.conta_paga_link_origem && (
              <div className="pt-2">
                <Button variant="outline" size="sm" asChild>
                  <a href={row.conta_paga_link_origem} target="_blank" rel="noreferrer">
                    <ExternalLink className="w-3 h-3 mr-1" /> Abrir no ERP
                  </a>
                </Button>
              </div>
            )}
          </section>

          {row.cenario === "conciliado" && (
            <section>
              <h4 className="text-sm font-semibold mb-1">Reconciliação</h4>
              <Field label="Diferença R$" value={money(row.diferenca_valor)} />
              <Field label="Diferença dias" value={row.diferenca_dias} />
              <Field
                label="Score"
                value={row.score_confianca != null ? `${(row.score_confianca * 100).toFixed(1)}%` : "—"}
              />
            </section>
          )}

          {candidatos && candidatos.length > 0 && (
            <section>
              <h4 className="text-sm font-semibold mb-1">Candidatos ambíguos</h4>
              <div className="space-y-1">
                {candidatos.map((c) => (
                  <div key={c.id_externo} className="text-xs border rounded p-2 flex justify-between gap-2">
                    <span className="font-mono truncate">{c.id_externo}</span>
                    <span className="tabular-nums">{money(c.valor)}</span>
                    <span>{fmtDate(c.data_baixa)}</span>
                    <span className="tabular-nums">{(c.score * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <h4 className="text-sm font-semibold mb-1">Período analisado</h4>
            <Field label="Início" value={fmtDate(row.periodo_inicio)} />
            <Field label="Fim" value={fmtDate(row.periodo_fim)} />
            <Field label="Criado em" value={new Date(row.criado_em).toLocaleString("pt-BR")} />
          </section>

          <div className="flex gap-2 pt-2">
            {row.status_match === "ambiguo" && (
              <Button size="sm" onClick={() => { onConfirm(row); onOpenChange(false); }}>
                Confirmar match
              </Button>
            )}
            {row.status_match !== "ignorado" && (
              <Button size="sm" variant="outline" onClick={() => { onIgnore(row); onOpenChange(false); }}>
                Ignorar
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
