import { useEffect, useState } from "react";

/** Regra única de busca do ERP Flow. */
export const SEARCH_MIN_CHARS = 3;
export const SEARCH_DEBOUNCE_MS = 400;

/**
 * Retorna o termo "efetivo" de busca: vazio enquanto o usuário tiver digitado
 * menos de 3 caracteres e atualizado só após 400 ms sem digitação.
 */
export function useEffectiveSearch(
  input: string,
  minChars = SEARCH_MIN_CHARS,
  delay = SEARCH_DEBOUNCE_MS,
): string {
  const [effective, setEffective] = useState(() =>
    input.trim().length >= minChars ? input.trim() : "",
  );
  useEffect(() => {
    const t = input.trim();
    const next = t.length >= minChars ? t : "";
    if (next === "") {
      setEffective("");
      return;
    }
    const id = setTimeout(() => setEffective(next), delay);
    return () => clearTimeout(id);
  }, [input, minChars, delay]);
  return effective;
}

/**
 * Estado de busca padrão: [textoDigitado, setTexto, termoEfetivo].
 * Use o texto digitado no campo e o termo efetivo nos filtros/consultas.
 */
export function useSearchState(initial = ""): [string, (v: string) => void, string] {
  const [input, setInput] = useState(initial);
  const effective = useEffectiveSearch(input);
  return [input, setInput, effective];
}
