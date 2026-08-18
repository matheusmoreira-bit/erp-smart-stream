export function integrationsDisabled(): boolean {
  return String(Deno.env.get("INTEGRATIONS_MODE") || "").toLowerCase() === "disabled";
}

export function integrationsDisabledResponse(corsHeaders: Record<string, string>) {
  return new Response(
    JSON.stringify({ error: "Integrações externas desativadas neste ambiente.", feature_disabled: true }),
    {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

export function blockIfIntegrationsDisabled(corsHeaders: Record<string, string>): Response | null {
  return integrationsDisabled() ? integrationsDisabledResponse(corsHeaders) : null;
}
