import { forwardRef, useEffect, useState } from "react";
import { CalendarIcon } from "lucide-react";
import { ptBR } from "date-fns/locale";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type InputProps = React.ComponentProps<typeof Input>;

interface DateInputBRProps extends Omit<InputProps, "value" | "onChange" | "type"> {
  /** Valor no formato ISO yyyy-MM-dd (como <input type="date">). */
  value: string;
  /** Recebe o valor no formato ISO yyyy-MM-dd (ou "" se inválido/incompleto). */
  onChange: (value: string) => void;
}

/**
 * Input de data com máscara fixa dd/MM/yyyy + datepicker (calendário),
 * independente do locale do navegador.
 *
 * O <input type="date"> nativo exibe a data conforme o locale do sistema/navegador,
 * o que faz alguns usuários verem MM/dd/yyyy. Este componente mantém o valor no
 * mesmo contrato (ISO yyyy-MM-dd) mas garante exibição pt-BR em qualquer máquina.
 */
export const DateInputBR = forwardRef<HTMLInputElement, DateInputBRProps>(
  ({ value, onChange, onBlur, placeholder = "dd/mm/aaaa", className, disabled, ...rest }, ref) => {
    const [text, setText] = useState<string>(() => isoToBr(value));
    const [open, setOpen] = useState(false);

    useEffect(() => {
      const iso = brToIso(text);
      if (iso !== value) setText(isoToBr(value));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value.replace(/\D/g, "").slice(0, 8);
      let masked = raw;
      if (raw.length > 4) masked = `${raw.slice(0, 2)}/${raw.slice(2, 4)}/${raw.slice(4)}`;
      else if (raw.length > 2) masked = `${raw.slice(0, 2)}/${raw.slice(2)}`;
      setText(masked);
      const iso = brToIso(masked);
      if (iso !== value) onChange(iso);
    };

    const selected = isoToDate(value);

    return (
      <div className="relative">
        <Input
          {...rest}
          ref={ref}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder={placeholder}
          disabled={disabled}
          className={cn("pr-9", className)}
          value={text}
          onChange={handleChange}
          onBlur={(e) => {
            const iso = brToIso(text);
            if (!iso && text) setText("");
            onBlur?.(e);
          }}
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled}
              aria-label="Abrir calendário"
              className="absolute right-0 top-0 h-full w-9 text-muted-foreground hover:bg-transparent hover:text-foreground"
            >
              <CalendarIcon className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 z-[60]" align="end">
            <Calendar
              mode="single"
              locale={ptBR}
              selected={selected}
              defaultMonth={selected}
              onSelect={(d) => {
                if (!d) return;
                const iso = dateToIso(d);
                setText(isoToBr(iso));
                onChange(iso);
                setOpen(false);
              }}
              initialFocus
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>
      </div>
    );
  },
);
DateInputBR.displayName = "DateInputBR";

function isoToBr(iso: string): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function brToIso(br: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br);
  if (!m) return "";
  const dd = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const yyyy = parseInt(m[3], 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || yyyy < 1900) return "";
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function isoToDate(iso: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return undefined;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function dateToIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
