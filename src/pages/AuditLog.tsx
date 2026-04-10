import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, RefreshCw, Loader2, Search, FileText, Clock, User, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuditLog } from "@/hooks/useAuditLog";

const ACTION_COLORS: Record<string, string> = {
  create: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  insert: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  update: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  delete: "bg-red-500/15 text-red-400 border-red-500/30",
  cascade_delete: "bg-red-500/15 text-red-400 border-red-500/30",
  approve: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  reject: "bg-red-500/15 text-red-400 border-red-500/30",
  login: "bg-primary/15 text-primary border-primary/30",
  logout: "bg-muted text-muted-foreground border-border",
  integrate: "bg-violet-500/15 text-violet-400 border-violet-500/30",
};

function getActionColor(action: string) {
  const key = Object.keys(ACTION_COLORS).find((k) => action.toLowerCase().includes(k));
  return key ? ACTION_COLORS[key] : "bg-muted text-muted-foreground border-border";
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function AuditLogPage() {
  const navigate = useNavigate();
  const { entries, isLoading, error, refresh } = useAuditLog();
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [daysFilter, setDaysFilter] = useState("7");

  const entityTypes = useMemo(() => {
    const set = new Set(entries.map((e) => e.entity_type));
    return Array.from(set).sort();
  }, [entries]);

  const actionTypes = useMemo(() => {
    const set = new Set(entries.map((e) => e.action));
    return Array.from(set).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    let list = entries;

    const days = parseInt(daysFilter);
    if (days > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      list = list.filter((e) => new Date(e.created_at) >= cutoff);
    }

    if (entityFilter !== "all") {
      list = list.filter((e) => e.entity_type === entityFilter);
    }

    if (actionFilter !== "all") {
      list = list.filter((e) => e.action === actionFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (e) =>
          e.actor_email?.toLowerCase().includes(q) ||
          e.action.toLowerCase().includes(q) ||
          e.entity_type.toLowerCase().includes(q) ||
          e.entity_id?.toLowerCase().includes(q) ||
          JSON.stringify(e.details).toLowerCase().includes(q)
      );
    }

    return list;
  }, [entries, search, entityFilter, actionFilter, daysFilter]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-foreground">Logs de Auditoria</h1>
              <p className="text-sm text-muted-foreground">Registro de todas as ações realizadas no sistema</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive text-sm">{error}</div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por email, ação, entidade..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-card border-border"
            />
          </div>
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-[160px] bg-card">
              <SelectValue placeholder="Ação" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas ações</SelectItem>
              {actionTypes.map((a) => (
                <SelectItem key={a} value={a}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={entityFilter} onValueChange={setEntityFilter}>
            <SelectTrigger className="w-[180px] bg-card">
              <SelectValue placeholder="Entidade" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas entidades</SelectItem>
              {entityTypes.map((e) => (
                <SelectItem key={e} value={e}>{e}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={daysFilter} onValueChange={setDaysFilter}>
            <SelectTrigger className="w-[140px] bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 dias</SelectItem>
              <SelectItem value="15">Últimos 15 dias</SelectItem>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="90">Últimos 90 dias</SelectItem>
              <SelectItem value="0">Todos</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Summary */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1"><FileText className="w-4 h-4" />{filtered.length} registros</span>
          <span className="flex items-center gap-1"><User className="w-4 h-4" />{new Set(filtered.map((e) => e.actor_email).filter(Boolean)).size} usuários</span>
          <span className="flex items-center gap-1"><Filter className="w-4 h-4" />{new Set(filtered.map((e) => e.entity_type)).size} entidades</span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Carregando logs…</span>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3 text-left">Data/Hora</th>
                    <th className="px-4 py-3 text-left">Usuário</th>
                    <th className="px-4 py-3 text-left">Ação</th>
                    <th className="px-4 py-3 text-left">Entidade</th>
                    <th className="px-4 py-3 text-left">ID</th>
                    <th className="px-4 py-3 text-left">Detalhes</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => (
                    <tr key={e.id} className="border-b border-border last:border-b-0 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDateTime(e.created_at)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-medium text-foreground truncate max-w-[180px]">
                        {e.actor_email || "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant="outline" className={getActionColor(e.action)}>
                          {e.action}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{e.entity_type}</td>
                      <td className="px-4 py-2.5 text-muted-foreground font-mono text-xs truncate max-w-[120px]">
                        {e.entity_id || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground text-xs truncate max-w-[250px]">
                        {e.details ? JSON.stringify(e.details) : "—"}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center text-muted-foreground py-12">
                        <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
                        Nenhum registro encontrado
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
