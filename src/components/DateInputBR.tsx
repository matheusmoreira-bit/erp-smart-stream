import { forwardRef, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

type InputProps = React.ComponentProps<typeof Input>;

interface DateInputBRProps extends Omit<InputProps, "value" | "onChange" | "type"> {
  /** Valor no formato ISO yyyy-MM-dd (como <input type="date">). */
  value: string;
  /** Recebe o valor no formato ISO yyyy-MM-dd (ou "" se inválido/incompleto). */
  onChange: (value: string) => void;
}

/**
 * Input de data com máscara fixa dd/MM/yyyy independente do locale do navegador.
 *
 * O <input type="date"> nativo exibe a data conforme o locale do sistema/navegador,
 * o que faz alguns usuários verem MM/dd/yyyy. Este componente mantém o valor no
 * mesmo contrato (ISO yyyy-MM-dd) mas garante exibição pt-BR em qualquer máquina.
 */
export const DateInputBR = forwardRef<HTMLInputElement, DateInputBRProps>(
  ({ value, onChange, onBlur, placeholder = "dd/mm/aaaa", ...rest }, ref) => {
    const [text, setText] = useState<string>(() => isoToBr(value));

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

    return (
      <Input
        {...rest}
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        onChange={handleChange}
        onBlur={(e) => {
          const iso = brToIso(text);
          if (!iso && text) setText("");
          onBlur?.(e);
        }}
      />
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
