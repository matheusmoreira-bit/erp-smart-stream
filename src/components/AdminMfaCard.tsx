import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck, ShieldAlert, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AdminRow = { user_id: string; email: string; verified_factors: number };

/** F09: situação do segundo fator; admin redefine o próprio ou de qualquer usuário. */
export function AdminMfaCard() {
  const [rows, setRows] = useState<AdminRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [otherEmail, setOtherEmail] = useState("");

  const load = useCallback(async () => {
    setError(null);
    const { data: s } = await supabase.auth.getSession();
    setMe(s.session?.user.id ?? null);
    const { data, error: err } = await supabase.functions.invoke("mfa-admin-reset", { body: { action: "overview" } });
    if (err) { setError("Não foi possível carregar a situação do segundo fator."); setRows([]); return; }
    setRows(((data as { admins?: AdminRow[] })?.admins) ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const doReset = async (key: string, body: Record<string, string>, label: string, isSelf: boolean) => {
    const msg = isSelf
      ? "Redefinir o SEU segundo fator? Você terá que cadastrar o aplicativo de novo agora."
      : `Redefinir o segundo fator de ${label}? A pessoa terá que cadastrar o aplicativo de novo.`;
    if (!window.confirm(msg)) return;
    setResetting(key);
    const { data, error: err } = await supabase.functions.invoke("mfa-admin-reset", { body: { action: "reset", ...body } });
    setResetting(null);
    const apiErr = (data as { error?: string } | null)?.error;
    if (err || apiErr) { toast.error(apiErr ?? "Falha ao redefinir o segundo fator"); return; }
    toast.success(`Segundo fator redefinido (${(data as { removed?: number })?.removed ?? 0} removido)`);
    if ((data as { self?: boolean })?.self) { await supabase.auth.refreshSession(); window.location.reload(); return; }
    setOtherEmail("");
    void load();
  };

  return (
    <section className="glass-card p-4 space-y-3" aria-labelledby="admin-mfa-title">
      <h2 id="admin-mfa-title" className="text-sm font-semibold text-foreground">Verificação em duas etapas</h2>
      {rows === null ? (
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" aria-label="Carregando" />
      ) : error ? (
        <p className="text-xs text-destructive" role="alert">{error}</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum administrador cadastrado.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.user_id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="flex items-center gap-2 min-w-0">
                {r.verified_factors > 0
                  ? <ShieldCheck className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
                  : <ShieldAlert className="w-4 h-4 text-destructive shrink-0" aria-hidden="true" />}
                <span className="truncate">{r.email}{r.user_id === me ? " (você)" : ""}</span>
                <span className="text-xs text-muted-foreground">{r.verified_factors > 0 ? "ativo" : "pendente"}</span>
              </span>
              {r.verified_factors > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => doReset(r.user_id, { user_id: r.user_id }, r.email, r.user_id === me)}
                  disabled={resetting === r.user_id}
                  aria-label={`Redefinir segundo fator de ${r.email}`}
                  title="Redefinir segundo fator"
                >
                  {resetting === r.user_id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex items-end gap-2 pt-2 border-t border-border"
        onSubmit={(e) => { e.preventDefault(); const em = otherEmail.trim(); if (em) void doReset("email", { email: em }, em, false); }}
      >
        <div className="flex-1">
          <Label htmlFor="mfa-other-email" className="text-xs text-muted-foreground">Redefinir de outro usuário (e-mail de login)</Label>
          <Input id="mfa-other-email" type="email" value={otherEmail} onChange={(e) => setOtherEmail(e.target.value)} placeholder="nome@empresa.com.br" />
        </div>
        <Button type="submit" variant="outline" size="sm" disabled={!otherEmail.trim() || resetting === "email"}>
          {resetting === "email" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4 mr-1" />} Redefinir
        </Button>
      </form>
    </section>
  );
}
