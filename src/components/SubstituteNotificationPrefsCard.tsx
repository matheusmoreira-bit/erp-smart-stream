import { useCallback, useEffect, useState } from "react";
import { UserCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface SubstitutePrefs {
  enabled: boolean;
  in_app: boolean;
  email: boolean;
  push: boolean;
  slack: boolean;
  min_amount: number;
}

const DEFAULTS: SubstitutePrefs = {
  enabled: true,
  in_app: true,
  email: true,
  push: true,
  slack: true,
  min_amount: 0,
};

/**
 * Preferências pessoais para as aprovações que chegam por SUBSTITUIÇÃO
 * (quando o usuário responde em nome de um aprovador titular). Independem
 * das preferências gerais por categoria.
 */
export function SubstituteNotificationPrefsCard() {
  const { session } = useSap();
  const identifier = (session?.userName || "").toLowerCase();
  const [prefs, setPrefs] = useState<SubstitutePrefs>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [minAmountText, setMinAmountText] = useState("0");

  useEffect(() => {
    if (!identifier) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("substitute_notification_preferences")
        .select("enabled,in_app,email,push,slack,min_amount")
        .eq("user_identifier", identifier)
        .maybeSingle();
      if (cancelled) return;
      const next = data ? { ...DEFAULTS, ...data, min_amount: Number(data.min_amount || 0) } : DEFAULTS;
      setPrefs(next);
      setMinAmountText(String(next.min_amount ?? 0));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [identifier]);

  const save = useCallback(
    async (patch: Partial<SubstitutePrefs>) => {
      if (!identifier) return;
      const next = { ...prefs, ...patch };
      setPrefs(next);
      setSaving(true);
      const { error } = await supabase
        .from("substitute_notification_preferences")
        .upsert({ user_identifier: identifier, ...next }, { onConflict: "user_identifier" });
      setSaving(false);
      if (error) toast.error("Não foi possível salvar a preferência.");
    },
    [identifier, prefs],
  );

  const rows: Array<{ key: keyof SubstitutePrefs; label: string; hint: string }> = [
    { key: "in_app", label: "No aplicativo", hint: "Sino de notificações do ERP Flow" },
    { key: "email", label: "E-mail", hint: "Inclui o botão de aprovar direto pelo e-mail" },
    { key: "push", label: "Push", hint: "Notificação no navegador/celular" },
    { key: "slack", label: "Slack", hint: "Mensagem direta no Slack" },
  ];

  return (
    <div className="glass-card p-6 mb-6">
      <div className="flex items-center gap-2 mb-1">
        <UserCheck className="w-4 h-4 text-primary" />
        <h3 className="text-lg font-semibold text-foreground">Aprovações por substituição</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-5">
        Personalize como você quer ser avisado quando receber aprovações pendentes por estar como
        aprovador substituto de outra pessoa.
      </p>

      <div className="flex items-center justify-between gap-4 py-3 border-b border-border">
        <div>
          <p className="text-sm font-medium text-foreground">Receber avisos de substituição</p>
          <p className="text-xs text-muted-foreground">
            Desligado, você continua podendo aprovar — apenas não recebe os avisos.
          </p>
        </div>
        <Switch
          checked={prefs.enabled}
          disabled={loading || saving}
          onCheckedChange={(v) => save({ enabled: v })}
        />
      </div>

      <div className={prefs.enabled ? "" : "opacity-50 pointer-events-none"}>
        {rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between gap-4 py-3 border-b border-border">
            <div>
              <p className="text-sm font-medium text-foreground">{r.label}</p>
              <p className="text-xs text-muted-foreground">{r.hint}</p>
            </div>
            <Switch
              checked={Boolean(prefs[r.key])}
              disabled={loading || saving}
              onCheckedChange={(v) => save({ [r.key]: v } as Partial<SubstitutePrefs>)}
            />
          </div>
        ))}

        <div className="flex items-center justify-between gap-4 py-4">
          <div>
            <Label htmlFor="sub-min-amount" className="text-sm font-medium text-foreground">
              Valor mínimo do documento (R$)
            </Label>
            <p className="text-xs text-muted-foreground">
              Só avisar quando o documento for igual ou maior que este valor. Use 0 para receber todos.
            </p>
          </div>
          <Input
            id="sub-min-amount"
            type="number"
            min={0}
            step="100"
            className="w-36"
            value={minAmountText}
            disabled={loading || saving}
            onChange={(e) => setMinAmountText(e.target.value)}
            onBlur={() => {
              const parsed = Math.max(0, Number(minAmountText.replace(",", ".")) || 0);
              setMinAmountText(String(parsed));
              if (parsed !== prefs.min_amount) void save({ min_amount: parsed });
            }}
          />
        </div>
      </div>
    </div>
  );
}
