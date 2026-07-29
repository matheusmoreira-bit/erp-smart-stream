import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import {
  PAYMENT_METHOD_LABELS,
  REGISTRATION_MODE_LABELS,
  requestSupplierRegistration,
  type RegistrationBankDetails,
  type RegistrationMode,
  type RegistrationPaymentMethod,
  type SupplierRequestPayload,
} from "@/lib/supplier-request-email";
import { RegistrationFilePicker } from "@/components/RegistrationFilePicker";
import { uploadRegistrationAttachments } from "@/lib/registration-attachments";

export interface RegistrationRequestModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: "supplier" | "item";
  defaults?: Partial<SupplierRequestPayload>;
  onCreated?: (requestId: string) => void;
}

const PIX_KEY_TYPES = ["CNPJ", "CPF", "E-mail", "Telefone", "Aleatória"];

export function RegistrationRequestModal({
  open,
  onOpenChange,
  type,
  defaults,
  onCreated,
}: RegistrationRequestModalProps) {
  const { session } = useSap();
  const isItem = type === "item";

  const [name, setName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<RegistrationPaymentMethod>("pix");
  const [mode, setMode] = useState<RegistrationMode>("erpflow");
  const [bank, setBank] = useState<RegistrationBankDetails>({});
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(defaults?.cardName || "");
    setTaxId(defaults?.federalTaxId || "");
    setEmail(defaults?.email || "");
    setPhone(defaults?.phone1 || "");
    setNotes(defaults?.notes || "");
    setPaymentMethod((defaults?.paymentMethod as RegistrationPaymentMethod) || "pix");
    setMode((defaults?.registrationMode as RegistrationMode) || "erpflow");
    setBank(defaults?.bankDetails || {});
    setFiles([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const setBankField = (key: keyof RegistrationBankDetails, value: string) =>
    setBank((prev) => ({ ...prev, [key]: value }));

  const validate = (): string | null => {
    if (!name.trim()) return isItem ? "Informe a descrição do item." : "Informe a razão social / nome do fornecedor.";
    if (!isItem && !taxId.trim()) return "Informe o CNPJ/CPF do fornecedor.";
    if (!isItem) {
      if (paymentMethod === "pix" && !bank.pixKey?.trim()) return "Informe a chave PIX.";
      if ((paymentMethod === "ted" || paymentMethod === "doc") && (!bank.bank?.trim() || !bank.agency?.trim() || !bank.account?.trim()))
        return "Informe banco, agência e conta.";
      if (paymentMethod === "outro" && !bank.other?.trim()) return "Descreva a forma de pagamento.";
    }
    return null;
  };

  const handleSubmit = async () => {
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const requesterEmail = userData.user?.email?.toLowerCase();
      if (!requesterEmail) throw new Error("Sessão expirada. Faça login novamente.");

      const bankDetails = isItem ? {} : bank;

      const { data: inserted, error } = await supabase
        .from("registration_requests")
        .insert({
          request_type: type,
          title: name.trim(),
          requester_email: requesterEmail,
          requester_name: session?.userName || null,
          company_db: defaults?.companyDb || session?.companyDB || null,
          context: defaults?.context || null,
          federal_tax_id: isItem ? null : taxId.trim() || null,
          contact_email: email.trim() || null,
          phone1: phone.trim() || null,
          phone2: defaults?.phone2 || null,
          currency: defaults?.currency || null,
          address: (defaults?.address as never) ?? {},
          payment_method: isItem ? null : paymentMethod,
          bank_details: bankDetails as never,
          registration_mode: mode,
          notes: notes.trim() || null,
          attachments: (defaults?.attachments as never) ?? [],
          transaction: (defaults?.transaction as never) ?? null,
        })
        .select("id, due_at")
        .single();
      if (error) throw error;

      let uploaded: { name: string; path: string }[] = [];
      if (files.length) {
        try {
          uploaded = await uploadRegistrationAttachments(inserted.id, files, requesterEmail);
          const merged = [...(((defaults?.attachments as never[]) ?? []) as unknown[]), ...uploaded];
          await supabase
            .from("registration_requests")
            .update({ attachments: merged as never })
            .eq("id", inserted.id);
          await supabase.from("registration_request_events").insert({
            request_id: inserted.id,
            event_type: "attachment",
            message: `${uploaded.length} anexo(s) enviado(s) na abertura do chamado`,
            author_email: requesterEmail,
            author_name: session?.userName || null,
            attachments: uploaded as never,
          });
        } catch (upErr) {
          toast.warning(
            upErr instanceof Error ? upErr.message : "Chamado aberto, mas houve falha ao anexar os documentos.",
          );
        }
      }

      try {
        await requestSupplierRegistration({
          ...defaults,
          requestType: type,
          requestId: inserted.id,
          dueAt: inserted.due_at,
          cardName: name.trim(),
          federalTaxId: isItem ? null : taxId.trim(),
          email: email.trim() || defaults?.email,
          phone1: phone.trim() || defaults?.phone1,
          companyDb: defaults?.companyDb || session?.companyDB || null,
          requesterName: session?.userName || null,
          paymentMethod: isItem ? null : paymentMethod,
          bankDetails: isItem ? null : bank,
          registrationMode: mode,
          notes: notes.trim() || null,
        });
      } catch {
        toast.warning("Chamado aberto, mas o e-mail de aviso falhou. O time verá a solicitação no painel.");
      }

      toast.success(`Chamado #${inserted.id.slice(0, 8).toUpperCase()} aberto — SLA de 48h úteis.`);
      onCreated?.(inserted.id);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível abrir a solicitação.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isItem ? "Solicitar cadastro de item" : "Solicitar cadastro de fornecedor"}</DialogTitle>
          <DialogDescription>
            A solicitação vira um chamado para o time responsável, com SLA de 48 horas úteis. Você será avisado por
            e-mail quando o cadastro estiver concluído.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="rr-name">{isItem ? "Descrição do item *" : "Razão social / Nome *"}</Label>
              <Input id="rr-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            {!isItem && (
              <div className="space-y-1.5">
                <Label htmlFor="rr-taxid">CNPJ / CPF *</Label>
                <Input id="rr-taxid" value={taxId} onChange={(e) => setTaxId(e.target.value)} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="rr-email">E-mail de contato</Label>
              <Input id="rr-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rr-phone">Telefone</Label>
              <Input id="rr-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>

          {!isItem && (
            <div className="rounded-lg border border-border p-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Forma de pagamento *</Label>
                  <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as RegistrationPaymentMethod)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Forma de cadastro</Label>
                  <Select value={mode} onValueChange={(v) => setMode(v as RegistrationMode)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(REGISTRATION_MODE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {paymentMethod === "pix" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Tipo de chave</Label>
                    <Select value={bank.pixKeyType || ""} onValueChange={(v) => setBankField("pixKeyType", v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {PIX_KEY_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rr-pix">Chave PIX *</Label>
                    <Input id="rr-pix" value={bank.pixKey || ""} onChange={(e) => setBankField("pixKey", e.target.value)} />
                  </div>
                </div>
              )}

              {(paymentMethod === "ted" || paymentMethod === "doc") && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="rr-bank">Banco *</Label>
                    <Input id="rr-bank" value={bank.bank || ""} onChange={(e) => setBankField("bank", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rr-agency">Agência *</Label>
                    <Input id="rr-agency" value={bank.agency || ""} onChange={(e) => setBankField("agency", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rr-account">Conta *</Label>
                    <Input id="rr-account" value={bank.account || ""} onChange={(e) => setBankField("account", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Tipo de conta</Label>
                    <Select value={bank.accountType || ""} onValueChange={(v) => setBankField("accountType", v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Corrente">Corrente</SelectItem>
                        <SelectItem value="Poupança">Poupança</SelectItem>
                        <SelectItem value="Pagamento">Pagamento</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {(paymentMethod === "boleto" || paymentMethod === "outro") && (
                <div className="space-y-1.5">
                  <Label htmlFor="rr-other">
                    {paymentMethod === "boleto" ? "Informações do boleto" : "Descreva a forma de pagamento *"}
                  </Label>
                  <Textarea
                    id="rr-other"
                    rows={2}
                    value={bank.other || ""}
                    onChange={(e) => setBankField("other", e.target.value)}
                  />
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="rr-holder">Titular da conta</Label>
                  <Input id="rr-holder" value={bank.holderName || ""} onChange={(e) => setBankField("holderName", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rr-holder-tax">CNPJ/CPF do titular</Label>
                  <Input
                    id="rr-holder-tax"
                    value={bank.holderTaxId || ""}
                    onChange={(e) => setBankField("holderTaxId", e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="rr-notes">Observações</Label>
            <Textarea
              id="rr-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Contexto da compra, urgência, contato do fornecedor…"
            />
          </div>

          <div className="rounded-lg border border-border p-4">
            <RegistrationFilePicker files={files} onChange={setFiles} disabled={saving} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Abrir chamado
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default RegistrationRequestModal;
