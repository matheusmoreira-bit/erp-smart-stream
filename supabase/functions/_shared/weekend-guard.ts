// Bloqueia envio de notificações de integração durante o final de semana
// (sábado e domingo no fuso America/Sao_Paulo). Permite override via ?force=1
// no query string, header x-force-weekend: 1, ou body.force === true.
export function isWeekendSaoPaulo(now: Date = new Date()): boolean {
  // en-US formata weekday como "Sat"/"Sun"
  const wd = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "America/Sao_Paulo",
  }).format(now);
  return wd === "Sat" || wd === "Sun";
}

export async function weekendBlockResponse(
  req: Request,
  corsHeaders: Record<string, string>,
  bodyOverride?: unknown,
): Promise<Response | null> {
  if (!isWeekendSaoPaulo()) return null;
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("force") === "1") return null;
  } catch { /* ignore */ }
  if (req.headers.get("x-force-weekend") === "1") return null;
  const b = (bodyOverride ?? null) as { force?: unknown } | null;
  if (b && b.force === true) return null;
  return new Response(
    JSON.stringify({
      ok: true,
      skipped: true,
      reason: "weekend_pause",
      message: "Notificações de integração pausadas no final de semana (America/Sao_Paulo).",
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
