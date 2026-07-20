import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Loader2, ShieldAlert, Power, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { invalidateEnforcementCache } from "@/lib/permissions-v2";

interface Company { company_db: string; display_name: string | null; }
interface ScopeRow { company_db: string; enabled: boolean; }
interface ShadowRow {
  id: number; ts: string; actor_identifier: string | null;
  company_db: string | null; module_key: string; action: string;
  mode: string; reason: string | null;
}

export default function PermissionsEnforcementManager({ onBack }: { onBack: () => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [scopes, setScopes] = useState<Map<string, boolean>>(new Map());
  const [globalV2, setGlobalV2] = useState(false);
  const [killSwitch, setKillSwitch] = useState(false);
  const [logs, setLogs] = useState<ShadowRow[]>([]);

  const load = async () => {
    setLoading(true);
    const [{ data: comps }, { data: sc }, { data: flags }, { data: log }] = await Promise.all([
      supabase.from("companies").select("company_db, display_name").order("display_name"),
      supabase.from("permissions_enforcement_scope").select("company_db, enabled"),
      supabase.from("feature_flags").select("key, enabled").in("key", ["permissions_v2", "permissions_v2_kill"]),
      supabase.from("permission_shadow_log").select("id, ts, actor_identifier, company_db, module_key, action, mode, reason").order("ts", { ascending: false }).limit(50),
    ]);
    setCompanies((comps as any) || []);
    const m = new Map<string, boolean>();
    for (const r of ((sc as any) || []) as ScopeRow[]) m.set(r.company_db, r.enabled);
    setScopes(m);
    for (const f of ((flags as any) || []) as { key: string; enabled: boolean }[]) {
      if (f.key === "permissions_v2") setGlobalV2(f.enabled);
      if (f.key === "permissions_v2_kill") setKillSwitch(f.enabled);
    }
    setLogs(((log as any) || []) as ShadowRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const toggleScope = async (company_db: string, enabled: boolean) => {
    setSaving(true);
    const { error } = await supabase
      .from("permissions_enforcement_scope")
      .upsert({ company_db, enabled, updated_at: new Date().toISOString() }, { onConflict: "company_db" });
    setSaving(false);
    if (error) { toast.error("Falha ao salvar: " + error.message); return; }
    setScopes(new Map(scopes.set(company_db, enabled)));
    invalidateEnforcementCache();
    toast.success(enabled ? "Enforcement ligado" : "Voltou para shadow");
  };

  const toggleFlag = async (key: "permissions_v2" | "permissions_v2_kill", enabled: boolean) => {
    setSaving(true);
    const { error } = await supabase
      .from("feature_flags")
      .update({ enabled, updated_at: new Date().toISOString() })
      .eq("key", key);
    setSaving(false);
    if (error) { toast.error("Falha: " + error.message); return; }
    if (key === "permissions_v2") setGlobalV2(enabled);
    if (key === "permissions_v2_kill") setKillSwitch(enabled);
    invalidateEnforcementCache();
  };

  const denialsByCompany = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of logs) {
      const k = l.company_db ?? "—";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [logs]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 gap-1">
          <ChevronLeft className="w-4 h-4" /> Permissões
        </Button>
        <Button variant="ghost" size="sm" onClick={load} className="gap-1">
          <RefreshCw className="w-4 h-4" /> Atualizar
        </Button>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-cactus-amber" />
          <h4 className="text-sm font-semibold">Motor v2 de Permissões</h4>
        </div>
        <p className="text-xs text-muted-foreground">
          Em <b>shadow</b>, o motor só registra o que negaria. Em <b>enforce</b> (por empresa), o cliente
          respeita o veredito do servidor (has_module_action). O <b>kill-switch</b> desliga o v2 por completo.
        </p>

        <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
          <div>
            <p className="text-sm font-medium">Global v2 (shadow)</p>
            <p className="text-xs text-muted-foreground">Ativa o log em todas as empresas.</p>
          </div>
          <Switch checked={globalV2} onCheckedChange={(v) => toggleFlag("permissions_v2", v)} disabled={saving} />
        </div>

        <div className="flex items-center justify-between rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2">
          <div className="flex items-center gap-2">
            <Power className="w-4 h-4 text-destructive" />
            <div>
              <p className="text-sm font-medium">Kill-switch</p>
              <p className="text-xs text-muted-foreground">Força modo off em qualquer empresa.</p>
            </div>
          </div>
          <Switch checked={killSwitch} onCheckedChange={(v) => toggleFlag("permissions_v2_kill", v)} disabled={saving} />
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h4 className="text-sm font-semibold">Enforce por empresa</h4>
          <p className="text-xs text-muted-foreground">Ligue apenas após validar o shadow log.</p>
        </div>
        {loading ? (
          <div className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="divide-y divide-border max-h-[360px] overflow-y-auto">
            {companies.map((c) => {
              const on = scopes.get(c.company_db) ?? false;
              const denials = denialsByCompany.get(c.company_db) ?? 0;
              return (
                <div key={c.company_db} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{c.display_name || c.company_db}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{c.company_db}</p>
                  </div>
                  {denials > 0 && (
                    <Badge variant="secondary" className="text-[10px]">{denials} negativas</Badge>
                  )}
                  <Badge variant={on ? "default" : "outline"} className="text-[10px]">
                    {on ? "enforce" : "shadow"}
                  </Badge>
                  <Switch checked={on} onCheckedChange={(v) => toggleScope(c.company_db, v)} disabled={saving} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h4 className="text-sm font-semibold">Shadow log (últimas 50 negativas)</h4>
          <p className="text-xs text-muted-foreground">
            O que o motor v2 teria negado. Analise antes de virar cada empresa para enforce.
          </p>
        </div>
        <div className="divide-y divide-border max-h-[360px] overflow-y-auto">
          {logs.length === 0 && !loading && (
            <p className="px-4 py-6 text-xs text-muted-foreground text-center">Nenhuma negativa registrada.</p>
          )}
          {logs.map((l) => (
            <div key={l.id} className="px-4 py-2 text-xs flex items-center gap-2">
              <span className="text-muted-foreground shrink-0">{new Date(l.ts).toLocaleString("pt-BR")}</span>
              <Badge variant="outline" className="text-[10px] shrink-0">{l.mode}</Badge>
              <span className="font-mono text-[11px] truncate">{l.actor_identifier ?? "?"}</span>
              <span className="text-muted-foreground shrink-0">→</span>
              <span className="font-medium shrink-0">{l.module_key}.{l.action}</span>
              {l.company_db && <span className="text-muted-foreground truncate">@ {l.company_db}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
