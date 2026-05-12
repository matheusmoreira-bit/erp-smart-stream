import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";
import { useUserActivity, isFailedLogin } from "@/hooks/useUserActivity";
import type { SapUser } from "@/lib/cache-repository";

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

interface SapCacheRow {
  company_db: string;
  data: SapUser[] | Record<string, unknown>[] | null;
}

function normalizeDbName(db?: string | null): string {
  return (db || "")
    .trim()
    .replace(/^SBO_TESTE_\d+_/i, "SBO_")
    .replace(/^tst_/i, "");
}

function userKey(companyDb: string, userCode: string) {
  return `${normalizeDbName(companyDb).toLowerCase()}::${userCode.toLowerCase()}`;
}

function normalizeCachedUser(companyDb: string, user: SapUser | Record<string, unknown>): UserLicense {
  const row = user as Record<string, unknown>;
  const userCode = String(row.UserCode ?? row.user_code ?? row.USER_CODE ?? "").trim();
  const userName = String(row.UserName ?? row.u_name ?? row.U_NAME ?? userCode).trim();
  const locked = row.Locked ?? row.locked ?? row.LOCKED;
  return {
    id: `cache:${companyDb}:${userCode}`,
    company_db: normalizeDbName(companyDb) || companyDb,
    user_code: userCode,
    user_name: userName || userCode,
    is_locked: locked === "tYES" || locked === "Y" || locked === true || locked === 1 || locked === "1",
    has_license: false,
    license_type: null,
  };
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
    const companyCandidates = Array.from(new Set([companyDb, normalizedDb].filter(Boolean) as string[]));

    let cacheQuery = supabase
      .from("sap_cache")
      .select("company_db,data,updated_at")
      .eq("cache_key", "users")
      .order("updated_at", { ascending: false });
    if (companyCandidates.length > 0) cacheQuery = cacheQuery.in("company_db", companyCandidates);
    const { data: cacheRows } = await cacheQuery.limit(companyCandidates.length > 0 ? 5 : 20);

    const cachedCompanies = ((cacheRows || []) as unknown as SapCacheRow[]).map((row) => normalizeDbName(row.company_db));
    const licenseCompanies = Array.from(new Set([...companyCandidates, ...cachedCompanies].filter(Boolean)));

    let licenseQuery = supabase.from("user_licenses").select("*").order("user_name");
    if (licenseCompanies.length > 0) licenseQuery = licenseQuery.in("company_db", licenseCompanies);
    const { data: lic } = await licenseQuery;

    const { data: price } = await supabase.from("license_pricing").select("*");

    const licenseByUser = new Map<string, UserLicense>();
    for (const l of (lic || []) as UserLicense[]) {
      licenseByUser.set(userKey(l.company_db, l.user_code), l);
    }

    const cacheBasedRows = ((cacheRows || []) as unknown as SapCacheRow[]).flatMap((cacheRow) => {
      const users = Array.isArray(cacheRow.data) ? cacheRow.data : [];
      return users
        .map((u) => normalizeCachedUser(cacheRow.company_db, u))
        .filter((u) => u.user_code)
        .map((cached) => {
          const license = licenseByUser.get(userKey(cached.company_db, cached.user_code));
          return license
            ? { ...license, user_name: cached.user_name, is_locked: cached.is_locked }
            : cached;
        });
    });

    setLicenses(cacheBasedRows.length > 0 ? cacheBasedRows : ((lic || []) as UserLicense[]));
    if (price) {
      const m: Record<string, number> = {};
      for (const p of price as LicensePricing[]) m[p.license_type] = Number(p.monthly_cost);
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

    return licenses.map((l) => {
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
  }, [licenses, records, periodDays, pricing]);

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
