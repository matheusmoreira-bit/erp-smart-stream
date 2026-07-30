import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, RefreshCw, Search, Mail, MessageCircle, Bell, Layers } from "lucide-react";
import { format } from "date-fns";

interface Delivery {
  id: string;
  occurred_at: string;
  channel: string;
  source: string;
  event: string;
  recipient: string | null;
  subject: string | null;
  status: string | null;
  error_message: string | null;
  company_db: string | null;
  metadata: Record<string, unknown> | null;
}

const CHANNEL_LABEL: Record<string, string> = {
  in_app: "In-App",
  email: "E-mail",
  whatsapp: "WhatsApp",
  slack: "Slack",
  batch: "Rotina",
};

const CHANNEL_ICON: Record<string, typeof Mail> = {
  in_app: Bell,
  email: Mail,
  whatsapp: MessageCircle,
  batch: Layers,
};

const OK_STATUS = new Set(["sent", "success", "read", "unread", "delivered", "ok"]);
const WARN_STATUS = new Set(["pending", "partial", "queued", "suppressed"]);

function StatusBadge({ status }: { status: string | null }) {
  const s = (status || "—").toLowerCase();
  if (OK_STATUS.has(s))
    return (
      <Badge variant="outline" className="bg-green-500/15 text-green-600 border-green-500/30">
        {status}
      </Badge>
    );
  if (WARN_STATUS.has(s))
    return (
      <Badge variant="outline" className="bg-amber-500/15 text-amber-600 border-amber-500/30">
        {status}
      </Badge>
    );
  return (
    <Badge variant="outline" className="bg-red-500/15 text-red-600 border-red-500/30">
      {status || "—"}
    </Badge>
  );
}

export function NotificationDeliveriesTab() {
  const { session } = useSap();
  const today = new Date();
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [from, setFrom] = useState(format(weekAgo, "yyyy-MM-dd"));
  const [to, setTo] = useState(format(today, "yyyy-MM-dd"));
  const [channel, setChannel] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc("get_notification_deliveries", {
        p_from: new Date(`${from}T00:00:00`).toISOString(),
        p_to: new Date(`${to}T23:59:59.999`).toISOString(),
        p_company_db: session?.companyDB || null,
        p_limit: 1000,
      });
      if (rpcError) throw rpcError;
      setRows((data as Delivery[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar envios");
    } finally {
      setLoading(false);
    }
  }, [from, to, session?.companyDB]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (channel !== "all" && r.channel !== channel) return false;
      if (status === "error" && OK_STATUS.has((r.status || "").toLowerCase())) return false;
      if (status === "ok" && !OK_STATUS.has((r.status || "").toLowerCase())) return false;
      if (!q) return true;
      return [r.event, r.recipient, r.subject, r.source, r.error_message]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rows, channel, status, search]);

  const counts = useMemo(() => {
    const byChannel: Record<string, number> = {};
    let errors = 0;
    for (const r of filtered) {
      byChannel[r.channel] = (byChannel[r.channel] || 0) + 1;
      if (!OK_STATUS.has((r.status || "").toLowerCase())) errors += 1;
    }
    return { byChannel, errors };
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="glass-card p-4 grid grid-cols-1 md:grid-cols-[140px_140px_160px_150px_1fr_auto] gap-3 items-end">
        <div>
          <Label className="text-xs">De</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Até</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Canal</Label>
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os canais</SelectItem>
              <SelectItem value="in_app">In-App</SelectItem>
              <SelectItem value="email">E-mail</SelectItem>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
              <SelectItem value="batch">Rotinas</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="ok">Sucesso</SelectItem>
              <SelectItem value="error">Falha / pendente</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Busca</Label>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Motivo, destinatário, assunto..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <Button onClick={load} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Atualizar
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{filtered.length} envio(s)</span>
        {Object.entries(counts.byChannel).map(([c, n]) => (
          <Badge key={c} variant="secondary">{CHANNEL_LABEL[c] || c}: {n}</Badge>
        ))}
        {counts.errors > 0 && (
          <Badge variant="outline" className="bg-red-500/15 text-red-600 border-red-500/30">
            {counts.errors} com falha/pendente
          </Badge>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <ScrollArea className="h-[calc(100vh-380px)]">
        {loading && rows.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">Nenhum envio no período.</div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Data</th>
                  <th className="text-left px-3 py-2 font-medium">Canal</th>
                  <th className="text-left px-3 py-2 font-medium">Motivo</th>
                  <th className="text-left px-3 py-2 font-medium">Destinatário</th>
                  <th className="text-left px-3 py-2 font-medium">Assunto</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-left px-3 py-2 font-medium">Detalhe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((r) => {
                  const Icon = CHANNEL_ICON[r.channel] || Bell;
                  return (
                    <tr key={`${r.source}-${r.id}`} className="hover:bg-muted/30">
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                        {format(new Date(r.occurred_at), "dd/MM/yyyy HH:mm")}
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5">
                          <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                          {CHANNEL_LABEL[r.channel] || r.channel}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-medium text-foreground">{r.event}</span>
                        <span className="block text-[11px] text-muted-foreground">{r.source}</span>
                      </td>
                      <td className="px-3 py-2 max-w-[220px] truncate" title={r.recipient || ""}>
                        {r.recipient || "—"}
                      </td>
                      <td className="px-3 py-2 max-w-[260px] truncate" title={r.subject || ""}>
                        {r.subject || "—"}
                      </td>
                      <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                      <td className="px-3 py-2 max-w-[220px] truncate text-destructive" title={r.error_message || ""}>
                        {r.error_message || ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
