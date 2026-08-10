import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Search, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { displayUserName } from "@/lib/user-display";

interface AuditRow {
  id: string;
  created_at: string;
  actor_email: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
}

const ACCESS_ACTIONS = [
  "user_",
  "group_",
  "license_",
  "idp_",
  "sap_user_",
  "admin_",
  "management_segment",
];

const ACTION_LABEL: Record<string, string> = {
  user_created: "Usuário criado",
  user_updated: "Usuário atualizado",
  user_locked: "Usuário bloqueado",
  user_unlocked: "Usuário desbloqueado",
  group_changed: "Grupo alterado",
  license_changed: "Licença alterada",
  idp_divergence_resolved_block: "Divergência IdP resolvida (bloqueio)",
  idp_divergence_bulk_resolved: "Divergências IdP resolvidas em lote",
  management_segment_changed: "Gestão alterada",
};

/** Trilha de auditoria das mudanças de acesso (quem mudou o quê, quando). */
export default function AccessAuditTab() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("audit_log")
      .select("id, created_at, actor_email, action, entity_type, entity_id, details")
      .order("created_at", { ascending: false })
      .limit(400);
    setRows((data as AuditRow[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows
      .filter((r) => ACCESS_ACTIONS.some((p) => r.action?.startsWith(p)) || r.entity_type === "user")
      .filter((r) =>
        !term
          ? true
          : [r.actor_email, r.action, r.entity_id, JSON.stringify(r.details ?? {})]
              .join(" ")
              .toLowerCase()
              .includes(term),
      );
  }, [rows, search]);

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por autor, ação ou usuário afetado..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 bg-card border-border"
        />
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-6 py-3 border-b border-border bg-muted/30">
          <ShieldCheck className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Auditoria de acessos</h3>
          <Badge variant="outline" className="text-[10px]">{filtered.length}</Badge>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando auditoria…
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 text-left">Data/Hora</th>
                  <th className="px-4 py-3 text-left">Autor</th>
                  <th className="px-4 py-3 text-left">Ação</th>
                  <th className="px-4 py-3 text-left">Usuário afetado</th>
                  <th className="px-4 py-3 text-left">Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-b-0 hover:bg-muted/20">
                    <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                      {new Date(r.created_at).toLocaleString("pt-BR")}
                    </td>
                    <td className="px-4 py-2 text-foreground">{displayUserName(r.actor_email || "—")}</td>
                    <td className="px-4 py-2">
                      <Badge variant="secondary">{ACTION_LABEL[r.action] || r.action}</Badge>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{r.entity_id || "—"}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground truncate max-w-[320px]">
                      {r.details ? JSON.stringify(r.details) : "—"}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center text-muted-foreground py-10">
                      Nenhum evento de acesso registrado
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
