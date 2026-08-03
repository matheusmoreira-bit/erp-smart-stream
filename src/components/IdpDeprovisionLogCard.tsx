import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, ShieldOff, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { sapFunctionFetch } from "@/lib/auth-fetch";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface DeprovisionEvent {
  id: string;
  company_db: string | null;
  idp_provider: string | null;
  sap_user_code: string | null;
  email: string | null;
  reason: string;
  source: string;
  sap_locked: boolean;
  groups_revoked: number;
  substitutions_revoked: number;
  credentials_revoked: number;
  push_devices_revoked: number;
  cost_centers_revoked: number;
  approval_rules_orphaned: number;
  errors: unknown;
  created_at: string;
}

/** Auditoria do desprovisionamento automático disparado pela sincronização do IdP. */
export function IdpDeprovisionLogCard() {
  const [events, setEvents] = useState<DeprovisionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await sapFunctionFetch("idp-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deprovisionLog", limit: 50 }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Falha ao carregar (${res.status}).`);
      setEvents((json.events || []) as DeprovisionEvent[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const chips = (e: DeprovisionEvent) =>
    [
      ["grupos", e.groups_revoked],
      ["substituições", e.substitutions_revoked],
      ["credenciais", e.credentials_revoked],
      ["centros de custo", e.cost_centers_revoked],
      ["dispositivos", e.push_devices_revoked],
    ].filter(([, n]) => Number(n) > 0) as Array<[string, number]>;

  return (
    <div className="glass-card p-6 mb-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex gap-3">
          <ShieldOff className="w-5 h-5 text-primary mt-0.5" aria-hidden />
          <div>
            <h3 className="text-base font-semibold text-foreground">Desprovisionamento automático</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Desligamento ou suspensão no JumpCloud/Okta revoga, na mesma sincronização, os grupos de
              permissão, alçadas, substituições vigentes, credenciais salvas e dispositivos com push —
              mesmo que o bloqueio no ERP falhe.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="gap-2 flex-shrink-0" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Atualizar
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!error && loading && events.length === 0 && (
        <p className="text-sm text-muted-foreground">Carregando histórico...</p>
      )}

      {!error && !loading && events.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhum desligamento processado até agora.</p>
      )}

      {events.length > 0 && (
        <div className="space-y-2">
          {events.map((e) => {
            const errs = Array.isArray(e.errors) ? e.errors : [];
            return (
              <div key={e.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {e.sap_user_code || e.email || "—"}
                  </span>
                  <Badge variant="outline" className="text-xs">{e.reason}</Badge>
                  {e.company_db && <span className="text-xs text-muted-foreground">{e.company_db}</span>}
                  <span className="text-xs text-muted-foreground ml-auto">
                    {formatDistanceToNow(new Date(e.created_at), { addSuffix: true, locale: ptBR })}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <Badge variant={e.sap_locked ? "secondary" : "destructive"} className="text-xs">
                    {e.sap_locked ? "Bloqueado no ERP" : "ERP não bloqueado"}
                  </Badge>
                  {chips(e).map(([label, n]) => (
                    <Badge key={label} variant="secondary" className="text-xs">{n} {label}</Badge>
                  ))}
                  {e.approval_rules_orphaned > 0 && (
                    <Badge variant="destructive" className="text-xs gap-1">
                      <AlertTriangle className="w-3 h-3" /> {e.approval_rules_orphaned} regra(s) sem aprovador
                    </Badge>
                  )}
                </div>
                {errs.length > 0 && (
                  <p className="text-xs text-destructive mt-2">{errs.map(String).join(" | ")}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default IdpDeprovisionLogCard;
