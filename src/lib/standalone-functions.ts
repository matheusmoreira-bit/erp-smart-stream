const STANDALONE_READ_ACTIONS = /^(get|list|read|load|find|preview|query|resolve|simulate|status|health|check|test)([-_]|$)/i;
const STANDALONE_CAMEL_CASE_READ_ACTIONS = new Set(["findByTaxId", "previewCode"]);

const STANDALONE_READ_FUNCTIONS = new Set([
  "approvals-feed",
  "cashflow-forecast",
  "credentials",
  "expense-read",
  "hana-health-probe",
  "license-analysis",
  "pagcorp-integration-status",
  "pagcorp-relations-resolver",
  "pagcorp-status-api",
  "sap-approvals-hana",
  "sap-list-service",
  "sap-nfse-lookup",
  "sap-purchase-orders-hana",
  "sap-suppliers-hana",
  "sap-user-credentials",
  "sap-users-admin",
]);

export function standaloneFunctionResponse(path: string, options: RequestInit = {}): Response {
  const cleanPath = path.split("?")[0].replace(/^.*\/functions\/v1\//, "").replace(/^\/+/, "");
  const method = String(options.method || "GET").toUpperCase();
  let action = "";
  if (typeof options.body === "string") {
    try {
      const parsed = JSON.parse(options.body) as { action?: unknown };
      action = typeof parsed.action === "string" ? parsed.action : "";
    } catch {
      // A non-JSON body remains an unknown operation and fails closed below.
    }
  }

  const isRead = method === "GET"
    || method === "HEAD"
    || STANDALONE_READ_FUNCTIONS.has(cleanPath)
    || STANDALONE_CAMEL_CASE_READ_ACTIONS.has(action)
    || STANDALONE_READ_ACTIONS.test(action);

  if (!isRead) {
    return new Response(JSON.stringify({
      error: `A operação ${cleanPath}${action ? `:${action}` : ""} não possui implementação local.`,
      code: "standalone_feature_unavailable",
      standalone: true,
    }), {
      status: 501,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payload = cleanPath === "sap-users-admin"
    ? { users: [], standalone: true }
    : { data: [], items: [], results: [], rows: [], success: true, standalone: true };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function standaloneAwareFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : null;
  const url = request?.url || String(input);
  if (!url.includes("/functions/v1/")) return fetch(input, init);

  const options: RequestInit = {
    ...init,
    method: init?.method || request?.method,
    body: init?.body || (request ? await request.clone().text() : undefined),
  };
  return standaloneFunctionResponse(url, options);
}
