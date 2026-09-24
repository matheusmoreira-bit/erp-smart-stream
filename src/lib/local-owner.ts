/**
 * Dono do estado local (F13). Todo dado guardado no navegador (fila offline,
 * rascunhos com anexos) é marcado com o id do usuário logado; outro usuário na
 * mesma máquina nunca vê nem reenvia o que não é dele.
 */
import { supabase } from "@/integrations/supabase/client";

export async function getLocalOwnerId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

/** Nomes dos bancos IndexedDB com dados do usuário. */
export const USER_INDEXED_DBS = ["erpflow-offline", "createExpenseModalQueue"] as const;
