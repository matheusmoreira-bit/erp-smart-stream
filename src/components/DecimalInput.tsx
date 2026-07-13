import { forwardRef, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

type InputProps = React.ComponentProps<typeof Input>;

interface DecimalInputProps extends Omit<InputProps, "value" | "onChange" | "type"> {
  value: number;
  onChange: (value: number) => void;
  /** Casas decimais aceitas (default 4). */
  maxDecimals?: number;
}

/**
 * Input decimal amigável a pt-BR: aceita vírgula OU ponto como separador.
 *
 * Corrige bug no Safari, onde <input type="number"> ignora "," e devolve
 * string vazia, zerando o valor. Aqui usamos type="text" + inputMode="decimal"
 * e mantemos o texto bruto localmente, convertendo para number no onChange.
 */
export const DecimalInput = forwardRef<HTMLInputElement, DecimalInputProps>(
  ({ value, onChange, maxDecimals = 4, onBlur, ...rest }, ref) => {
    const [text, setText] = useState<string>(() =>
      Number.isFinite(value) && value !== 0 ? String(value).replace(".", ",") : value === 0 ? "" : "",
    );

    // Sincroniza quando o valor numérico externo muda (ex.: reset de formulário,
    // cálculo automático) e não corresponde ao texto atual.
    useEffect(() => {
      const parsed = parseDecimal(text);
      if (parsed !== value) {
        setText(
          Number.isFinite(value) && value !== 0
            ? String(value).replace(".", ",")
            : value === 0 && text === ""
              ? ""
              : String(value).replace(".", ","),
        );
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      // Permite dígitos, um único separador (, ou .) e sinal negativo opcional.
      const cleaned = raw
        .replace(/[^\d,.\-]/g, "")
        .replace(/(?!^)-/g, "");
      // Um único separador
      const firstSep = cleaned.search(/[,.]/);
      let normalized = cleaned;
      if (firstSep !== -1) {
        normalized =
          cleaned.slice(0, firstSep + 1) +
          cleaned.slice(firstSep + 1).replace(/[,.]/g, "");
      }
      // Limita casas decimais
      const sepIdx = normalized.search(/[,.]/);
      if (sepIdx !== -1 && normalized.length - sepIdx - 1 > maxDecimals) {
        normalized = normalized.slice(0, sepIdx + 1 + maxDecimals);
      }
      setText(normalized);
      onChange(parseDecimal(normalized));
    };

    return (
      <Input
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={text}
        onChange={handleChange}
        onBlur={(e) => {
          // Normaliza "1," -> "1" ao sair do campo.
          if (text.endsWith(",") || text.endsWith(".")) {
            const trimmed = text.slice(0, -1);
            setText(trimmed);
            onChange(parseDecimal(trimmed));
          }
          onBlur?.(e);
        }}
        {...rest}
      />
    );
  },
);
DecimalInput.displayName = "DecimalInput";

function parseDecimal(s: string): number {
  if (!s) return 0;
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
