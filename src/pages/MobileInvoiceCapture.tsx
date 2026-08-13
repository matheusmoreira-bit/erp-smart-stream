import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Camera, ChevronLeft, Loader2, ScanLine, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { DateInputBR } from "@/components/DateInputBR";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";
import { useExpenses } from "@/hooks/useExpenses";
import { useIsMobile } from "@/hooks/use-mobile";
import { CreateExpenseModal } from "@/components/CreateExpenseModal";

/**
 * Captura de nota por foto/OCR — exclusivo para celular.
 * A foto é enviada ao edge function `expense-ocr-capture` (IA server-side),
 * que devolve fornecedor, valor e vencimento para conferência do usuário
 * antes de abrir o formulário de lançamento já pré-preenchido.
 */

type Extracted = {
  supplier_name: string | null;
  supplier_tax_id: string | null;
  doc_number: string | null;
  amount: number | null;
  currency: string;
  doc_date: string | null;
  due_date: string | null;
  description: string | null;
  confidence: number | null;
};

const MAX_BYTES = 8 * 1024 * 1024;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function MobileInvoiceCapture() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { session } = useSap();
  const { createExpense } = useExpenses("purchase");

  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [data, setData] = useState<Extracted | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const reset = () => {
    setFile(null);
    setData(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
  };

  const handlePick = async (picked: File | undefined) => {
    if (!picked) return;
    if (picked.size > MAX_BYTES) {
      toast.error("Imagem muito grande (máx. 8MB). Tire a foto com resolução menor.");
      return;
    }
    reset();
    setFile(picked);
    setPreviewUrl(URL.createObjectURL(picked));
    setReading(true);
    try {
      const dataUrl = await fileToDataUrl(picked);
      const { data: res, error } = await supabase.functions.invoke("expense-ocr-capture", {
        body: { image: dataUrl },
      });
      if (error) throw error;
      if (!res?.ok) throw new Error(res?.message || res?.error || "Falha na leitura");
      setData(res.data as Extracted);
      toast.success("Documento lido. Confira os campos antes de lançar.");
    } catch (e: any) {
      console.error("[ocr-capture]", e);
      toast.error(e?.message || "Não consegui ler o documento. Tente outra foto.");
    } finally {
      setReading(false);
    }
  };

  const update = (patch: Partial<Extracted>) => setData((d) => (d ? { ...d, ...patch } : d));

  if (!isMobile) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
        <ScanLine className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Captura por foto é exclusiva do celular</h1>
        <p className="text-sm text-muted-foreground">
          Abra esta tela pelo aplicativo instalado no celular para fotografar a nota.
        </p>
        <Button variant="outline" onClick={() => navigate("/despesas")}>Ir para lançamentos</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-3 py-3 backdrop-blur">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Voltar">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-base font-semibold leading-tight">Captura de nota</h1>
          <p className="text-xs text-muted-foreground">Foto + leitura automática</p>
        </div>
      </header>

      <main className="space-y-4 p-3">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            void handlePick(e.target.files?.[0]);
            e.currentTarget.value = "";
          }}
        />

        {!previewUrl && (
          <Card className="flex flex-col items-center gap-3 p-6 text-center">
            <ScanLine className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Fotografe a nota, boleto ou recibo. Vamos pré-preencher fornecedor, valor e vencimento.
            </p>
            <Button className="w-full" onClick={() => inputRef.current?.click()}>
              <Camera className="mr-2 h-4 w-4" /> Tirar foto
            </Button>
          </Card>
        )}

        {previewUrl && (
          <Card className="overflow-hidden">
            <img src={previewUrl} alt="Pré-visualização do documento fotografado" className="max-h-64 w-full object-contain bg-muted" />
            <div className="flex items-center justify-between gap-2 p-3">
              <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={reading}>
                <RotateCcw className="mr-2 h-4 w-4" /> Nova foto
              </Button>
              {data?.confidence != null && (
                <Badge variant={data.confidence >= 0.75 ? "secondary" : "destructive"}>
                  Confiança {Math.round(data.confidence * 100)}%
                </Badge>
              )}
            </div>
          </Card>
        )}

        {reading && (
          <Card className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Lendo o documento…
          </Card>
        )}

        {data && !reading && (
          <Card className="space-y-3 p-4">
            <div className="space-y-1">
              <Label htmlFor="ocr-supplier">Fornecedor</Label>
              <Input
                id="ocr-supplier"
                value={data.supplier_name ?? ""}
                onChange={(e) => update({ supplier_name: e.target.value })}
                placeholder="Razão social"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="ocr-amount">Valor</Label>
                <Input
                  id="ocr-amount"
                  inputMode="decimal"
                  value={data.amount ?? ""}
                  onChange={(e) => update({ amount: e.target.value === "" ? null : Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ocr-due">Vencimento</Label>
                <DateInputBR
                  id="ocr-due"
                  value={data.due_date ?? ""}
                  onChange={(v) => update({ due_date: v || null })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="ocr-cnpj">CNPJ/CPF</Label>
                <Input
                  id="ocr-cnpj"
                  inputMode="numeric"
                  value={data.supplier_tax_id ?? ""}
                  onChange={(e) => update({ supplier_tax_id: e.target.value.replace(/\D+/g, "") || null })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ocr-doc">Nº documento</Label>
                <Input
                  id="ocr-doc"
                  value={data.doc_number ?? ""}
                  onChange={(e) => update({ doc_number: e.target.value || null })}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Confira os dados: a leitura é automática e pode conter erros.
            </p>
            <Button className="w-full" onClick={() => setShowCreate(true)}>
              Continuar lançamento
            </Button>
          </Card>
        )}
      </main>

      <CreateExpenseModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={async (input) => {
          const result = await createExpense(input as any) as any;
          if (!result?.queued) toast.success("Lançamento criado a partir da foto.");
          setShowCreate(false);
          reset();
          navigate("/aprovacoes/mobile");
          return result;
        }}
        sapSession={session}
        mode="purchase"
        title="Novo lançamento (foto)"
        prefill={{
          description: [data?.supplier_name, data?.doc_number ? `NF ${data.doc_number}` : null, data?.description]
            .filter(Boolean)
            .join(" — ") || undefined,
          amount: data?.amount ?? undefined,
          currency: data?.currency || "BRL",
        }}
        initialFiles={file ? [file] : null}
      />
    </div>
  );
}
