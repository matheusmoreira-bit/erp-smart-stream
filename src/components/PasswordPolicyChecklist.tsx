import { Check, X } from "lucide-react";
import { checkPasswordPolicy } from "@/lib/password-policy";

interface Props {
  password: string;
  userCode?: string;
  className?: string;
}

/**
 * Lista visual dos requisitos da política de senha do SAP B1.
 * Exibe cada regra com check/x conforme o usuário digita, evitando
 * disparar a chamada quando ainda existe alguma regra pendente.
 */
export function PasswordPolicyChecklist({ password, userCode, className }: Props) {
  const { results } = checkPasswordPolicy(password, userCode);
  if (!password) return null;
  return (
    <ul className={`space-y-1 text-xs ${className || ""}`}>
      {results.map(({ rule, ok }) => (
        <li key={rule.id} className={`flex items-center gap-2 ${ok ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
          {ok ? <Check className="w-3.5 h-3.5 shrink-0" /> : <X className="w-3.5 h-3.5 shrink-0 text-destructive/70" />}
          <span>{rule.label}</span>
        </li>
      ))}
    </ul>
  );
}
