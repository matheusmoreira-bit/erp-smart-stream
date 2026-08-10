import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { canonicalUserKey } from "@/lib/user-identity";
import type { IdpLinkState } from "@/lib/user-state";

export interface FlowLoginInfo {
  lastLogin: string | null;
  lastActivity: string | null;
}

/**
 * Estado transversal de cada usuário, montado a partir do ERP Flow
 * (não do Service Layer): último login do Cloud, vínculo IdP, licença
 * e administradores do backoffice.
 *
 * Todas as consultas respeitam RLS — a RPC `get_flow_last_login` só devolve
 * a população completa para administradores.
 */
export function useUsersDirectoryState(companyDb?: string | null) {
  const [logins, setLogins] = useState<Record<string, FlowLoginInfo>>({});
  const [idp, setIdp] = useState<Record<string, { state: IdpLinkState; email: string | null }>>({});
  const [licenses, setLicenses] = useState<Record<string, { hasLicense: boolean; type: string | null }>>({});
  const [admins, setAdmins] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);

    const [loginRes, idpRes, licRes, adminRes] = await Promise.all([
      supabase.rpc("get_flow_last_login"),
      supabase.from("idp_user_mapping").select("sap_user_code, sap_email, status"),
      companyDb
        ? supabase
            .from("user_licenses")
            .select("user_code, has_license, license_type")
            .eq("company_db", companyDb)
        : Promise.resolve({ data: [] as { user_code: string; has_license: boolean; license_type: string | null }[] }),
      supabase.functions.invoke("admin-users", { method: "GET" }).catch(() => ({ data: null })),
    ]);

    const nextLogins: Record<string, FlowLoginInfo> = {};
    for (const row of (loginRes.data || []) as { email: string; last_login: string | null; last_activity: string | null }[]) {
      const key = canonicalUserKey(row.email);
      if (!key) continue;
      const prev = nextLogins[key];
      const candidate = { lastLogin: row.last_login, lastActivity: row.last_activity };
      if (!prev || (candidate.lastLogin ?? "") > (prev.lastLogin ?? "")) nextLogins[key] = candidate;
    }

    const nextIdp: Record<string, { state: IdpLinkState; email: string | null }> = {};
    for (const row of (idpRes.data || []) as { sap_user_code: string; sap_email: string | null; status: string }[]) {
      const state: IdpLinkState =
        row.status === "linked" ? "linked" : row.status === "disabled_by_idp" ? "removed" : "none";
      for (const id of [row.sap_user_code, row.sap_email]) {
        const key = canonicalUserKey(id);
        if (!key) continue;
        // vínculo ativo tem precedência sobre pendência duplicada
        if (!nextIdp[key] || nextIdp[key].state === "none") nextIdp[key] = { state, email: row.sap_email };
      }
    }

    const nextLic: Record<string, { hasLicense: boolean; type: string | null }> = {};
    for (const row of ((licRes as { data?: { user_code: string; has_license: boolean; license_type: string | null }[] }).data || [])) {
      const key = canonicalUserKey(row.user_code);
      if (!key) continue;
      nextLic[key] = { hasLicense: !!row.has_license, type: row.license_type };
    }

    const nextAdmins = new Set<string>();
    const adminList = (adminRes as { data?: unknown }).data;
    if (Array.isArray(adminList)) {
      for (const u of adminList as { email?: string; role?: string }[]) {
        if (u.role !== "admin") continue;
        const key = canonicalUserKey(u.email);
        if (key) nextAdmins.add(key);
      }
    }

    setLogins(nextLogins);
    setIdp(nextIdp);
    setLicenses(nextLic);
    setAdmins(nextAdmins);
    setLoading(false);
  }, [companyDb]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const helpers = useMemo(() => {
    const pick = <T,>(map: Record<string, T>, identities: (string | null | undefined)[]): T | undefined => {
      for (const id of identities) {
        const key = canonicalUserKey(id);
        if (key && map[key]) return map[key];
      }
      return undefined;
    };
    return {
      loginOf: (...ids: (string | null | undefined)[]) => pick(logins, ids) ?? null,
      idpOf: (...ids: (string | null | undefined)[]) => pick(idp, ids)?.state ?? ("none" as IdpLinkState),
      licenseOf: (...ids: (string | null | undefined)[]) => pick(licenses, ids) ?? { hasLicense: false, type: null },
      isAdminUser: (...ids: (string | null | undefined)[]) =>
        ids.some((id) => {
          const key = canonicalUserKey(id);
          return !!key && admins.has(key);
        }),
    };
  }, [logins, idp, licenses, admins]);

  return { loading, refresh, ...helpers };
}
