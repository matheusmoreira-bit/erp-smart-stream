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
import { Checkbox } from "@/components/ui/checkbox";
import { AlertTriangle, ClipboardCheck, Loader2, Send } from "lucide-react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface DuplicateRequest {
  id: string;
  title: string;
  status: string;
  requester_email: string;
  requester_name: string | null;
  due_at: string;
  created_at: string;
  already_linked: boolean;
}

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
  const [duplicate, setDuplicate] = useState<DuplicateRequest | null>(null);

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

  /** Vincula o solicitante a um chamado já aberto do mesmo fornecedor/item. */
  const linkToExisting = async (dup: DuplicateRequest) => {
    setSaving(true);
    try {
      const extra = notes.trim();
      const { error } = await supabase.rpc("join_registration_request", {
        p_request_id: dup.id,
        p_note: extra
          ? `Também precisa deste cadastro. Observações: ${extra}`
          : null,
        p_author_name: session?.userName || null,
      });
      if (error) throw error;
      toast.success(
        `Você foi vinculado ao chamado #${dup.id.slice(0, 8).toUpperCase()}, já aberto para este ${
          isItem ? "item" : "fornecedor"
        }.`,
      );
      setDuplicate(null);
      onCreated?.(dup.id);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível vincular ao chamado existente.");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }

    // Antes de abrir um novo chamado, procura uma solicitação em aberto para o
    // mesmo CNPJ/CPF (ou mesmo nome) e oferece o vínculo, evitando duplicidade.
    setSaving(true);
    try {
      const { data: dupRows } = await supabase.rpc("find_open_registration_duplicate", {
        p_type: type,
        p_tax_id: isItem ? null : taxId.trim() || null,
        p_title: name.trim() || null,
        p_company_db: defaults?.companyDb || session?.companyDB || null,
      });
      const dup = (Array.isArray(dupRows) ? dupRows[0] : null) as DuplicateRequest | null;
      if (dup) {
        setSaving(false);
        if (dup.already_linked) {
          toast.info(
            `Você já está vinculado ao chamado #${dup.id.slice(0, 8).toUpperCase()} para "${dup.title}".`,
          );
          onCreated?.(dup.id);
          onOpenChange(false);
          return;
        }
        setDuplicate(dup);
        return;
      }
    } catch {
      /* checagem best-effort: segue para a criação normal */
    }

    await createRequest();
  };

  const createRequest = async () => {
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
    <>
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

              <div className="rounded-md border border-dashed border-border bg-muted/30 p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="w-4 h-4 text-muted-foreground" />
                  <p className="text-sm font-medium">Revisão dos dados de pagamento</p>
                </div>
                <dl className="grid gap-2 sm:grid-cols-2 text-sm">
                  {paymentSummary.map((row) => (
                    <div key={row.label}>
                      <dt className="text-xs text-muted-foreground">{row.label}</dt>
                      <dd className={`font-medium break-all ${row.value ? "" : "text-muted-foreground italic"}`}>
                        {row.value || "não informado"}
                      </dd>
                    </div>
                  ))}
                </dl>
                {paymentWarnings.length > 0 && (
                  <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-400">
                    {paymentWarnings.map((w) => (
                      <li key={w} className="flex items-start gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={paymentConfirmed}
                    onCheckedChange={(v) => setPaymentConfirmed(v === true)}
                    className="mt-0.5"
                  />
                  <span>
                    Revisei e confirmo que os dados de pagamento acima estão corretos e conferem com o documento
                    enviado pelo fornecedor.
                  </span>
                </label>
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

    <AlertDialog open={!!duplicate} onOpenChange={(o) => !o && setDuplicate(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Já existe um chamado aberto</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              <p>
                O {isItem ? "item" : "fornecedor"} <strong>{duplicate?.title}</strong> já possui a
                solicitação <strong>#{duplicate?.id.slice(0, 8).toUpperCase()}</strong> em andamento,
                aberta por {duplicate?.requester_name || duplicate?.requester_email}
                {duplicate?.created_at
                  ? ` em ${new Date(duplicate.created_at).toLocaleDateString("pt-BR")}`
                  : ""}
                .
              </p>
              <p>
                Em vez de abrir um novo chamado, você será vinculado a esse — acompanhará o andamento
                e receberá o aviso de conclusão.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={saving}
            onClick={(e) => {
              e.preventDefault();
              if (duplicate) void linkToExisting(duplicate);
            }}
          >
            Vincular ao chamado existente
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

export default RegistrationRequestModal;
