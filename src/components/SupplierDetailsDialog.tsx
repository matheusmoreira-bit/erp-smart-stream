import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, AlertTriangle, Copy, CheckCircle2, XCircle, Banknote } from "lucide-react";
import { toast } from "sonner";
import type { SapSession } from "@/lib/sap-client";
import {
  fetchBusinessPartnerDetails,
  pixMatchesRegistration,
  type BusinessPartnerDetails,
} from "@/lib/supplier-details";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  session: SapSession | null;
  cardCode: string | null;
  bpLabel?: string;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate text-sm text-foreground" title={value || "—"}>
        {value || "—"}
      </p>
    </div>
  );
}

/**
 * Mostra, dentro do Flow, o cadastro do fornecedor/cliente no ERP:
 * CNPJ/CPF, endereço, contas bancárias e chaves PIX — além de permitir
 * validar uma chave PIX recebida para pagamento contra o cadastro.
 */
export function SupplierDetailsDialog({ open, onOpenChange, session, cardCode, bpLabel = "Fornecedor" }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<BusinessPartnerDetails | null>(null);
  const [pixInput, setPixInput] = useState("");

  useEffect(() => {
    if (!open || !cardCode) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetails(null);
    setPixInput("");
    (async () => {
      try {
        if (!session) throw new Error("Sem sessão ativa no ERP para consultar o cadastro.");
        const d = await fetchBusinessPartnerDetails(session, cardCode);
        if (!cancelled) setDetails(d);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Falha ao consultar o cadastro no ERP.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, cardCode, session]);

  const pixCheck = pixMatchesRegistration(details, pixInput);
  const hasPix = !!details && (details.pixKeys.length > 0 || details.bankAccounts.some((b) => b.pixKey));

  const copy = (v: string) => {
    void navigator.clipboard.writeText(v);
    toast.success("Copiado");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Cadastro do {bpLabel.toLowerCase()} no ERP</DialogTitle>
          <DialogDescription>
            CNPJ/CPF, contas bancárias e chaves PIX direto do ERP — sem precisar abrir o sistema antigo.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Consultando cadastro…
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
            <span>{error}</span>
          </div>
        ) : !details ? (
          <p className="py-8 text-sm text-muted-foreground">Nenhum cadastro encontrado para este código.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Código" value={details.cardCode} />
              <Field label="Razão social" value={details.cardName} />
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">CNPJ / CPF</p>
                <div className="flex items-center gap-1">
                  <p className="truncate font-mono text-sm text-foreground">{details.taxIdFormatted || "—"}</p>
                  {details.taxIdFormatted && (
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copy(details.taxIdFormatted)} aria-label="Copiar CNPJ">
                      <Copy className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
              <Field label="Inscrição estadual" value={details.stateTaxId} />
              <Field label="Moeda" value={details.currency} />
              <Field label="Situação" value={details.frozen ? "Inativo/bloqueado" : "Ativo"} />
              <Field label="E-mail" value={details.email} />
              <Field label="Telefone" value={details.phone} />
              <Field label="Endereço" value={details.address} />
            </div>

            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Banknote className="h-3.5 w-3.5" /> Contas bancárias
              </p>
              {details.bankAccounts.length === 0 ? (
                <p className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
                  Nenhuma conta bancária cadastrada para este {bpLabel.toLowerCase()}.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border/60">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left">Banco</th>
                        <th className="px-3 py-2 text-left">Agência</th>
                        <th className="px-3 py-2 text-left">Conta</th>
                        <th className="px-3 py-2 text-left">PIX</th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.bankAccounts.map((b, i) => (
                        <tr key={`${b.bankCode}-${b.account}-${i}`} className="border-t border-border/50">
                          <td className="px-3 py-2">{b.bankName || "—"}</td>
                          <td className="px-3 py-2 font-mono text-xs">{b.branch || "—"}</td>
                          <td className="px-3 py-2 font-mono text-xs">{b.account || b.iban || "—"}</td>
                          <td className="px-3 py-2 font-mono text-xs">{b.pixKey || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {details.pixKeys.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Chaves PIX no cadastro: <span className="font-mono text-foreground">{details.pixKeys.join(", ")}</span>
                </p>
              )}
            </div>

            <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
              <Label htmlFor="pix-check" className="text-xs">
                Conferir chave PIX recebida
              </Label>
              <Input
                id="pix-check"
                value={pixInput}
                onChange={(e) => setPixInput(e.target.value)}
                placeholder="Cole aqui a chave PIX informada para pagamento"
              />
              {pixInput.trim() ? (
                pixCheck.known ? (
                  <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Chave vinculada ao cadastro no ERP.
                  </p>
                ) : pixCheck.matchesTaxId ? (
                  <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Chave igual ao CNPJ/CPF do cadastro.
                  </p>
                ) : (
                  <p className="flex items-center gap-1.5 text-xs text-destructive">
                    <XCircle className="h-3.5 w-3.5" />
                    {hasPix
                      ? "Chave não confere com o cadastro — valide antes de pagar."
                      : "Cadastro sem chave PIX registrada e a chave não bate com o CNPJ/CPF."}
                  </p>
                )
              ) : null}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
