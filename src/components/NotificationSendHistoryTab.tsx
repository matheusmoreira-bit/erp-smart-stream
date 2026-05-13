import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, RefreshCw, CheckCircle2, XCircle, AlertCircle, Users } from "lucide-react";
import { format } from "date-fns";

interface SendRun {
  id: string;
  function_name: string;
  status: string;
  recipients_count: number;
  error_message: string | null;
  details: Record<string, unknown> | null;
  sent_at: string;
}

const FUNCTION_LABEL: Record<string, string> = {
  "whatsapp-approval-watcher": "Aprovações (WhatsApp)",
  "whatsapp-login-watcher": "Falhas de login (WhatsApp)",
  "license-idle-watcher": "Licenças ociosas",
};

function StatusBadge({ status }: { status: string }) {
  if (status === "success")
    return (
      <Badge variant="outline" className="bg-green-500/15 text-green-600 border-green-500/30 gap-1">
        <CheckCircle2 className="w-3 h-3" /> Enviado
      </Badge>
    );
  if (status === "partial")
    return (
      <Badge variant="outline" className="bg-amber-500/15 text-amber-600 border-amber-500/30 gap-1">
        <AlertCircle className="w-3 h-3" /> Parcial
      </Badge>
    );
  return (
    <Badge variant="outline" className="bg-red-500/15 text-red-600 border-red-500/30 gap-1">
      <XCircle className="w-3 h-3" /> Erro
    </Badge>
  );
}

export function NotificationSendHistoryTab() {
  const today = new Date();
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [from, setFrom] = useState(format(sevenDaysAgo, "yyyy-MM-dd"));
  const [to, setTo] = useState(format(today, "yyyy-MM-dd"));
  const [runs, setRuns] = useState<SendRun[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const fromIso = new Date(`${from}T00:00:00`).toISOString();
      const toIso = new Date(`${to}T23:59:59.999`).toISOString();
      const { data } = await supabase
        .from("notification_send_runs")
        .select("*")
        .gte("sent_at", fromIso)
        .lte("sent_at", toIso)
        .order("sent_at", { ascending: false })
        .limit(500);
      setRuns((data as SendRun[]) || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        <div />
        <Button onClick={load} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Atualizar
        </Button>
      </div>

      <div className="text-xs text-muted-foreground">
        {runs.length} execuç{runs.length === 1 ? "ão" : "ões"}
      </div>

      <ScrollArea className="h-[calc(100vh-360px)]">
        {loading && runs.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">Carregando...</div>
        ) : runs.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            Nenhuma execução no período.
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Data</th>
                  <th className="text-left px-3 py-2 font-medium">Tipo de envio</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-left px-3 py-2 font-medium">Destinatários</th>
                  <th className="text-left px-3 py-2 font-medium">Erro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {runs.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30 align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">
                      {format(new Date(r.sent_at), "dd/MM/yy HH:mm:ss")}
                    </td>
                    <td className="px-3 py-2 text-xs font-medium">
                      {FUNCTION_LABEL[r.function_name] || r.function_name}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1 text-xs">
                        <Users className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="font-semibold">{r.recipients_count}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-red-600 max-w-md break-words">
                      {r.error_message || "—"}
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
