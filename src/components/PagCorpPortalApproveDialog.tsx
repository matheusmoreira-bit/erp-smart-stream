import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Loader2, Link2Off, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { sapFunctionFetch } from "@/lib/auth-fetch";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyDb: string;
  accountabilityIds: string[];
  onApproved?: () => void;
}

interface SessionStatus {
  connected: boolean;
  expired?: boolean;
  expires_at?: string | null;
  portal_user?: string | null;
}

async function callPortal(payload: Record<string, unknown>) {
  const resp = await sapFunctionFetch("pagcorp-portal-approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.error || `Falha (HTTP ${resp.status})`);
  return data as Record<string, unknown>;
}

/** Aprovação em lote de prestações de contas diretamente no portal PagCorp. */
export function PagCorpPortalApproveDialog({
  open,
  onOpenChange,
  companyDb,
  accountabilityIds,
  onApproved,
}: Props) {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [cookie, setCookie] = useState("");
  const [csrfToken, setCsrfToken] = useState("");
  const [message, setMessage] = useState("");

  const loadStatus = useCallback(async () => {
    if (!companyDb) return;
    setLoading(true);
    try {
      const data = await callPortal({ action: "status", company_db: companyDb });
      setStatus(data as unknown as SessionStatus);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao verificar a sessão do portal");
      setStatus({ connected: false });
    } finally {
      setLoading(false);
    }
  }, [companyDb]);

  useEffect(() => {
    if (open) loadStatus();
  }, [open, loadStatus]);

  const handleSaveSession = async () => {
    setSaving(true);
    try {
      const data = await callPortal({
        action: "save-session",
        company_db: companyDb,
        cookie: cookie.trim(),
        csrf_token: csrfToken.trim(),
      });
      setStatus(data as unknown as SessionStatus);
      setCookie("");
      setCsrfToken("");
      toast.success("Sessão do portal conectada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível conectar a sessão");
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await callPortal({ action: "clear", company_db: companyDb });
      setStatus({ connected: false });
      toast.success("Sessão removida");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao remover a sessão");
    }
  };

  const handleApprove = async () => {
    setApproving(true);
    try {
      const data = await callPortal({
        action: "approve",
        company_db: companyDb,
        accountability_ids: accountabilityIds,
        message: message.trim(),
      });
      toast.success(`Prestações aprovadas no PagCorp (${Number(data.approved) || accountabilityIds.length})`);
      setMessage("");
      onApproved?.();
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao aprovar no PagCorp";
      toast.error(msg);
      if (/sess(ã|a)o/i.test(msg)) loadStatus();
    } finally {
      setApproving(false);
    }
  };

  const connected = !!status?.connected;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" />
            Aprovar prestações no PagCorp
          </DialogTitle>
          <DialogDescription>
            {accountabilityIds.length} prestação(ões) selecionada(s) — a aprovação é feita direto no portal
            PagCorp, com registro em auditoria.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : connected ? (
          <div className="space-y-4 py-1">
            <div className="flex items-center justify-between gap-2">
              <Badge variant="secondary" className="gap-1 bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                <CheckCircle2 className="w-3 h-3" />
                Sessão conectada{status?.portal_user ? ` (${status.portal_user})` : ""}
              </Badge>
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={handleDisconnect}>
                <Link2Off className="w-3.5 h-3.5" />
                Desconectar
              </Button>
            </div>
            {status?.expires_at && (
              <p className="text-xs text-muted-foreground">
                Válida até {new Date(status.expires_at).toLocaleString("pt-BR")}.
              </p>
            )}
            <div className="space-y-1">
              <Label htmlFor="pagcorp-approve-msg">Mensagem (opcional)</Label>
              <Textarea
                id="pagcorp-approve-msg"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={500}
                placeholder="Observação enviada junto da aprovação"
                className="bg-card"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-1">
            <p className="text-sm text-muted-foreground">
              Para aprovar daqui, conecte sua sessão do portal PagCorp: abra o portal já logado, pressione F12 →
              aba Rede, clique em qualquer ação da tela de comprovantes, copie o conteúdo do cabeçalho
              <span className="font-medium"> cookie </span> e do <span className="font-medium">x-csrf-token</span>.
              Os dados ficam guardados de forma cifrada, só para você, e expiram em 8 horas.
            </p>
            <div className="space-y-1">
              <Label htmlFor="pagcorp-cookie">Cookie da sessão</Label>
              <Textarea
                id="pagcorp-cookie"
                value={cookie}
                onChange={(e) => setCookie(e.target.value)}
                rows={4}
                placeholder="_ga=…; PHPSESSID=…; XSRF-TOKEN=…; pagcorp_acg_session=…"
                className="bg-card font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pagcorp-csrf">x-csrf-token</Label>
              <Input
                id="pagcorp-csrf"
                value={csrfToken}
                onChange={(e) => setCsrfToken(e.target.value)}
                placeholder="yL3UTFsivY2PsUD9…"
                className="bg-card font-mono text-xs"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          {connected ? (
            <Button
              onClick={handleApprove}
              disabled={approving || accountabilityIds.length === 0}
              className="gap-2"
            >
              {approving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Aprovar {accountabilityIds.length > 0 ? `(${accountabilityIds.length})` : ""}
            </Button>
          ) : (
            <Button
              onClick={handleSaveSession}
              disabled={saving || !cookie.trim() || !csrfToken.trim()}
              className="gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              Conectar sessão
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PagCorpPortalApproveDialog;
