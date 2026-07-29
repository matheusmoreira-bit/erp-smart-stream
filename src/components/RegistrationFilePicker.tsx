import { useRef } from "react";
import { Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { formatFileSize, validateRegistrationFile } from "@/lib/registration-attachments";

export function RegistrationFilePicker({
  files,
  onChange,
  disabled,
  label = "Anexar documentos",
  hint = "Comprovante bancário, ficha cadastral, cartão CNPJ… (PDF, imagem, planilha ou XML, até 15MB cada)",
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  label?: string;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const add = (list: FileList | null) => {
    if (!list?.length) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      const problem = validateRegistrationFile(f);
      if (problem) {
        toast.error(problem);
        continue;
      }
      if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    }
    onChange(next);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          <Paperclip className="w-4 h-4" />
          Selecionar arquivos
        </Button>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.docx,.doc,.csv,.xml"
        onChange={(e) => add(e.target.files)}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((f) => (
            <li
              key={`${f.name}-${f.size}`}
              className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
            >
              <Paperclip className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate flex-1">{f.name}</span>
              <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(f.size)}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                disabled={disabled}
                aria-label={`Remover ${f.name}`}
                onClick={() => onChange(files.filter((x) => !(x.name === f.name && x.size === f.size)))}
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default RegistrationFilePicker;
