import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Box, Plus, Search, RefreshCw, Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ThemeToggle } from "@/components/ThemeToggle";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

type ItemBase = {
  id: string;
  tipo: "produto" | "servico";
  ncm: string | null;
  codigo_servico: string | null;
  grupo: string | null;
  unidade: string | null;
};

type Variante = {
  id: string;
  item_base_id: string;
  sequencial: number;
  descricao: string;
  codigo_completo: string;
  created_at: string;
  item_base: ItemBase;
};

export default function CadastroItens() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [rows, setRows] = useState<Variante[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [openNew, setOpenNew] = useState(false);
  const [openVariant, setOpenVariant] = useState<ItemBase | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("item_variante")
      .select("*, item_base:item_base_id(*)")
      .order("codigo_completo", { ascending: true })
      .limit(1000);
    if (error) toast.error(error.message);
    setRows((data ?? []) as any);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.codigo_completo.toLowerCase().includes(q) ||
        r.descricao.toLowerCase().includes(q) ||
        (r.item_base?.ncm ?? "").includes(q) ||
        (r.item_base?.codigo_servico ?? "").includes(q),
    );
  }, [rows, search]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")} className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="p-2 rounded-lg bg-primary/10">
              <Box className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Cadastro de Itens</h1>
              <p className="text-xs text-muted-foreground">Item-base + variantes de descrição (NCM / Código de Serviço)</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <button onClick={signOut} className="text-xs text-muted-foreground hover:text-foreground">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[260px]">
            <Label className="text-xs text-muted-foreground mb-1 block">Buscar</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Código, descrição, NCM, código de serviço..."
                className="pl-9 bg-card"
              />
            </div>
          </div>
          <Button variant="outline" onClick={load} disabled={loading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button onClick={() => setOpenNew(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            Novo item
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2 max-w-7xl mx-auto">
          Total: {rows.length} · Exibindo: {filtered.length}
        </p>
      </div>

      <main className="flex-1 px-6 py-6">
        <div className="max-w-7xl mx-auto glass-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Chave Fiscal</TableHead>
                <TableHead>Grupo</TableHead>
                <TableHead>Unid.</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && !loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                    Nenhum item encontrado.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.codigo_completo}</TableCell>
                    <TableCell className="font-medium">{r.descricao}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{r.item_base?.tipo}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.item_base?.tipo === "produto" ? r.item_base?.ncm : r.item_base?.codigo_servico}
                    </TableCell>
                    <TableCell className="text-xs">{r.item_base?.grupo ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.item_base?.unidade ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setOpenVariant(r.item_base)}>
                        + Variante
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </main>

      <NewItemDialog
        open={openNew}
        onClose={() => setOpenNew(false)}
        onSaved={() => {
          setOpenNew(false);
          load();
        }}
      />
      <NewVariantDialog
        base={openVariant}
        onClose={() => setOpenVariant(null)}
        onSaved={() => {
          setOpenVariant(null);
          load();
        }}
      />
    </div>
  );
}

function NewItemDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
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
        tipo === "produto" ? await q.eq("ncm", ncm).maybeSingle() : await q.eq("codigo_servico", codigoServico).maybeSingle();
      if (e1) throw e1;
      let row = existing as ItemBase | null;
      if (!row) {
        const payload: any = { tipo, grupo: grupo || null, unidade: unidade || null };
        if (tipo === "produto") payload.ncm = ncm;
        else payload.codigo_servico = codigoServico;
        const { data: created, error: e2 } = await supabase.from("item_base").insert(payload).select("*").single();
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
      const { error } = await supabase.rpc("create_item_variante", {
        p_item_base_id: base.id,
        p_descricao: descricao.trim(),
      });
      if (error) throw error;
      toast.success("Variante criada");
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
              : "Apenas a descrição muda entre variantes do mesmo item-base."}
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="produto">Produto (NCM)</SelectItem>
                  <SelectItem value="servico">Serviço (Código de Serviço)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {tipo === "produto" ? (
              <div className="grid gap-2">
                <Label>NCM (8 dígitos)</Label>
                <Input value={ncm} onChange={(e) => setNcm(e.target.value.replace(/\D/g, ""))} maxLength={8} placeholder="84713019" />
              </div>
            ) : (
              <div className="grid gap-2">
                <Label>Código de Serviço (ex: 1.05)</Label>
                <Input value={codigoServico} onChange={(e) => setCodigoServico(e.target.value)} placeholder="1.05" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Grupo</Label>
                <Input value={grupo} onChange={(e) => setGrupo(e.target.value)} placeholder="Opcional" />
              </div>
              <div className="grid gap-2">
                <Label>Unidade</Label>
                <Input value={unidade} onChange={(e) => setUnidade(e.target.value)} placeholder="UN, PC, HR..." />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Se um item-base com essa chave já existir, os campos compartilhados (grupo, unidade) serão mantidos como estão.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 py-2">
            <div className="rounded-md border border-border p-3 text-xs space-y-1">
              <div><b>Tipo:</b> {base?.tipo}</div>
              <div><b>Chave fiscal:</b> {base?.tipo === "produto" ? base?.ncm : base?.codigo_servico}</div>
              <div><b>Grupo:</b> {base?.grupo ?? "—"} · <b>Unidade:</b> {base?.unidade ?? "—"}</div>
              <div><b>Código previsto:</b> <span className="font-mono">{previewCode}</span></div>
            </div>
            <div className="grid gap-2">
              <Label>Descrição da variante</Label>
              <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Descrição que aparece nas notas" autoFocus />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          {step === 1 ? (
            <Button onClick={lookupOrCreate} disabled={busy} className="gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Avançar
            </Button>
          ) : (
            <Button onClick={save} disabled={busy} className="gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Salvar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewVariantDialog({
  base,
  onClose,
  onSaved,
}: {
  base: ItemBase | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [descricao, setDescricao] = useState("");
  const [previewCode, setPreviewCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDescricao("");
    setPreviewCode("");
    if (!base) return;
    (async () => {
      const { data, error } = await supabase.rpc("preview_next_codigo", { p_item_base_id: base.id });
      if (error) toast.error(error.message);
      else setPreviewCode(data as string);
    })();
  }, [base]);

  const save = async () => {
    if (!base) return;
    if (!descricao.trim()) {
      toast.error("Descrição obrigatória");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.rpc("create_item_variante", {
        p_item_base_id: base.id,
        p_descricao: descricao.trim(),
      });
      if (error) throw error;
      toast.success("Variante criada");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || "Falha");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!base} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova variante</DialogTitle>
          <DialogDescription>Cadastrar nova descrição para o mesmo item-base.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="rounded-md border border-border p-3 text-xs space-y-1">
            <div><b>Tipo:</b> {base?.tipo}</div>
            <div><b>Chave fiscal:</b> {base?.tipo === "produto" ? base?.ncm : base?.codigo_servico}</div>
            <div><b>Código previsto:</b> <span className="font-mono">{previewCode}</span></div>
          </div>
          <div className="grid gap-2">
            <Label>Descrição</Label>
            <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} autoFocus />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={save} disabled={busy} className="gap-2">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
