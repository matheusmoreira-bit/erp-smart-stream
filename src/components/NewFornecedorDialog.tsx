import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import type { SapSession } from "@/lib/sap-client";
import { syncFornecedorToSap } from "@/lib/promote-fornecedor";

const digits = (s: string) => (s || "").replace(/\D+/g, "");

/**
 * "Novo Fornecedor" with CNPJ → Receita Federal lookup (PJ) or manual (PF).
 * On save:
 *  1. Persists the record in the `fornecedores` table via the `fornecedor-save` function.
 *  2. Immediately tries to push it to the active company's SAP (when a session exists).
 *
 * Shared between `/suppliers` and `/cadastros/fornecedores` (route legacy).
 */
export function NewFornecedorDialog({
  open,
  session,
  onClose,
  onSaved,
}: {
  open: boolean;
  session: SapSession | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tipo, setTipo] = useState<"pj" | "pf">("pj");
  const [cnpj, setCnpj] = useState("");
  const [form, setForm] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!open) {
      setTipo("pj");
      setCnpj("");
      setForm({});
      setHydrated(false);
    }
  }, [open]);

  const buscarCnpj = async () => {
    const d = digits(cnpj);
    if (d.length !== 14) {
      toast.error("CNPJ deve ter 14 dígitos");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("cnpj-lookup", { body: { cnpj: d } });
      if (error) throw error;
      if (data?.exists) {
        setForm(data.fornecedor ?? {});
        setHydrated(true);
        toast.warning("Fornecedor já cadastrado localmente", {
          description: "Você pode revisar e enviar ao SAP da empresa ativa.",
        });
        return;
      }
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      setForm(data?.data ?? {});
      setHydrated(true);
      toast.success("Dados carregados da Receita");
    } catch (e: any) {
      toast.error(e?.message || "Falha ao consultar CNPJ");
    } finally {
      setBusy(false);
    }
  };

  const afterSave = async (data: any) => {
    const fornecedor = data?.fornecedor;
    const existed = !!data?.existed;
    if (existed) {
      toast.message("Fornecedor já existia localmente", {
        description: "Tentando enviar ao SAP da empresa ativa…",
      });
    } else {
      toast.success("Fornecedor cadastrado");
    }
    if (!session?.companyDB) {
      toast.warning("Sem sessão SAP ativa — não foi enviado ao SAP", {
        description: "Faça login no ERP para sincronizar.",
      });
      onSaved();
      return;
    }
    const result = await syncFornecedorToSap(fornecedor, session);
    if (result.ok && result.skipped) {
      toast.info("Já existia no SAP", { description: result.message });
    } else if (result.ok) {
      toast.success("Enviado ao SAP", { description: result.message });
    } else {
      toast.error("Falha ao enviar ao SAP", { description: result.message });
    }
    onSaved();
  };

  const salvarPj = async () => {
    if (!hydrated) {
      toast.error("Busque o CNPJ primeiro");
      return;
    }
    setBusy(true);
    try {
      const payload = { ...form, tipo_pessoa: "pj", cnpj: digits(form.cnpj || cnpj) };
      const { data, error } = await supabase.functions.invoke("fornecedor-save", { body: { payload } });
      if (error) {
        const msg = (data as any)?.error || error.message || "Falha ao cadastrar";
        toast.error(msg);
        return;
      }
      if ((data as any)?.error) {
        toast.error((data as any).error);
        return;
      }
      await afterSave(data);
    } finally {
      setBusy(false);
    }
  };

  const salvarPf = async () => {
    const d = digits(form.cpf || "");
    if (d.length !== 11) {
      toast.error("CPF deve ter 11 dígitos");
      return;
    }
    if (!form.razao_social?.trim()) {
      toast.error("Nome obrigatório");
      return;
    }
    setBusy(true);
    try {
      const payload = { ...form, tipo_pessoa: "pf", cpf: d };
      const { data, error } = await supabase.functions.invoke("fornecedor-save", { body: { payload } });
      if (error) {
        const msg = (data as any)?.error || error.message || "Falha ao cadastrar";
        toast.error(msg);
        return;
      }
      if ((data as any)?.error) {
        toast.error((data as any).error);
        return;
      }
      await afterSave(data);
    } finally {
      setBusy(false);
    }
  };

  const field = (key: string, label: string, opts: { type?: string; col?: number } = {}) => (
    <div className={`grid gap-1 ${opts.col === 2 ? "col-span-2" : ""}`}>
      <Label className="text-xs">{label}</Label>
      <Input
        type={opts.type ?? "text"}
        value={form[key] ?? ""}
        onChange={(e) => setForm((f: any) => ({ ...f, [key]: e.target.value }))}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo Fornecedor</DialogTitle>
          <DialogDescription>
            PJ via CNPJ (Receita Federal) ou PF manual — sem campos bancários.
            Ao salvar, é enviado para o SAP da empresa ativa.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>Tipo de pessoa</Label>
            <Select
              value={tipo}
              onValueChange={(v) => {
                setTipo(v as any);
                setForm({});
                setHydrated(false);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pj">Pessoa Jurídica (busca por CNPJ)</SelectItem>
                <SelectItem value="pf">Pessoa Física (manual)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {tipo === "pj" ? (
            <>
              <div className="flex gap-2 items-end">
                <div className="flex-1 grid gap-1">
                  <Label className="text-xs">CNPJ</Label>
                  <Input
                    value={cnpj}
                    onChange={(e) => setCnpj(e.target.value)}
                    placeholder="00.000.000/0000-00"
                  />
                </div>
                <Button onClick={buscarCnpj} disabled={busy} className="gap-2">
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  Buscar dados
                </Button>
              </div>
              {hydrated && (
                <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
                  {field("razao_social", "Razão Social", { col: 2 })}
                  {field("nome_fantasia", "Nome Fantasia", { col: 2 })}
                  {field("tipo_estabelecimento", "Tipo")}
                  {field("situacao_cadastral", "Situação")}
                  {field("data_inicio_atividade", "Início Atividade", { type: "date" })}
                  {field("porte", "Porte")}
                  {field("natureza_juridica_descricao", "Natureza Jurídica", { col: 2 })}
                  {field("capital_social", "Capital Social", { type: "number" })}
                  {field("cnae_principal_codigo", "CNAE Principal")}
                  {field("cnae_principal_descricao", "Descrição CNAE Principal", { col: 2 })}
                  {field("logradouro", "Logradouro", { col: 2 })}
                  {field("numero", "Número")}
                  {field("complemento", "Complemento")}
                  {field("bairro", "Bairro")}
                  {field("cep", "CEP")}
                  {field("municipio", "Município")}
                  {field("uf", "UF")}
                  {field("pais", "País")}
                  {field("telefone1", "Telefone 1")}
                  {field("telefone2", "Telefone 2")}
                  {field("email", "E-mail", { col: 2 })}
                  {field("inscricao_estadual", "Inscrição Estadual", { col: 2 })}
                </div>
              )}
            </>
          ) : (
            <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
              {field("cpf", "CPF (somente dígitos)")}
              {field("razao_social", "Nome completo", { col: 2 })}
              {field("logradouro", "Logradouro", { col: 2 })}
              {field("numero", "Número")}
              {field("complemento", "Complemento")}
              {field("bairro", "Bairro")}
              {field("cep", "CEP")}
              {field("municipio", "Município")}
              {field("uf", "UF")}
              {field("telefone1", "Telefone 1")}
              {field("telefone2", "Telefone 2")}
              {field("email", "E-mail", { col: 2 })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={tipo === "pj" ? salvarPj : salvarPf} disabled={busy} className="gap-2">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
