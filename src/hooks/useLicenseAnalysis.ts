import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";
import { useUserActivity, isFailedLogin } from "@/hooks/useUserActivity";
import { authFetch } from "@/lib/auth-fetch";

export interface UserLicense {
  id: string;
  company_db: string;
  user_code: string;
  user_name: string;
  is_locked: boolean;
  has_license: boolean;
  license_type: "PRO" | "CRM" | null;
}

export interface LicensePricing {
  license_type: "PRO" | "CRM";
  monthly_cost: number;
}

export interface LicenseRow extends UserLicense {
  logins: number;
  failedLogins: number;
  totalMinutes: number;
  lastLogin: string | null;
  monthlyCost: number;
  costPerLogin: number | null;
  costPerHour: number | null;
  status: "subutilizada" | "saudavel" | "intensa" | "sem-licenca";
}

function normalizeDbName(db?: string | null): string {
  return (db || "")
    .trim()
    .replace(/^SBO_TESTE_\d+_/i, "SBO_")
    .replace(/^tst_/i, "");
}

function parseDate(d: string): Date | null {
  if (!d) return null;
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}

export function useLicenseAnalysis(periodDays: number) {
  const { session } = useSap();
  const { records, isLoading: usrLoading, refresh: refreshUsr } = useUserActivity();
  const [licenses, setLicenses] = useState<UserLicense[]>([]);
  const [pricing, setPricing] = useState<Record<string, number>>({ PRO: 1300, CRM: 900 });
  const [loading, setLoading] = useState(false);

  const companyDb = session?.companyDB;
  const normalizedDb = normalizeDbName(companyDb);

  const load = async () => {
    setLoading(true);
    const resp = await authFetch(`license-analysis${companyDb ? `?company_db=${encodeURIComponent(companyDb)}` : ""}`);
    const data = await resp.json();
    if (!resp.ok || data?.error) {
      console.error("Erro ao carregar análise de licenças:", data?.error || resp.status);
      setLicenses([]);
      setLoading(false);
      return;
    }
    setLicenses((data.users || []) as UserLicense[]);
    if (data.pricing) {
      const m: Record<string, number> = {};
      for (const p of data.pricing as LicensePricing[]) m[p.license_type] = Number(p.monthly_cost);
      setPricing(m);
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [companyDb, normalizedDb]);

  const rows: LicenseRow[] = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - periodDays);

    // Group activity by user
    const stats = new Map<string, { logins: number; fails: number; mins: number; last: string | null }>();
    for (const r of records) {
      const d = parseDate(r.Date);
      if (!d || d < cutoff) continue;
      const key = r.UserCode.toLowerCase();
      const cur = stats.get(key) || { logins: 0, fails: 0, mins: 0, last: null };
      if (r.Action === "I" || r.Action === "W") {
        if (isFailedLogin(r)) cur.fails++;
        else cur.logins++;
      }
      if (r.AliveDurtn > 0) cur.mins += r.AliveDurtn;
      if (!cur.last || r.Date > cur.last) cur.last = r.Date;
      stats.set(key, cur);
    }

    // Activity records only exist for the currently logged-in company.
    // Filter licenses to that company so logins/tempo match correctly.
    const currentDb = normalizeDbName(companyDb);
    const scopedLicenses = currentDb
      ? licenses.filter((l) => normalizeDbName(l.company_db) === currentDb)
      : licenses;

    return scopedLicenses.map((l) => {
      const s = stats.get(l.user_code.toLowerCase()) || { logins: 0, fails: 0, mins: 0, last: null };
      const monthlyCost = l.has_license && l.license_type ? pricing[l.license_type] || 0 : 0;
      // Pro-rate cost to selected period
      const periodCost = (monthlyCost / 30) * periodDays;
      const hours = s.mins / 60;
      const costPerLogin = s.logins > 0 ? periodCost / s.logins : null;
      const costPerHour = hours > 0 ? periodCost / hours : null;

      let status: LicenseRow["status"] = "sem-licenca";
      if (l.has_license) {
        if (l.is_locked || s.logins === 0) status = "subutilizada";
        else if (hours < periodDays * 0.5) status = "subutilizada"; // < 0.5h/dia
        else if (hours < periodDays * 2) status = "saudavel"; // 0.5-2h/dia
        else status = "intensa";
      }

      return {
        ...l,
        logins: s.logins,
        failedLogins: s.fails,
        totalMinutes: s.mins,
        lastLogin: s.last,
        monthlyCost,
        costPerLogin,
        costPerHour,
        status,
      };
    });
  }, [licenses, records, periodDays, pricing, companyDb]);

  const updateLicenseType = async (row: UserLicense, license_type: "PRO" | "CRM" | null, has_license: boolean) => {
    const payload = {
      company_db: row.company_db,
      user_code: row.user_code,
      user_name: row.user_name,
      is_locked: row.is_locked,
      has_license,
      license_type,
    };
    const { error } = row.id.startsWith("cache:")
      ? await supabase.from("user_licenses").upsert(payload, { onConflict: "company_db,user_code" })
      : await supabase.from("user_licenses").update({ license_type, has_license }).eq("id", row.id);
    if (!error) await load();
    return !error;
  };

  const updatePricing = async (license_type: "PRO" | "CRM", monthly_cost: number) => {
    const { error } = await supabase.from("license_pricing").update({ monthly_cost }).eq("license_type", license_type);
    if (!error) await load();
    return !error;
  };

  return { rows, pricing, loading: loading || usrLoading, refresh: () => { refreshUsr(); load(); }, updateLicenseType, updatePricing };
}
