import { toast } from "sonner";
import { getIsCloudAdmin } from "@/lib/auth-cache";

/**
 * Erros técnicos (Edge Functions, HANA, rede, HTTP) não devem vazar para o
 * usuário comum: para ele a tela apenas segue com os dados disponíveis.
 * Administradores continuam vendo o detalhe, em forma de toast.
 */
const TECHNICAL_PATTERNS: RegExp[] = [
  /non-2xx/i,
  /edge function/i,
  /functions?httperror/i,
  /hana/i,
  /tcp connect|no route to host|os error \d+/i,
  /failed to (send|fetch)/i,
  /\bHTTP \d{3}\b/,
  /networkerror|econn|etimedout|timeout/i,
  /service layer/i,
];

export function isTechnicalError(message?: string | null): boolean {
  const msg = String(message || "");
  if (!msg) return false;
  return TECHNICAL_PATTERNS.some((re) => re.test(msg));
}

export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Erro inesperado";
}

/**
 * Mostra o erro técnico apenas para administradores (toast). Para os demais
 * usuários, registra no console e retorna false (nada é exibido).
 */
export async function notifyTechnicalError(err: unknown, context?: string): Promise<boolean> {
  const message = toErrorMessage(err);
  console.error(`[tech-error]${context ? ` ${context}:` : ""}`, message);
  let admin = false;
  try {
    admin = await getIsCloudAdmin();
  } catch {
    admin = false;
  }
  if (!admin) return false;
  toast.error(context ? `${context}: ${message}` : message, { duration: 8000 });
  return true;
}
