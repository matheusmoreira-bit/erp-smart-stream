import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck, ShieldAlert, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type AdminRow = { user_id: string; email: string; verified_factors: number };

/** F09: situação do segundo fator dos administradores e redefinição por outro admin. */
export function AdminMfaCard() {
  const [rows, setRows] = useState<AdminRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data: s } = await supabase.auth.getSession();
    setMe(s.session?.user.id ?? null);
    const { data, error: err } = await supabase.functions.invoke("mfa-admin-reset", { body: { action: "overview" } });
    if (err) { setError("Não foi possível carregar a situação do segundo fator."); setRows([]); return; }
    setRows(((data as { admins?: AdminRow[] })?.admins) ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const reset = async (row: AdminRow) => {
    if (!window.confirm(`Redefinir o segundo fator de ${row.email}? A pessoa terá que cadastrar o aplicativo de novo.`)) return;
    setResetting(row.user_id);
    const { error: err } = await supabase.functions.invoke("mfa-admin-reset", { body: { action: "reset", user_id: row.user_id } });
    setResetting(null);
    if (err) { toast.error("Falha ao redefinir o segundo fator"); return; }
    toast.success("Segundo fator redefinido");
    void load();
  };

  return (
    <section className="glass-card p-4 space-y-3" aria-labelledby="admin-mfa-title">
      <h2 id="admin-mfa-title" className="text-sm font-semibold text-foreground">Verificação em duas etapas dos administradores</h2>
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
                <span className="truncate">{r.email}</span>
                <span className="text-xs text-muted-foreground">{r.verified_factors > 0 ? "ativo" : "pendente"}</span>
              </span>
              {r.verified_factors > 0 && r.user_id !== me && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => reset(r)}
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
    </section>
  );
}
