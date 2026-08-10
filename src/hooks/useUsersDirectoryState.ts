import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { canonicalUserKey } from "@/lib/user-identity";
import type { IdpLinkState } from "@/lib/user-state";

export interface FlowLoginInfo {
  lastLogin: string | null;
  lastActivity: string | null;
}

type LicenseRow = { user_code: string; company_db: string; has_license: boolean; license_type: string | null };

/**
 * Estado transversal de cada usuário, montado a partir do ERP Flow
 * (não do Service Layer): último login do Cloud, vínculo IdP, licença,
 * empresas SAP conhecidas e administradores do backoffice.
 *
 * Todas as consultas respeitam RLS — a RPC `get_flow_last_login` só devolve
 * a população completa para administradores.
 */
export function useUsersDirectoryState(companyDb?: string | null) {
  const [logins, setLogins] = useState<Record<string, FlowLoginInfo>>({});
  const [idp, setIdp] = useState<Record<string, IdpLinkState>>({});
  const [licenses, setLicenses] = useState<LicenseRow[]>([]);
  const [admins, setAdmins] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);

    const [loginRes, idpRes, licRes, adminRes] = await Promise.all([
      supabase.rpc("get_flow_last_login"),
      supabase.from("idp_user_mapping").select("sap_user_code, sap_email, status"),
      supabase.from("user_licenses").select("user_code, company_db, has_license, license_type"),
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

    const nextIdp: Record<string, IdpLinkState> = {};
    for (const row of (idpRes.data || []) as { sap_user_code: string; sap_email: string | null; status: string }[]) {
      const state: IdpLinkState =
        row.status === "linked" ? "linked" : row.status === "disabled_by_idp" ? "removed" : "none";
      for (const id of [row.sap_user_code, row.sap_email]) {
        const key = canonicalUserKey(id);
        if (!key) continue;
        if (!nextIdp[key] || nextIdp[key] === "none") nextIdp[key] = state;
      }
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
    setLicenses((licRes.data || []) as LicenseRow[]);
    setAdmins(nextAdmins);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const licenseIndex = useMemo(() => {
    const byKey: Record<string, LicenseRow[]> = {};
    for (const row of licenses) {
      const key = canonicalUserKey(row.user_code);
      if (!key) continue;
      (byKey[key] ||= []).push(row);
    }
    return byKey;
  }, [licenses]);

  const sapCompanies = useMemo(
    () => Array.from(new Set(licenses.map((l) => l.company_db).filter(Boolean))).sort(),
    [licenses],
  );

  const helpers = useMemo(() => {
    const keysOf = (ids: (string | null | undefined)[]) =>
      ids.map((id) => canonicalUserKey(id)).filter(Boolean) as string[];

    const rowsOf = (ids: (string | null | undefined)[]) => {
      for (const key of keysOf(ids)) {
        if (licenseIndex[key]) return licenseIndex[key];
      }
      return [] as LicenseRow[];
    };

    return {
      loginOf: (...ids: (string | null | undefined)[]) => {
        for (const key of keysOf(ids)) if (logins[key]) return logins[key];
        return null;
      },
      idpOf: (...ids: (string | null | undefined)[]) => {
        for (const key of keysOf(ids)) if (idp[key]) return idp[key];
        return "none" as IdpLinkState;
      },
      licenseOf: (...ids: (string | null | undefined)[]) => {
        const rows = rowsOf(ids);
        const match = companyDb ? rows.find((r) => r.company_db === companyDb) : rows[0];
        return { hasLicense: !!match?.has_license, type: match?.license_type ?? null };
      },
      companiesOf: (...ids: (string | null | undefined)[]) =>
        Array.from(new Set(rowsOf(ids).map((r) => r.company_db))),
      isAdminUser: (...ids: (string | null | undefined)[]) =>
        keysOf(ids).some((key) => admins.has(key)),
    };
  }, [logins, idp, licenseIndex, admins, companyDb]);

  return { loading, refresh, sapCompanies, ...helpers };
}
