/**
 * Ponto único de acesso ao backend. Consumidores devem importar daqui,
 * não diretamente de `@/integrations/supabase/client`.
 *
 *   import { backend } from "@/lib/backend";
 *   const { data, error } = await backend.functions.invoke("copilot-chat", { messages });
 *
 * Para migrar para AWS, basta criar `aws-impl.ts` implementando `BackendClient`
 * e trocar o export abaixo conforme `runtime.target`.
 */
import { runtime } from "@/config/runtime";
import { supabaseBackend } from "./supabase-impl";
import type { BackendClient } from "./types";

export const backend: BackendClient =
  runtime.target === "aws"

    ? (undefined as any) // TODO: importar ./aws-impl quando migrar
    : supabaseBackend;

export type { BackendClient, AuthSession } from "./types";
