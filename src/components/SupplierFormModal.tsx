import { useEffect, useState } from "react";
import { z } from "zod";
import { Loader2, Sparkles, Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useSap } from "@/contexts/SapContext";
import { parseSapError } from "@/lib/sap-error";
import {
  type Supplier,
  type SupplierInput,
  createSupplier,
  updateSupplier,
  getNextCardCode,
  fetchSupplierFromSap,
} from "@/hooks/useSuppliers";
import { COUNTRIES, getCountry, isForeign } from "@/lib/countries";

const supplierSchema = z
  .object({
    card_name: z.string().trim().min(2, "Nome obrigatório").max(200),
    card_type: z.enum(["S"]).default("S"),
    federal_tax_id: z.string().trim().min(3, "Identificação fiscal obrigatória").max(40),
    u_fgr_taxid0: z.string().trim().max(40).optional().or(z.literal("")),
    email: z.string().trim().email("Email inválido").max(200).optional().or(z.literal("")),
    phone1: z.string().trim().max(30).optional().or(z.literal("")),
    phone2: z.string().trim().max(30).optional().or(z.literal("")),
    currency: z.string().trim().min(3).max(3),
    bill_to_street: z.string().trim().max(200).optional().or(z.literal("")),
    bill_to_zip: z.string().trim().max(20).optional().or(z.literal("")),
    bill_to_city: z.string().trim().max(100).optional().or(z.literal("")),
    bill_to_state: z.string().trim().max(60).optional().or(z.literal("")),
    bill_to_country: z.string().trim().length(2, "País obrigatório"),
    bill_to_block: z.string().trim().max(100).optional().or(z.literal("")),
    bill_to_building: z.string().trim().max(50).optional().or(z.literal("")),
  })
  .superRefine((val, ctx) => {
    // Brazilian tax ID validation: 11 (CPF) or 14 (CNPJ) digits
    if ((val.bill_to_country || "").toUpperCase() === "BR") {
      const digits = val.federal_tax_id.replace(/\D/g, "");
      if (digits.length !== 11 && digits.length !== 14) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["federal_tax_id"],
          message: "CNPJ (14 dígitos) ou CPF (11 dígitos)",
        });
      }
    }
  });

export interface SupplierFormPrefill {
  card_name?: string;
  federal_tax_id?: string;
  email?: string;
  phone1?: string;
  phone2?: string;
  currency?: string;
  bill_to_street?: string;
  bill_to_zip?: string;
  bill_to_city?: string;
  bill_to_state?: string;
  bill_to_country?: string;
  bill_to_block?: string;
  bill_to_building?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (s: Supplier) => void;
  editing?: Supplier | null;
  prefill?: SupplierFormPrefill | null;
  source?: string;
}

export function SupplierFormModal({ open, onClose, onSaved, editing, prefill, source = "manual" }: Props) {
  const { session } = useSap();
  const [submitting, setSubmitting] = useState(false);
  const [loadingCode, setLoadingCode] = useState(false);
  const [cardCode, setCardCode] = useState<string>("");
  const [form, setForm] = useState({
    card_name: "",
    card_type: "S" as const,
    federal_tax_id: "",
    u_fgr_taxid0: "",
    email: "",
    phone1: "",
    phone2: "",
    currency: "BRL",
    bill_to_street: "",
    bill_to_zip: "",
    bill_to_city: "",
    bill_to_state: "",
    bill_to_country: "BR",
    bill_to_block: "",
    bill_to_building: "",
  });

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setCardCode(editing.card_code || "");
      // Seed form with whatever local data we already have
      setForm({
        card_name: editing.card_name || "",
        card_type: "S",
        federal_tax_id: editing.federal_tax_id || "",
        u_fgr_taxid0: editing.u_fgr_taxid0 || "",
        email: editing.email || "",
        phone1: editing.phone1 || "",
        phone2: editing.phone2 || "",
        currency: editing.currency || "BRL",
        bill_to_street: editing.bill_to_street || "",
        bill_to_zip: editing.bill_to_zip || "",
        bill_to_city: editing.bill_to_city || "",
        bill_to_state: editing.bill_to_state || "",
        bill_to_country: editing.bill_to_country || "BR",
        bill_to_block: editing.bill_to_block || "",
        bill_to_building: editing.bill_to_building || "",
      });
      // Hydrate full details (addresses etc.) from SAP — list query only returns summary fields.
      if (session && editing.card_code) {
        setLoadingCode(true);
        fetchSupplierFromSap(editing.card_code, session)
          .then((full) => {
            if (!full) return;
            setForm((f) => ({
              ...f,
              card_name: full.card_name || f.card_name,
              federal_tax_id: (full.federal_tax_id as string) || f.federal_tax_id,
              u_fgr_taxid0: (full.u_fgr_taxid0 as string) || f.u_fgr_taxid0,
              email: (full.email as string) || f.email,
              phone1: (full.phone1 as string) || f.phone1,
              phone2: (full.phone2 as string) || f.phone2,
              currency: full.currency || f.currency,
              bill_to_street: (full.bill_to_street as string) || f.bill_to_street,
              bill_to_zip: (full.bill_to_zip as string) || f.bill_to_zip,
              bill_to_city: (full.bill_to_city as string) || f.bill_to_city,
              bill_to_state: (full.bill_to_state as string) || f.bill_to_state,
              bill_to_country: (full.bill_to_country as string) || f.bill_to_country,
              bill_to_block: (full.bill_to_block as string) || f.bill_to_block,
              bill_to_building: (full.bill_to_building as string) || f.bill_to_building,
            }));
          })
          .finally(() => setLoadingCode(false));
      }
    } else {
      const prefillCountry = (prefill?.bill_to_country || "BR").toUpperCase();
      const prefillCurrency =
        prefill?.currency || getCountry(prefillCountry).default_currency;
      setForm((f) => ({
        ...f,
        card_name: prefill?.card_name || "",
        federal_tax_id: prefill?.federal_tax_id || "",
        u_fgr_taxid0: prefill?.federal_tax_id || "",
        email: prefill?.email || "",
        phone1: prefill?.phone1 || "",
        phone2: prefill?.phone2 || "",
        currency: prefillCurrency,
        bill_to_street: prefill?.bill_to_street || "",
        bill_to_zip: prefill?.bill_to_zip || "",
        bill_to_city: prefill?.bill_to_city || "",
        bill_to_state: prefill?.bill_to_state || "",
        bill_to_country: prefillCountry,
        bill_to_block: prefill?.bill_to_block || "",
        bill_to_building: prefill?.bill_to_building || "",
      }));
      // Fetch next CardCode from SAP
      if (session) {
        setLoadingCode(true);
        getNextCardCode(session)
          .then((c) => setCardCode(c))
          .catch(() => setCardCode(""))
          .finally(() => setLoadingCode(false));
      }
    }
  }, [open, editing, prefill, session]);

  // Auto-complete address from CEP (ViaCEP). Triggered when CEP has 8 digits
  // and at least one address field is missing. Never overrides existing values.
  const [cepLookup, setCepLookup] = useState<string | null>(null);
  useEffect(() => {
    // Only run ViaCEP for Brazilian addresses
    if ((form.bill_to_country || "BR").toUpperCase() !== "BR") return;
    const cep = (form.bill_to_zip || "").replace(/\D/g, "");
    if (cep.length !== 8 || cep === cepLookup) return;
    setCepLookup(cep);
    let cancelled = false;
    fetch(`https://viacep.com.br/ws/${cep}/json/`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data || data.erro) return;
        setForm((f) => ({
          ...f,
          bill_to_street: f.bill_to_street || data.logradouro || "",
          bill_to_block: f.bill_to_block || data.bairro || "",
          bill_to_city: f.bill_to_city || data.localidade || "",
          bill_to_state: f.bill_to_state || (data.uf ? String(data.uf).toUpperCase() : ""),
          bill_to_country: f.bill_to_country || "BR",
        }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [form.bill_to_zip, form.bill_to_country, cepLookup]);

  // When the user changes country (and not editing), suggest the country's
  // default currency unless the user has already chosen something custom.
  const handleCountryChange = (code: string) => {
    const upper = code.toUpperCase();
    setForm((f) => {
      const currentDefault = getCountry(f.bill_to_country).default_currency;
      const shouldSwitchCurrency = !f.currency || f.currency === currentDefault;
      return {
        ...f,
        bill_to_country: upper,
        currency: shouldSwitchCurrency ? getCountry(upper).default_currency : f.currency,
        // Clear state when switching to/from BR — formats differ (UF vs free text)
        bill_to_state:
          (upper === "BR") !== ((f.bill_to_country || "BR").toUpperCase() === "BR")
            ? ""
            : f.bill_to_state,
      };
    });
  };

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    const parsed = supplierSchema.safeParse(form);
    if (!parsed.success) {
      const first = parsed.error.errors[0];
      toast.error(first?.message || "Formulário inválido");
      return;
    }
    if (!session?.companyDB) {
      toast.error("Sessão SAP ausente");
      return;
    }
    setSubmitting(true);
    try {
      const isBR = (form.bill_to_country || "BR").toUpperCase() === "BR";
      // Brazilian tax IDs are stored digits-only; foreign IDs preserve format.
      const taxIdNormalized = isBR
        ? form.federal_tax_id.replace(/\D/g, "")
        : form.federal_tax_id.trim();
      const ufgrNormalized = isBR
        ? (form.u_fgr_taxid0 || form.federal_tax_id).replace(/\D/g, "") || null
        : (form.u_fgr_taxid0 || form.federal_tax_id).trim() || null;

      const payload: SupplierInput = {
        company_db: session.companyDB,
        card_code: cardCode || null,
        card_name: form.card_name.trim(),
        card_type: "S",
        federal_tax_id: taxIdNormalized,
        u_fgr_taxid0: ufgrNormalized,
        email: form.email || null,
        phone1: form.phone1 || null,
        phone2: form.phone2 || null,
        currency: form.currency,
        bill_to_street: form.bill_to_street || null,
        bill_to_zip: form.bill_to_zip || null,
        bill_to_city: form.bill_to_city || null,
        bill_to_state: form.bill_to_state || null,
        bill_to_country: (form.bill_to_country || "BR").toUpperCase(),
        bill_to_block: form.bill_to_block || null,
        bill_to_building: form.bill_to_building || null,
        is_active: editing ? editing.is_active : true,
        source: editing ? editing.source : source,
      };

      const saved = editing
        ? await updateSupplier(editing.id, payload, session, editing.card_code)
        : await createSupplier(payload, session);

      if (saved.sap_sync_status === "error") {
        const parsed = parseSapError(saved.sap_sync_error || "");
        toast.warning(`Salvo localmente — ${parsed.title}`, {
          description: parsed.description,
          duration: 8000,
        });
      } else {
        toast.success(editing ? "Fornecedor atualizado" : "Fornecedor cadastrado");
      }
      onSaved(saved);
      onClose();
    } catch (e) {
      const parsed = parseSapError(e);
      toast.error(parsed.title, {
        description: parsed.description,
        duration: 8000,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !submitting && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {prefill && !editing ? <Sparkles className="w-5 h-5 text-primary" /> : null}
            {editing ? "Editar Fornecedor" : "Novo Fornecedor"}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? "Alterações serão sincronizadas com o SAP."
              : "O fornecedor será criado no SAP B1 e armazenado localmente."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
          <div className="md:col-span-2 grid grid-cols-3 gap-4">
            <div>
              <Label>CardCode</Label>
              <Input
                value={loadingCode ? "Buscando..." : cardCode}
                onChange={(e) => setCardCode(e.target.value)}
                disabled={!!editing}
                placeholder="Auto"
              />
            </div>
            <div>
              <Label>Tipo</Label>
              <Input value="Fornecedor (S)" disabled />
            </div>
            <div>
              <Label>Moeda *</Label>
              <Select value={form.currency} onValueChange={(v) => set("currency", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="BRL">BRL</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                  <SelectItem value="CAD">CAD</SelectItem>
                  <SelectItem value="##">## (multimoeda)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="md:col-span-2">
            <Label>Razão Social / Nome *</Label>
            <Input value={form.card_name} onChange={(e) => set("card_name", e.target.value)} maxLength={200} />
          </div>

          {(() => {
            const country = getCountry(form.bill_to_country);
            const foreign = isForeign(form.bill_to_country);
            return (
              <>
                <div>
                  <Label>{country.tax_id_label} *</Label>
                  <Input
                    value={form.federal_tax_id}
                    onChange={(e) => set("federal_tax_id", e.target.value)}
                    placeholder={foreign ? country.tax_id_label : "Apenas dígitos"}
                  />
                </div>
                <div>
                  <Label>U_FGR_TAXID0</Label>
                  <Input
                    value={form.u_fgr_taxid0}
                    onChange={(e) => set("u_fgr_taxid0", e.target.value)}
                    placeholder={foreign ? `${country.tax_id_label} (auto)` : "CNPJ/CPF (auto)"}
                  />
                </div>

                <div>
                  <Label>Email</Label>
                  <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
                </div>
                <div>
                  <Label>Telefone 1</Label>
                  <Input
                    value={form.phone1}
                    onChange={(e) => set("phone1", e.target.value)}
                    placeholder={foreign ? "+1 555 000 0000" : "(11) 0000-0000"}
                  />
                </div>
                <div>
                  <Label>Telefone 2</Label>
                  <Input
                    value={form.phone2}
                    onChange={(e) => set("phone2", e.target.value)}
                    placeholder={foreign ? "+1 555 000 0000" : "(11) 0000-0000"}
                  />
                </div>

                <div className="md:col-span-2 pt-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground">Endereço (cobrança = entrega)</p>
                  {foreign && (
                    <span className="text-[10px] uppercase tracking-wider text-primary font-semibold px-2 py-0.5 rounded bg-primary/10">
                      Internacional
                    </span>
                  )}
                </div>

                <div>
                  <Label>País *</Label>
                  <Select value={form.bill_to_country} onValueChange={handleCountryChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      {COUNTRIES.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          {c.name} ({c.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{country.zip_label}</Label>
                  <Input
                    value={form.bill_to_zip}
                    onChange={(e) => set("bill_to_zip", e.target.value)}
                    placeholder={foreign ? "" : "Digite o CEP para autocompletar"}
                  />
                </div>

                <div className="md:col-span-2">
                  <Label>{foreign ? "Endereço (linha 1)" : "Logradouro"}</Label>
                  <Input value={form.bill_to_street} onChange={(e) => set("bill_to_street", e.target.value)} />
                </div>
                <div>
                  <Label>{foreign ? "Endereço (linha 2)" : "Número/Compl."}</Label>
                  <Input value={form.bill_to_building} onChange={(e) => set("bill_to_building", e.target.value)} />
                </div>
                <div>
                  <Label>{foreign ? "Distrito" : "Bairro"}</Label>
                  <Input value={form.bill_to_block} onChange={(e) => set("bill_to_block", e.target.value)} />
                </div>
                <div>
                  <Label>Cidade</Label>
                  <Input value={form.bill_to_city} onChange={(e) => set("bill_to_city", e.target.value)} />
                </div>
                <div>
                  <Label>{country.state_label}</Label>
                  <Input
                    maxLength={foreign ? 60 : 2}
                    value={form.bill_to_state}
                    onChange={(e) =>
                      set("bill_to_state", foreign ? e.target.value : e.target.value.toUpperCase())
                    }
                  />
                </div>
              </>
            );
          })()}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            {editing ? "Salvar" : "Cadastrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
