import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, RefreshCw, Users2 } from "lucide-react";

interface Row {
  local_part: string;
  email: string;
  user_id: string;
  last_sign_in_at: string | null;
  created_at: string;
  has_sap_credentials: boolean;
  group_count: number;
  is_admin: boolean;
}

const fmt = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "nunca";

/**
 * Relatório de contas duplicadas entre domínios de e-mail (mesmo nome antes
 * do @). Duplicidade é fonte recorrente de erro de senha, permissão e
 * notificação — aqui o administrador vê qual conta está realmente em uso.
 */
export function DuplicateIdentitiesCard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("list_duplicate_identities");
    if (err) setError(err.message);
    else setRows((data || []) as Row[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const list = map.get(r.local_part) || [];
      list.push(r);
      map.set(r.local_part, list);
    }
    return Array.from(map.entries());
  }, [rows]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users2 className="w-4 h-4" aria-hidden="true" />
            Contas duplicadas entre domínios
          </CardTitle>
          <CardDescription>
            Mesma pessoa com mais de um e-mail de acesso. A conta com acesso mais recente costuma ser a
            que ela realmente usa — as demais causam erro de senha, permissão e aviso por e-mail.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span className="ml-2">Atualizar</span>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>Não foi possível carregar o relatório: {error}</AlertDescription>
          </Alert>
        )}

        {loading && !rows.length && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Carregando…
          </div>
        )}

        {!loading && !error && groups.length === 0 && (
          <p className="text-sm text-muted-foreground py-2">Nenhuma conta duplicada encontrada.</p>
        )}

        {groups.map(([local, list]) => (
          <div key={local} className="rounded-md border border-border">
            <div className="px-3 py-2 text-sm font-medium bg-muted/50 rounded-t-md">
              {local} · {list.length} contas
            </div>
            <ul className="divide-y divide-border">
              {list.map((r, i) => (
                <li key={r.user_id} className="px-3 py-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono text-xs">{r.email}</span>
                  {i === 0 && <Badge variant="secondary">Em uso</Badge>}
                  {r.is_admin && <Badge variant="outline">Administrador</Badge>}
                  {r.has_sap_credentials && <Badge variant="outline">Senha do ERP salva</Badge>}
                  {r.group_count > 0 && <Badge variant="outline">{r.group_count} grupo(s)</Badge>}
                  <span className="ml-auto text-xs text-muted-foreground">
                    último acesso: {fmt(r.last_sign_in_at)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {groups.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Este relatório não altera nada. A desativação de uma conta duplicada deve ser feita
            manualmente, depois de confirmar com a pessoa qual e-mail ela usa para entrar.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default DuplicateIdentitiesCard;
