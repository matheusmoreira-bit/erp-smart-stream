import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";
import { useSapCachedList } from "@/hooks/useSapCachedList";
import { createItem } from "@/hooks/useItems";

type ItemBase = {
  id: string;
  tipo: "produto" | "servico";
  ncm: string | null;
  codigo_servico: string | null;
  grupo: string | null;
  unidade: string | null;
};

/**
 * Wizard "Novo Item" used inside /items.
 * Step 1: Tipo + NCM/Código de Serviço + Grupo + Unidade.
 * Step 2: Descrição da variante.
 * On save: creates item_base (if needed) + item_variante (local) and immediately POSTs
 * the resulting code to SAP B1 Items. If SAP fails, the local variante still exists.
 */
export function NewItemWizardDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { session } = useSap();
  const [step, setStep] = useState<1 | 2>(1);
  const [tipo, setTipo] = useState<"produto" | "servico">("produto");
  const [ncm, setNcm] = useState("");
  const [codigoServico, setCodigoServico] = useState("");
  const [grupo, setGrupo] = useState("");
  const [unidade, setUnidade] = useState("UN");
  const [base, setBase] = useState<ItemBase | null>(null);
  const [descricao, setDescricao] = useState("");
  const [previewCode, setPreviewCode] = useState("");
  const [busy, setBusy] = useState(false);

  const { options: groupOptions, isLoading: groupsLoading } = useSapCachedList({
    cacheKey: "item_groups",
    endpoint: "ItemGroups",
    params: { $select: "Number,GroupName", $orderby: "GroupName" },
    mapRow: (r: any) => ({ code: String(r.Number), name: r.GroupName }),
    enabled: open,
  });

  useEffect(() => {
    if (!open) {
      setStep(1);
      setTipo("produto");
      setNcm("");
      setCodigoServico("");
      setGrupo("");
      setUnidade("UN");
      setBase(null);
      setDescricao("");
      setPreviewCode("");
    }
  }, [open]);

  const lookupOrCreate = async () => {
    setBusy(true);
    try {
      if (tipo === "produto" && !/^\d{8}$/.test(ncm)) {
        toast.error("NCM deve ter exatamente 8 dígitos");
        return;
      }
      if (tipo === "servico" && !/^\d+(\.\d+)+$/.test(codigoServico)) {
        toast.error("Código de Serviço deve estar no formato com pontos, ex: 1.05");
        return;
      }
      const q = supabase.from("item_base").select("*").eq("tipo", tipo);
      const { data: existing, error: e1 } =
        tipo === "produto"
          ? await q.eq("ncm", ncm).maybeSingle()
          : await q.eq("codigo_servico", codigoServico).maybeSingle();
      if (e1) throw e1;
      let row = existing as ItemBase | null;
      if (!row) {
        const payload: any = { tipo, grupo: grupo || null, unidade: unidade || null };
        if (tipo === "produto") payload.ncm = ncm;
        else payload.codigo_servico = codigoServico;
        const { data: created, error: e2 } = await supabase
          .from("item_base")
          .insert(payload)
          .select("*")
          .single();
        if (e2) throw e2;
        row = created as ItemBase;
      }
      setBase(row);
      const { data: prev, error: e3 } = await supabase.rpc("preview_next_codigo", { p_item_base_id: row.id });
      if (e3) throw e3;
      setPreviewCode(prev as string);
      setStep(2);
    } catch (e: any) {
      toast.error(e?.message || "Falha ao preparar item-base");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!base) return;
    if (!descricao.trim()) {
      toast.error("Descrição obrigatória");
      return;
    }
    setBusy(true);
    try {
      const { data: varianteData, error } = await supabase.rpc("create_item_variante", {
        p_item_base_id: base.id,
        p_descricao: descricao.trim(),
      });
      if (error) throw error;
      const v: any = Array.isArray(varianteData) ? varianteData[0] : varianteData;
      if (!v?.codigo_completo) throw new Error("Variante criada, mas sem código retornado");
      toast.success("Variante criada", { description: `Código: ${v.codigo_completo}` });

      if (!session) {
        toast.warning("Sem sessão SAP — não foi enviado ao SAP", {
          description: "Faça login no ERP para sincronizar.",
        });
        onSaved();
        return;
      }
      try {
        await createItem(
          {
            item_code: v.codigo_completo,
            item_name: v.descricao,
            items_group_code: base.grupo ? Number(base.grupo) : null,
            is_active: true,
          },
          session,
        );
        toast.success("Enviado ao SAP", { description: `ItemCode ${v.codigo_completo}` });
      } catch (sapErr: any) {
        toast.error("Falha ao enviar ao SAP", {
          description: sapErr?.message || "Tente reenviar pela lista.",
        });
      }
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || "Falha ao salvar variante");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{step === 1 ? "Novo item — Passo 1" : "Novo item — Passo 2"}</DialogTitle>
          <DialogDescription>
            {step === 1
              ? "Tipo e chave fiscal. Se já houver item-base, ele será reaproveitado."
              : "Apenas a descrição muda entre variantes do mesmo item-base. O código será criado no SAP automaticamente."}
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="produto">Produto (NCM)</SelectItem>
                  <SelectItem value="servico">Serviço (Código de Serviço)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {tipo === "produto" ? (
              <div className="grid gap-2">
                <Label>NCM (8 dígitos)</Label>
                <Input
                  value={ncm}
                  onChange={(e) => setNcm(e.target.value.replace(/\D/g, ""))}
                  maxLength={8}
                  placeholder="84713019"
                />
              </div>
            ) : (
              <div className="grid gap-2">
                <Label>Código de Serviço (ex: 1.05)</Label>
                <Input
                  value={codigoServico}
                  onChange={(e) => setCodigoServico(e.target.value)}
                  placeholder="1.05"
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Grupo (SAP)</Label>
                <Select value={grupo} onValueChange={setGrupo} disabled={groupsLoading}>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        groupsLoading
                          ? "Carregando..."
                          : groupOptions.length
                            ? "Selecionar grupo"
                            : "Sem grupos em cache"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {groupOptions.map((g) => (
                      <SelectItem key={g.code} value={g.code}>
                        {g.name} — {g.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Unidade</Label>
                <Input
                  value={unidade}
                  onChange={(e) => setUnidade(e.target.value)}
                  placeholder="UN, PC, HR..."
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Se um item-base com essa chave já existir, os campos compartilhados (grupo, unidade)
              serão mantidos como estão.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 py-2">
            <div className="rounded-md border border-border p-3 text-xs space-y-1">
              <div>
                <b>Tipo:</b> {base?.tipo}
              </div>
              <div>
                <b>Chave fiscal:</b> {base?.tipo === "produto" ? base?.ncm : base?.codigo_servico}
              </div>
              <div>
                <b>Grupo:</b> {base?.grupo ?? "—"} · <b>Unidade:</b> {base?.unidade ?? "—"}
              </div>
              <div>
                <b>Código previsto:</b> <span className="font-mono">{previewCode}</span>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Descrição da variante</Label>
              <Input
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder="Descrição que aparece nas notas"
                autoFocus
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          {step === 1 ? (
            <Button onClick={lookupOrCreate} disabled={busy} className="gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Avançar
            </Button>
          ) : (
            <Button onClick={save} disabled={busy} className="gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Salvar e enviar ao SAP
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
