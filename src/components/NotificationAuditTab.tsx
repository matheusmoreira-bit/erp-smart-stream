import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, RefreshCw, MessageCircle, Mail, AlertTriangle, ShieldCheck, Search } from "lucide-react";
import { format } from "date-fns";

type Channel = "whatsapp" | "email" | "in_app";
type Kind = "approval" | "login_failure" | "license_idle" | "in_app";

interface AuditEntry {
  id: string;
  sent_at: string;
  channel: Channel;
  kind: Kind;
  recipient: string;
  company_db: string | null;
  title: string;
  details: string;
  payload: Record<string, unknown>;
}

const KIND_LABEL: Record<Kind, string> = {
  approval: "Aprovação",
  login_failure: "Falha de login",
  license_idle: "Licença ociosa",
  in_app: "In-App",
};

const KIND_COLOR: Record<Kind, string> = {
  approval: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  login_failure: "bg-red-500/15 text-red-600 border-red-500/30",
  license_idle: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  in_app: "bg-violet-500/15 text-violet-600 border-violet-500/30",
};

function ChannelIcon({ channel }: { channel: Channel }) {
  if (channel === "whatsapp") return <MessageCircle className="w-3.5 h-3.5" />;
  if (channel === "email") return <Mail className="w-3.5 h-3.5" />;
  return <ShieldCheck className="w-3.5 h-3.5" />;
}

export function NotificationAuditTab() {
  const today = new Date();
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [from, setFrom] = useState(format(sevenDaysAgo, "yyyy-MM-dd"));
  const [to, setTo] = useState(format(today, "yyyy-MM-dd"));
  const [recipient, setRecipient] = useState("");
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const fromIso = new Date(`${from}T00:00:00`).toISOString();
      const toIso = new Date(`${to}T23:59:59.999`).toISOString();

      const [approvals, logins, idle, inApp] = await Promise.all([
        supabase
          .from("whatsapp_approval_alerts")
          .select("id, sent_at, whatsapp_to, company_db, approval_request_id, payload")
          .gte("sent_at", fromIso)
          .lte("sent_at", toIso)
          .order("sent_at", { ascending: false }),
        supabase
          .from("whatsapp_login_alerts")
          .select("id, sent_at, whatsapp_to, company_db, user_code, failure_key, payload")
          .gte("sent_at", fromIso)
          .lte("sent_at", toIso)
          .order("sent_at", { ascending: false }),
        supabase
          .from("license_idle_alerts")
          .select("id, sent_at, whatsapp_to, email_to, company_db, user_code, license_type, days_idle, payload")
          .gte("sent_at", fromIso)
          .lte("sent_at", toIso)
          .order("sent_at", { ascending: false }),
        supabase
          .from("notifications")
          .select("id, created_at, user_identifier, company_db, title, body, category, metadata")
          .gte("created_at", fromIso)
          .lte("created_at", toIso)
          .order("created_at", { ascending: false })
          .limit(500),
      ]);

      const merged: AuditEntry[] = [];

      for (const r of approvals.data || []) {
        const p = (r.payload || {}) as Record<string, unknown>;
        merged.push({
          id: `ap-${r.id}`,
          sent_at: r.sent_at,
          channel: "whatsapp",
          kind: "approval",
          recipient: r.whatsapp_to,
          company_db: r.company_db,
          title: `Aprovação #${r.approval_request_id}`,
          details: `${p.tipo ?? "Documento"} • ${p.fornecedor ?? "—"} • ${p.valor ?? ""}`,
          payload: p,
        });
      }

      for (const r of logins.data || []) {
        const p = (r.payload || {}) as Record<string, unknown>;
        merged.push({
          id: `lg-${r.id}`,
          sent_at: r.sent_at,
          channel: "whatsapp",
          kind: "login_failure",
          recipient: r.whatsapp_to,
          company_db: r.company_db,
          title: `Falha de login • ${r.user_code}`,
          details: String(r.failure_key || ""),
          payload: p,
        });
      }

      for (const r of idle.data || []) {
        const p = (r.payload || {}) as Record<string, unknown>;
        const ch: Channel = r.whatsapp_to ? "whatsapp" : "email";
        merged.push({
          id: `id-${r.id}`,
          sent_at: r.sent_at,
          channel: ch,
          kind: "license_idle",
          recipient: r.whatsapp_to || r.email_to || "—",
          company_db: r.company_db,
          title: `Licença ociosa • ${r.user_code}`,
          details: `${r.license_type ?? "—"} • ${r.days_idle ?? 0} dias`,
          payload: p,
        });
      }

      for (const r of inApp.data || []) {
        merged.push({
          id: `na-${r.id}`,
          sent_at: r.created_at,
          channel: "in_app",
          kind: "in_app",
          recipient: r.user_identifier,
          company_db: r.company_db,
          title: r.title,
          details: r.body || "",
          payload: (r.metadata || {}) as Record<string, unknown>,
        });
      }

      merged.sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1));
      setEntries(merged);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = recipient.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.recipient?.toLowerCase().includes(q));
  }, [entries, recipient]);

  return (
    <div className="space-y-4">
      <div className="glass-card p-4 grid grid-cols-1 md:grid-cols-[140px_140px_1fr_auto] gap-3 items-end">
        <div>
          <Label className="text-xs">De</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Até</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Destinatário</Label>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="telefone, e-mail ou usuário…"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            />
          </div>
        </div>
        <Button onClick={load} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Atualizar
        </Button>
      </div>

      <div className="text-xs text-muted-foreground">
        {filtered.length} registro{filtered.length === 1 ? "" : "s"}
      </div>

      <ScrollArea className="h-[calc(100vh-360px)]">
        {loading && entries.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground flex flex-col items-center gap-2">
            <AlertTriangle className="w-6 h-6" />
            Nenhuma notificação no período.
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Data</th>
                  <th className="text-left px-3 py-2 font-medium">Tipo</th>
                  <th className="text-left px-3 py-2 font-medium">Canal</th>
                  <th className="text-left px-3 py-2 font-medium">Destinatário</th>
                  <th className="text-left px-3 py-2 font-medium">Empresa</th>
                  <th className="text-left px-3 py-2 font-medium">Conteúdo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((e) => (
                  <tr key={e.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">
                      {format(new Date(e.sent_at), "dd/MM/yy HH:mm")}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className={`${KIND_COLOR[e.kind]} text-[10px]`}>
                        {KIND_LABEL[e.kind]}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <ChannelIcon channel={e.channel} />
                        {e.channel}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{e.recipient}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{e.company_db || "—"}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-xs">{e.title}</div>
                      {e.details && <div className="text-xs text-muted-foreground">{e.details}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
