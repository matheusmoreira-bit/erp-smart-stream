import { useMemo, useState } from "react";
import {
  useApproverSubstitutes,
  statusOf,
  type ApproverSubstitute,
} from "@/hooks/useApproverSubstitutes";
import { useSapUsers } from "@/hooks/useSapUsers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { UserPlus, XCircle, Users, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  } catch { return iso; }
}

function StatusBadge({ row }: { row: ApproverSubstitute }) {
  const s = statusOf(row);
  const map = {
    active: { label: "Ativa", cls: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
    scheduled: { label: "Agendada", cls: "bg-blue-500/15 text-blue-600 border-blue-500/30" },
    expired: { label: "Expirada", cls: "bg-muted text-muted-foreground border-border" },
    revoked: { label: "Revogada", cls: "bg-red-500/15 text-red-600 border-red-500/30" },
  } as const;
  const cfg = map[s];
  return <Badge variant="outline" className={cfg.cls}>{cfg.label}</Badge>;
}

export default function SubstituteApproversTab({ isAdmin }: { isAdmin: boolean }) {
  const { rows, isLoading, create, revoke, refresh } = useApproverSubstitutes();
  const { users } = useSapUsers();
  const [showForm, setShowForm] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<ApproverSubstitute | null>(null);

  // form state
  const [officialEmail, setOfficialEmail] = useState("");
  const [officialName, setOfficialName] = useState("");
  const [substituteEmail, setSubstituteEmail] = useState("");
  const [substituteName, setSubstituteName] = useState("");
  const [startsAt, setStartsAt] = useState<string>(() => {
    const d = new Date(); d.setSeconds(0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [endsAt, setEndsAt] = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() + 7); d.setSeconds(0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const eligible = useMemo(
    () =>
      users.filter((u) => u.Locked !== "tYES" && (u.eMail || u.UserCode))
        .map((u) => ({
          email: (u.eMail || "").trim(),
          name: (u.UserName || u.UserCode || "").trim(),
          code: (u.UserCode || "").trim(),
        }))
        .filter((u) => u.email || u.name),
    [users],
  );

  const active = useMemo(() => rows.filter((r) => statusOf(r) === "active" || statusOf(r) === "scheduled"), [rows]);
  const history = useMemo(() => rows.filter((r) => statusOf(r) === "expired" || statusOf(r) === "revoked"), [rows]);

  const openCreate = () => {
    setOfficialEmail(""); setOfficialName("");
    setSubstituteEmail(""); setSubstituteName("");
    setReason("");
    setShowForm(true);
  };

  const submit = async () => {
    if (!officialEmail || !substituteEmail) { toast.error("Selecione oficial e substituto"); return; }
    if (officialEmail.toLowerCase() === substituteEmail.toLowerCase()) {
      toast.error("Oficial e substituto devem ser diferentes"); return;
    }
    const s = new Date(startsAt).toISOString();
    const e = new Date(endsAt).toISOString();
    if (new Date(e) <= new Date(s)) { toast.error("Fim deve ser posterior ao início"); return; }
    setSubmitting(true);
    try {
      await create({
        official_email: officialEmail,
        official_name: officialName || null,
        substitute_email: substituteEmail,
        substitute_name: substituteName || null,
        starts_at: s,
        ends_at: e,
        reason: reason || null,
      });
      toast.success("Substituição criada");
      setShowForm(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar substituição");
    } finally {
      setSubmitting(false);
    }
  };

  const doRevoke = async () => {
    if (!pendingRevoke) return;
    try {
      await revoke(pendingRevoke.id, "Revogada pelo administrador");
      toast.success("Substituição revogada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao revogar");
    } finally {
      setPendingRevoke(null);
    }
  };

  const list = showHistory ? history : active;

  return (
    <div className="space-y-4">
      <div className="glass-card p-4 border-l-2 border-l-primary/40">
        <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-primary" /> Aprovadores substitutos
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          O substituto vê e pode aprovar em nome do aprovador oficial apenas durante a janela definida.
          Toda concessão e revogação fica registrada de forma imutável em cadeia de hash (audit_trail).
        </p>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant={showHistory ? "outline" : "default"}
            size="sm"
            onClick={() => setShowHistory(false)}
          >
            Ativas / agendadas
            <span className="ml-1.5 text-[10px] font-mono bg-background/40 px-1.5 py-0.5 rounded">{active.length}</span>
          </Button>
          <Button
            variant={showHistory ? "default" : "outline"}
            size="sm"
            onClick={() => setShowHistory(true)}
          >
            Histórico
            <span className="ml-1.5 text-[10px] font-mono bg-background/40 px-1.5 py-0.5 rounded">{history.length}</span>
          </Button>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={openCreate} className="gap-1.5">
            <UserPlus className="w-4 h-4" /> Nova substituição
          </Button>
        )}
      </div>

      <div className="glass-card overflow-hidden">
        {isLoading ? (
          <div className="p-10 flex items-center justify-center text-muted-foreground">
            <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Carregando…
          </div>
        ) : list.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
            <Users className="w-6 h-6 opacity-50" />
            {showHistory ? "Nenhuma substituição encerrada." : "Nenhuma substituição ativa."}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Aprovador oficial</TableHead>
                <TableHead>Substituto</TableHead>
                <TableHead>Período (BRT)</TableHead>
                <TableHead>Concedida por</TableHead>
                <TableHead>Motivo</TableHead>
                {isAdmin && !showHistory && <TableHead className="text-right">Ações</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((r) => (
                <TableRow key={r.id}>
                  <TableCell><StatusBadge row={r} /></TableCell>
                  <TableCell className="text-sm">
                    <div className="font-medium">{r.official_name || r.official_email}</div>
                    <div className="text-xs text-muted-foreground font-mono">{r.official_email}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="font-medium">{r.substitute_name || r.substitute_email}</div>
                    <div className="text-xs text-muted-foreground font-mono">{r.substitute_email}</div>
                  </TableCell>
                  <TableCell className="text-xs">
                    <div>{fmtDate(r.starts_at)}</div>
                    <div className="text-muted-foreground">até {fmtDate(r.ends_at)}</div>
                    {r.revoked_at && (
                      <div className="text-red-600 mt-0.5">Revogada {fmtDate(r.revoked_at)}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    <div className="font-mono">{r.granted_by_email}</div>
                    <div className="text-muted-foreground">{fmtDate(r.created_at)}</div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[240px]">
                    <div>{r.reason || "—"}</div>
                    {r.revoked_reason && (
                      <div className="text-red-600 mt-0.5">Revog.: {r.revoked_reason}</div>
                    )}
                  </TableCell>
                  {isAdmin && !showHistory && (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:text-red-700"
                        onClick={() => setPendingRevoke(r)}
                      >
                        <XCircle className="w-4 h-4 mr-1" /> Revogar
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Nova substituição de aprovador</DialogTitle>
            <DialogDescription>
              Enquanto a janela estiver ativa, o substituto poderá visualizar e aprovar todos os
              documentos pendentes do aprovador oficial.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Aprovador oficial</Label>
              <Select
                value={officialEmail}
                onValueChange={(v) => {
                  setOfficialEmail(v);
                  const u = eligible.find((x) => x.email === v);
                  setOfficialName(u?.name || "");
                }}
              >
                <SelectTrigger><SelectValue placeholder="Selecione o oficial" /></SelectTrigger>
                <SelectContent>
                  {eligible.filter((u) => u.email).map((u) => (
                    <SelectItem key={`off-${u.email}`} value={u.email}>
                      {u.name} <span className="opacity-60">({u.email})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Substituto</Label>
              <Select
                value={substituteEmail}
                onValueChange={(v) => {
                  setSubstituteEmail(v);
                  const u = eligible.find((x) => x.email === v);
                  setSubstituteName(u?.name || "");
                }}
              >
                <SelectTrigger><SelectValue placeholder="Selecione o substituto" /></SelectTrigger>
                <SelectContent>
                  {eligible.filter((u) => u.email && u.email.toLowerCase() !== officialEmail.toLowerCase()).map((u) => (
                    <SelectItem key={`sub-${u.email}`} value={u.email}>
                      {u.name} <span className="opacity-60">({u.email})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Início (BRT)</Label>
              <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Fim (BRT)</Label>
              <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label className="text-xs">Motivo / observação</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex.: férias do Marco Tulio de 15/07 a 22/07"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowForm(false)} disabled={submitting}>Cancelar</Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <UserPlus className="w-4 h-4 mr-1.5" />}
              Conceder substituição
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!pendingRevoke}
        onOpenChange={(o) => !o && setPendingRevoke(null)}
        title="Revogar substituição?"
        description={
          pendingRevoke
            ? `Encerra imediatamente o direito de ${pendingRevoke.substitute_name || pendingRevoke.substitute_email} de aprovar em nome de ${pendingRevoke.official_name || pendingRevoke.official_email}. A revogação fica registrada no audit trail.`
            : ""
        }
        confirmLabel="Revogar"
        destructive
        onConfirm={doRevoke}
      />
    </div>
  );
}
