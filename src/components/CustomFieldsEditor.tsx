import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface CustomField {
  name: string;
  value: string;
  scope: "header" | "line";
}

interface Props {
  value: string; // JSON string or empty
  onChange: (jsonString: string) => void;
}

function parseFields(raw: string): CustomField[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((f) => f && typeof f.name === "string")
      .map((f) => ({
        name: String(f.name),
        value: String(f.value ?? ""),
        scope: f.scope === "line" ? "line" : "header",
      }));
  } catch {
    return [];
  }
}

export function CustomFieldsEditor({ value, onChange }: Props) {
  const [fields, setFields] = useState<CustomField[]>(() => parseFields(value));

  // Re-sync when parent value changes (e.g., dialog reopens)
  useEffect(() => {
    setFields(parseFields(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const update = (next: CustomField[]) => {
    setFields(next);
    const cleaned = next.filter((f) => f.name.trim());
    onChange(cleaned.length ? JSON.stringify(cleaned) : "");
  };

  const addField = () =>
    update([...fields, { name: "", value: "", scope: "header" }]);

  const removeField = (idx: number) =>
    update(fields.filter((_, i) => i !== idx));

  const patch = (idx: number, partial: Partial<CustomField>) =>
    update(fields.map((f, i) => (i === idx ? { ...f, ...partial } : f)));

  return (
    <div className="space-y-3 col-span-full">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm">Campos Customizados (UDFs)</Label>
          <p className="text-xs text-muted-foreground">
            Valores padrão injetados no Pedido de Compra. Use prefixo <code className="text-xs">U_</code> para UDFs SAP.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addField} className="gap-1.5">
          <Plus className="w-3.5 h-3.5" />
          Adicionar
        </Button>
      </div>

      {fields.length === 0 && (
        <div className="text-xs text-muted-foreground bg-muted/30 border border-dashed border-border rounded-lg p-3 text-center">
          Nenhum campo customizado configurado.
        </div>
      )}

      {fields.map((field, idx) => (
        <div
          key={idx}
          className="grid grid-cols-12 gap-2 items-end bg-muted/20 p-3 rounded-lg border border-border"
        >
          <div className="col-span-4 space-y-1">
            <Label className="text-xs text-muted-foreground">Nome do campo</Label>
            <Input
              placeholder="U_Filial"
              value={field.name}
              onChange={(e) => patch(idx, { name: e.target.value })}
              className="bg-card h-9"
            />
          </div>
          <div className="col-span-4 space-y-1">
            <Label className="text-xs text-muted-foreground">Valor padrão</Label>
            <Input
              placeholder="01"
              value={field.value}
              onChange={(e) => patch(idx, { value: e.target.value })}
              className="bg-card h-9"
            />
          </div>
          <div className="col-span-3 space-y-1">
            <Label className="text-xs text-muted-foreground">Escopo</Label>
            <Select
              value={field.scope}
              onValueChange={(v: "header" | "line") => patch(idx, { scope: v })}
            >
              <SelectTrigger className="bg-card h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="header">Cabeçalho</SelectItem>
                <SelectItem value="line">Linha</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-1 flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => removeField(idx)}
              className="text-destructive hover:text-destructive h-9 w-9"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
