import { useEffect, useState } from "react";
import { IMPERSONATION_EVENT } from "@/lib/impersonation";
import { isReadOnlyMode } from "@/lib/read-only-guard";

/**
 * true enquanto a sessão é uma impersonação (somente leitura).
 * Use para desabilitar botões de ação na UI — a trava real é de transporte.
 */
export function useReadOnlyMode(): boolean {
  const [readOnly, setReadOnly] = useState(() => isReadOnlyMode());
  useEffect(() => {
    const sync = () => setReadOnly(isReadOnlyMode());
    window.addEventListener(IMPERSONATION_EVENT, sync);
    return () => window.removeEventListener(IMPERSONATION_EVENT, sync);
  }, []);
  return readOnly;
}
