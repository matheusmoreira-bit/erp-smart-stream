import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { authErrorResponse, requireAdminOrSapSessionHeaders } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db, x-sap-auth-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UBER_FETCH_TIMEOUT_MS = Number(Deno.env.get("UBER_TRIPS_FETCH_TIMEOUT_MS") || "90000");
const UBER_CACHE_TTL_MS = Number(Deno.env.get("UBER_TRIPS_CACHE_TTL_MS") || String(15 * 24 * 60 * 60 * 1000));

interface NormalizedTrip {
  trip_id: string;
  source: string;
  source_label: string;
  employee_id: string;
  employee_name: string;
  email: string;
  requested_at_local: string | null;
  requested_date_local: string | null;
  requested_time_local: string | null;
  arrived_at_local: string | null;
  group: string;
  program: string;
  service: string;
  city: string;
  country: string;
  origin_address: string;
  destination_address: string;
  expense_code: string;
  transaction_type: string;
  currency: string;
  amount: number;
}

interface UserMapping {
  idp_provider?: string | null;
  idp_email?: string | null;
  sap_email?: string | null;
  idp_display_name?: string | null;
  sap_user_name?: string | null;
  sap_user_code?: string | null;
  status?: string | null;
  employee_id?: string | null;
  department?: string | null;
  company_name?: string | null;
  cost_center_code?: string | null;
  cost_center_label?: string | null;
}

interface ManualUserMapping {
  employee_key?: string | null;
  employee_name?: string | null;
  employee_email?: string | null;
  cost_center_code?: string | null;
  cost_center_label?: string | null;
}

interface UberIntegrationConfig {
  id: string;
  integration_key: string;
  display_name: string;
  is_active: boolean;
  parameters: Record<string, unknown> | null;
  company_db: string | null;
}

interface UberTripsCacheRow {
  data: NormalizedTrip[] | null;
  expires_at: string | null;
  updated_at: string | null;
}

interface UberTripsCacheResult {
  trips: NormalizedTrip[];
  meta: {
    hit: boolean;
    key: string;
    expires_at: string;
    updated_at: string | null;
  };
}

interface SaveUserMappingInput {
  source?: string | null;
  employee_key?: string | null;
  employee_name?: string | null;
  employee_email?: string | null;
  cost_center_code?: string | null;
  cost_center_label?: string | null;
}

interface SaveProjectDefaultInput {
  cost_center_code?: string | null;
  cost_center_label?: string | null;
  project_code?: string | null;
  project_name?: string | null;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clean(value: unknown): string {
  const text = String(value ?? "").trim();
  return text === "--" ? "" : text;
}

function parseMoney(value: unknown): number {
  const raw = clean(value);
  if (!raw) return 0;
  const normalized = raw
    .replace(/[^\d,.-]+/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value: unknown): string {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function compactNameKey(value: unknown): string {
  return normalizeText(value).replace(/\s+/g, "");
}

function employeeKeyForTrip(trip: Pick<NormalizedTrip, "trip_id" | "email" | "employee_name">): string {
  return (clean(trip.email).toLowerCase() || compactNameKey(trip.employee_name) || clean(trip.trip_id)).toLowerCase();
}

function manualMappingToUser(row: ManualUserMapping): UserMapping {
  return {
    idp_email: row.employee_email,
    idp_display_name: row.employee_name,
    sap_user_name: row.employee_name,
    cost_center_code: row.cost_center_code,
    cost_center_label: row.cost_center_label,
    status: "active",
  };
}

function localDateTime(date: string, time: string): string | null {
  if (!date && !time) return null;
  return [date, time].filter(Boolean).join(" ");
}

function readParameter(params: Record<string, unknown> | null | undefined, keys: string[]): string {
  for (const key of keys) {
    const value = clean(params?.[key]);
    if (value) return value;
  }
  return "";
}

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeTrip(row: Record<string, unknown>, source: string, sourceLabel: string): NormalizedTrip {
  const firstName = clean(row["Nome"]);
  const lastName = clean(row["Sobrenome"]);
  const requestedDateLocal = clean(row["Data da solicitação (local)"]);
  const requestedTimeLocal = clean(row["Hora da solicitação (local)"]);
  const arrivedDateLocal = clean(row["Data de chegada (local)"]);
  const arrivedTimeLocal = clean(row["Hora de chegada (local)"]);
  return {
    trip_id: clean(row["ID da viagem/Uber Eats"]),
    source,
    source_label: sourceLabel,
    employee_id: clean(row["ID do funcionário"]),
    employee_name: [firstName, lastName].filter(Boolean).join(" ").trim(),
    email: clean(row["E-mail"]).toLowerCase(),
    requested_at_local: localDateTime(requestedDateLocal, requestedTimeLocal),
    requested_date_local: requestedDateLocal || null,
    requested_time_local: requestedTimeLocal || null,
    arrived_at_local: localDateTime(arrivedDateLocal, arrivedTimeLocal),
    group: clean(row["Grupo"]),
    program: clean(row["Programa"]),
    service: clean(row["Serviço"]),
    city: clean(row["Cidade"]),
    country: clean(row["País"]),
    origin_address: clean(row["Endereço de partida"]),
    destination_address: clean(row["Endereço de destino"]),
    expense_code: clean(row["Código da despesa"]),
    transaction_type: clean(row["Tipo de transação"]),
    currency: clean(row["Código da moeda local"]) || "BRL",
    amount: parseMoney(
      row["Valor da transação: BRL"] ??
        row["Valor total: BRL"] ??
        row["Valor da transação (moeda local)"] ??
        row["Valor total (moeda local)"],
    ),
  };
}

async function fetchTrips(config: { source: string; label: string; url: string; apiKey: string }): Promise<NormalizedTrip[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UBER_FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (config.apiKey) headers["x-api-key"] = config.apiKey;

    const response = await fetch(config.url, {
      method: "GET",
      signal: controller.signal,
      headers,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${config.label}: ${response.status} ${text.slice(0, 200)}`);
    }
    const payload = JSON.parse(text);
    if (!Array.isArray(payload)) throw new Error(`${config.label}: resposta não é uma lista`);
    return payload
      .map((row) => normalizeTrip(row as Record<string, unknown>, config.source, config.label))
      .filter((trip) => trip.trip_id && trip.currency === "BRL" && trip.amount !== 0);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`${config.label}: tempo esgotado ao buscar viagens`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function loadTripsWithCache(
  admin: ReturnType<typeof createClient>,
  companyDb: string,
  config: { source: string; label: string; url: string; apiKey: string },
): Promise<UberTripsCacheResult> {
  const fingerprint = await sha256Hex(`${config.url}|${config.apiKey}`);
  const cacheKey = `uber_trips:${fingerprint.slice(0, 24)}`;
  const now = Date.now();

  const { data: cacheRow, error: cacheReadError } = await admin
    .from("sap_cache")
    .select("data,expires_at,updated_at")
    .eq("cache_key", cacheKey)
    .eq("company_db", companyDb)
    .maybeSingle();

  if (cacheReadError && !/(does not exist|schema cache|relation .* does not exist)/i.test(cacheReadError.message || "")) {
    console.warn("[uber-trips] cache read failed", cacheReadError);
  }

  const typedCache = cacheRow as UberTripsCacheRow | null;
  const cachedTrips = Array.isArray(typedCache?.data) ? typedCache.data : null;
  const cachedExpiresAt = typedCache?.expires_at || "";
  if (cachedTrips && cachedExpiresAt && new Date(cachedExpiresAt).getTime() > now) {
    return {
      trips: cachedTrips,
      meta: {
        hit: true,
        key: cacheKey,
        expires_at: cachedExpiresAt,
        updated_at: typedCache?.updated_at || null,
      },
    };
  }

  try {
    const trips = await fetchTrips(config);
    const expiresAt = new Date(now + UBER_CACHE_TTL_MS).toISOString();
    const { error: cacheWriteError } = await admin
      .from("sap_cache")
      .upsert(
        {
          cache_key: cacheKey,
          company_db: companyDb,
          data: trips,
          expires_at: expiresAt,
          updated_at: new Date(now).toISOString(),
        },
        { onConflict: "cache_key,company_db" },
      );
    if (cacheWriteError) console.warn("[uber-trips] cache write failed", cacheWriteError);
    return {
      trips,
      meta: {
        hit: false,
        key: cacheKey,
        expires_at: expiresAt,
        updated_at: new Date(now).toISOString(),
      },
    };
  } catch (err) {
    if (cachedTrips) {
      console.warn("[uber-trips] returning stale cache after fetch failure", err);
      return {
        trips: cachedTrips,
        meta: {
          hit: true,
          key: cacheKey,
          expires_at: cachedExpiresAt || new Date(now).toISOString(),
          updated_at: typedCache?.updated_at || null,
        },
      };
    }
    throw err;
  }
}

function indexMappings(rows: UserMapping[]) {
  const byEmail = new Map<string, UserMapping>();
  const byName = new Map<string, UserMapping>();
  const byEmployeeId = new Map<string, UserMapping>();
  for (const row of rows) {
    if (row.status && /inactive|inativo|disabled|desabilitado|bloqueado|blocked/i.test(row.status)) continue;
    const employeeIdKey = clean(row.employee_id).toLowerCase();
    if (employeeIdKey && !byEmployeeId.has(employeeIdKey)) byEmployeeId.set(employeeIdKey, row);
    for (const email of [row.idp_email, row.sap_email]) {
      const key = clean(email).toLowerCase();
      if (key && !byEmail.has(key)) byEmail.set(key, row);
    }
    for (const name of [row.idp_display_name, row.sap_user_name, row.sap_user_code]) {
      const key = compactNameKey(name);
      if (key && !byName.has(key)) byName.set(key, row);
    }
  }
  return { byEmail, byName, byEmployeeId };
}

async function saveUserMappings(
  admin: ReturnType<typeof createClient>,
  companyDb: string,
  rows: SaveUserMappingInput[],
) {
  const now = new Date().toISOString();
  const payload = rows
    .map((row) => ({
      company_db: companyDb,
      source: clean(row.source) || "uber",
      employee_key: clean(row.employee_key).toLowerCase(),
      employee_name: clean(row.employee_name),
      employee_email: clean(row.employee_email).toLowerCase() || null,
      cost_center_code: clean(row.cost_center_code),
      cost_center_label: clean(row.cost_center_label) || clean(row.cost_center_code),
      updated_at: now,
    }))
    .filter((row) => row.employee_key && row.employee_name && row.cost_center_code);

  if (!payload.length) return json(400, { error: "Nenhum mapeamento Uber válido para salvar." });

  const { error } = await admin
    .from("uber_user_mappings")
    .upsert(payload, { onConflict: "company_db,source,employee_key" });
  if (error) return json(500, { error: `Falha ao salvar mapeamento Uber: ${error.message}` });

  return json(200, { ok: true, saved: payload.length });
}

async function saveProjectDefaults(
  admin: ReturnType<typeof createClient>,
  companyDb: string,
  rows: SaveProjectDefaultInput[],
) {
  const now = new Date().toISOString();
  const payload = rows
    .map((row) => ({
      company_db: companyDb,
      cost_center_code: clean(row.cost_center_code),
      cost_center_label: clean(row.cost_center_label) || clean(row.cost_center_code),
      project_code: clean(row.project_code),
      project_name: clean(row.project_name) || clean(row.project_code),
      updated_at: now,
    }))
    .filter((row) => row.cost_center_code && row.project_code);

  if (!payload.length) return json(400, { error: "Nenhum projeto padrão Uber válido para salvar." });

  const { error } = await admin
    .from("uber_cost_center_project_defaults")
    .upsert(payload, { onConflict: "company_db,cost_center_code" });
  if (error) return json(500, { error: `Falha ao salvar projeto padrão Uber: ${error.message}` });

  return json(200, { ok: true, saved: payload.length });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Método não permitido" });

  try {
    await requireAdminOrSapSessionHeaders(req);
  } catch (err) {
    const response = authErrorResponse(err, corsHeaders);
    if (response) return response;
    throw err;
  }

  try {
    const body = await req.json().catch(() => ({}));
    const companyDb = clean(body?.company_db || req.headers.get("x-company-db"));
    if (!companyDb) return json(400, { error: "Selecione uma empresa para carregar a integração Uber." });
    const action = clean(body?.action) || "load";

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json(500, { error: "Supabase service role não configurado" });
    const admin = createClient(supabaseUrl, serviceKey);

    if (action === "save_user_mappings") {
      return await saveUserMappings(admin, companyDb, Array.isArray(body?.rows) ? body.rows : []);
    }
    if (action === "save_project_defaults") {
      return await saveProjectDefaults(admin, companyDb, Array.isArray(body?.rows) ? body.rows : []);
    }
    if (action !== "load") return json(400, { error: `Ação Uber inválida: ${action}` });

    const { data: integration, error: integrationError } = await admin
      .from("synapse_integrations")
      .select("id,integration_key,display_name,is_active,parameters,company_db")
      .eq("integration_key", "uber_trips")
      .eq("company_db", companyDb)
      .maybeSingle();

    if (integrationError) {
      return json(500, { error: `Falha ao buscar configuração da integração Uber: ${integrationError.message}` });
    }
    if (!integration) {
      return json(404, {
        error:
          "Integração Uber não configurada para esta empresa. Configure a URL e o header x-api-key em Integrações.",
      });
    }
    const uberIntegration = integration as UberIntegrationConfig;
    if (!uberIntegration.is_active) {
      return json(409, { error: "Integração Uber inativa para esta empresa." });
    }

    const params = uberIntegration.parameters || {};
    const configuredUrl = readParameter(params, ["url", "endpoint_url", "webhook_url"]);
    const apiKey = readParameter(params, ["x-api-key", "x_api_key", "api_key", "header_x_api_key"]);
    if (!configuredUrl) {
      return json(422, { error: "Configure a URL da integração Uber para esta empresa." });
    }
    let endpointUrl: URL;
    try {
      endpointUrl = new URL(configuredUrl);
    } catch {
      return json(422, { error: "URL da integração Uber inválida." });
    }

    const fetchConfig = {
      source: companyDb,
      label: uberIntegration.display_name || `Uber ${companyDb}`,
      url: endpointUrl.toString(),
      apiKey,
    };

    const manualMappingsPromise = companyDb
      ? admin
          .from("uber_user_mappings")
          .select("employee_key,employee_name,employee_email,cost_center_code,cost_center_label")
          .eq("company_db", companyDb)
          .eq("source", "uber")
          .then((result) => {
            if (
              result.error &&
              /(does not exist|schema cache|relation .* does not exist)/i.test(result.error.message || "")
            ) {
              return { data: [], error: null };
            }
            return result;
          })
      : Promise.resolve({ data: [], error: null });

    const [tripsResult, mappingsResult, manualMappingsResult] = await Promise.all([
      loadTripsWithCache(admin, companyDb, fetchConfig),
      admin
        .from("idp_user_mapping")
        .select("idp_provider,idp_email,sap_email,idp_display_name,sap_user_name,sap_user_code,status,employee_id,department,company_name,cost_center_code,cost_center_label")
        .eq("idp_provider", "okta")
        .eq("status", "linked"),
      manualMappingsPromise,
    ]);

    if (mappingsResult.error) {
      return json(500, { error: `Falha ao buscar usuários para rateio Uber: ${mappingsResult.error.message}` });
    }
    if (manualMappingsResult.error) {
      return json(500, { error: `Falha ao buscar mapeamentos Uber salvos: ${manualMappingsResult.error.message}` });
    }

    const mappings = indexMappings((mappingsResult.data || []) as UserMapping[]);
    const manualByKey = new Map<string, UserMapping>();
    for (const row of (manualMappingsResult.data || []) as ManualUserMapping[]) {
      const key = clean(row.employee_key).toLowerCase();
      if (key && clean(row.cost_center_code)) manualByKey.set(key, manualMappingToUser(row));
    }

    const trips = tripsResult.trips;
    const summaryMap = new Map<string, {
      row_key: string;
      cost_center_code: string;
      cost_center_label: string;
      amount: number;
      transaction_count: number;
      sources: Set<string>;
      employees: Map<string, {
        user_key: string;
        employee_name: string;
        email: string;
        amount: number;
        transaction_count: number;
        sources: Set<string>;
      }>;
    }>();
    const exceptions: Array<{ reason: string; trip: NormalizedTrip; matched_user: UserMapping | null }> = [];
    const matched: Array<{ trip: NormalizedTrip; user: UserMapping }> = [];

    for (const trip of trips) {
      const tripUserKey = employeeKeyForTrip(trip);
      const user = manualByKey.get(tripUserKey)
        || (trip.employee_id ? mappings.byEmployeeId.get(trip.employee_id.toLowerCase()) : null)
        || (trip.email ? mappings.byEmail.get(trip.email) : null)
        || mappings.byName.get(compactNameKey(trip.employee_name))
        || null;
      if (!user) {
        exceptions.push({ reason: "Colaborador não encontrado", trip, matched_user: null });
        continue;
      }
      const cc = clean(user.cost_center_code);
      if (!cc) {
        exceptions.push({ reason: "Colaborador sem centro de custo", trip, matched_user: user });
        continue;
      }
      matched.push({ trip, user });
      const userKey =
        clean(user.idp_email).toLowerCase()
        || clean(user.sap_email).toLowerCase()
        || clean(user.employee_id).toLowerCase()
        || clean(user.sap_user_code)
        || compactNameKey(user.idp_display_name || user.sap_user_name || trip.employee_name);
      const employeeName = clean(user.idp_display_name) || clean(user.sap_user_name) || trip.employee_name || trip.email || "Sem nome";
      const userEmail = clean(user.idp_email).toLowerCase() || clean(user.sap_email).toLowerCase() || trip.email || "";
      const employeeKey = (userKey || tripUserKey || compactNameKey(employeeName)).toLowerCase();
      const summaryKey = cc;
      const existing = summaryMap.get(summaryKey) || {
        row_key: cc,
        cost_center_code: cc,
        cost_center_label: clean(user.cost_center_label) || cc,
        amount: 0,
        transaction_count: 0,
        sources: new Set<string>(),
        employees: new Map(),
      };
      existing.amount += trip.amount;
      existing.transaction_count += 1;
      existing.sources.add(trip.source_label);
      const employee = existing.employees.get(employeeKey) || {
        user_key: employeeKey,
        employee_name: employeeName,
        email: userEmail,
        amount: 0,
        transaction_count: 0,
        sources: new Set<string>(),
      };
      employee.amount += trip.amount;
      employee.transaction_count += 1;
      employee.sources.add(trip.source_label);
      existing.employees.set(employeeKey, employee);
      summaryMap.set(summaryKey, existing);
    }

    const summary = Array.from(summaryMap.values())
      .map((row) => ({
        ...row,
        amount: Number(row.amount.toFixed(2)),
        sources: Array.from(row.sources).sort((a, b) => a.localeCompare(b, "pt-BR")),
        employee_count: row.employees.size,
        employees: Array.from(row.employees.values())
          .map((employee) => ({
            ...employee,
            amount: Number(employee.amount.toFixed(2)),
            sources: Array.from(employee.sources).sort((a, b) => a.localeCompare(b, "pt-BR")),
          }))
          .sort((a, b) => a.employee_name.localeCompare(b.employee_name, "pt-BR")),
      }))
      .sort((a, b) => a.cost_center_code.localeCompare(b.cost_center_code, "pt-BR", { numeric: true }));
    const exceptionAmount = exceptions.reduce((sum, item) => sum + item.trip.amount, 0);

    return json(200, {
      ok: true,
      generated_at: new Date().toISOString(),
      source: companyDb,
      integration: {
        id: uberIntegration.id,
        integration_key: uberIntegration.integration_key,
        display_name: uberIntegration.display_name,
        company_db: uberIntegration.company_db,
        is_active: uberIntegration.is_active,
      },
      cache: tripsResult.meta,
      summary,
      exceptions,
      matched,
      totals: {
        amount: Number(trips.reduce((sum, trip) => sum + trip.amount, 0).toFixed(2)),
        transaction_count: trips.length,
        exception_amount: Number(exceptionAmount.toFixed(2)),
        exception_count: exceptions.length,
      },
    });
  } catch (err) {
    console.error("[uber-trips] unexpected error", err);
    return json(500, { error: err instanceof Error ? err.message : String(err) });
  }
});
