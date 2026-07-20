import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

/**
 * Compact toggle to arm/disarm the "require_idp_binding" enforcement flag.
 * Admin-only in effect — RLS on feature_flags blocks non-admin writes.
 */
export function IdpBindingFlagCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("feature_flags")
      .select("enabled")
      .eq("key", "require_idp_binding")
      .maybeSingle();
    setEnabled(Boolean(data?.enabled));
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (next: boolean) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("feature_flags")
        .update({ enabled: next, updated_at: new Date().toISOString() })
        .eq("key", "require_idp_binding");
      if (error) throw error;
      setEnabled(next);
      toast.success(next ? "Vínculo IdP obrigatório ativado" : "Vínculo IdP obrigatório desativado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao atualizar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        {enabled ? (
          <ShieldCheck className="w-5 h-5 text-green-500 shrink-0" />
        ) : (
          <ShieldOff className="w-5 h-5 text-muted-foreground shrink-0" />
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Exigir vínculo de identidade (JumpCloud/Google)</p>
          <p className="text-xs text-muted-foreground">
            Quando ativo, usuários sem vínculo em idp_user_mapping não conseguem entrar. Admins de backoffice sempre passam.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {enabled === null || saving ? (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        ) : null}
        <Switch checked={enabled ?? false} disabled={saving || enabled === null} onCheckedChange={toggle} />
      </div>
    </div>
  );
}
