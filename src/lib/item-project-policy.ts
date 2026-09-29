import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Espelho no navegador de supabase/functions/_shared/item-project-policy.ts.
 * O servidor é quem bloqueia; aqui só filtramos as opções para o usuário.
 */
export const TAX_COST_CENTER = "1.2.2.4";
export const LOTUS_EMAIL_DOMAINS = ["lotusblanca.net"];
export const LOTUS_PROJECTS = ["VERA", "CASSINO"];

export function isTaxCostCenter(cc: string | null | undefined): boolean {
  const c = String(cc ?? "").trim();
  return c === TAX_COST_CENTER || c.startsWith(`${TAX_COST_CENTER}.`);
}

export function isLotusUser(email: string | null | undefined): boolean {
  const e = String(email ?? "").trim().toLowerCase();
  const domain = e.includes("@") ? e.split("@").pop() ?? "" : "";
  return LOTUS_EMAIL_DOMAINS.includes(domain);
}

export function isLotusProject(code: string | null | undefined): boolean {
  return LOTUS_PROJECTS.includes(String(code ?? "").trim().toUpperCase());
}

export function filterProjectsForLotus<T extends { code?: string | null }>(
  options: T[],
  email: string | null | undefined,
  privileged: boolean,
): T[] {
  if (privileged || !isLotusUser(email)) return options;
  return options.filter((o) => isLotusProject(o.code));
}

/** E-mail da conta logada (login Google/SSO). */
export function useAuthEmail(): string | null {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setEmail(data.user?.email ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return email;
}
