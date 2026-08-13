import { useEffect, useMemo, useState } from "react";
import {
  useApproverSubstitutes,
  statusOf,
  type ApproverSubstitute,
} from "@/hooks/useApproverSubstitutes";
import { useSapUsers } from "@/hooks/useSapUsers";
import { useSap } from "@/contexts/SapContext";
import { supabase } from "@/integrations/supabase/client";

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
import { UserPlus, XCircle, Users, Loader2, ShieldCheck, CalendarClock } from "lucide-react";
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

function localPart(v: string): string {
  const n = (v || "").toLowerCase().trim();
  const i = n.indexOf("@");
  return i > 0 ? n.slice(0, i) : n;
}

export default function SubstituteApproversTab({ isAdmin = false }: { isAdmin?: boolean }) {
  const { rows, isLoading, create, revoke, refresh, canManageAll } = useApproverSubstitutes();
  const { users, isLoading: usersLoading } = useSapUsers();
  /** Fallback: diretório de usuários no Cloud (usado quando o ERP não devolve a lista). */
  const [dirUsers, setDirUsers] = useState<Array<{ email: string; name: string; code: string }>>([]);
  const [dirLoading, setDirLoading] = useState(false);

  const { session } = useSap();
  const [authEmail, setAuthEmail] = useState<string>("");
  const [showForm, setShowForm] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<ApproverSubstitute | null>(null);
  const [selfMode, setSelfMode] = useState(false);

  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(({ data }) => {
      if (alive) setAuthEmail((data.user?.email || "").toLowerCase());
    });
    return () => { alive = false; };
  }, []);

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
  /** Escopo opcional por diretoria/CC (ex.: "1.8" ou "1.8, 1.6.1"). Vazio = todos. */
  const [ccScope, setCcScope] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const sapEligible = useMemo(
    () =>
      users.filter((u) => u.Locked !== "tYES" && (u.eMail || u.UserCode))
        .map((u) => ({
          email: (u.eMail || "").trim(),
          name: (u.UserName || u.UserCode || "").trim(),
          code: (u.UserCode || "").trim(),
        }))
        .filter((u) => u.email),
    [users],
  );

  // Carrega o diretório do Cloud sempre que o ERP não devolver usuários com e-mail.
  useEffect(() => {
    if (usersLoading || sapEligible.length > 0) return;
    let alive = true;
    setDirLoading(true);
    (async () => {
      try {
        const [{ data: dir }, { data: emails }] = await Promise.all([
          supabase.from("sap_user_directory").select("user_key, sap_user_code, display_name, is_active"),
          supabase.from("sap_user_emails").select("user_key, email, is_primary"),
        ]);
        if (!alive) return;
        const byKey = new Map<string, { email: string; name: string; code: string }>();
        for (const e of emails || []) {
          const key = (e.user_key || "").toLowerCase();
          const email = (e.email || "").trim();
          if (!key || !email) continue;
          const existing = byKey.get(key);
          if (!existing || e.is_primary) byKey.set(key, { email, name: "", code: "" });
        }
        const list: Array<{ email: string; name: string; code: string }> = [];
        for (const d of dir || []) {
          if (d.is_active === false) continue;
          const key = (d.user_key || "").toLowerCase();
          const found = byKey.get(key);
          if (!found) continue;
          list.push({
            email: found.email,
            name: (d.display_name || d.sap_user_code || found.email).trim(),
            code: (d.sap_user_code || "").trim(),
          });
        }
        list.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
        setDirUsers(list);
      } catch {
        if (alive) setDirUsers([]);
      } finally {
        if (alive) setDirLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [usersLoading, sapEligible.length]);

  const eligible = useMemo(
    () => (sapEligible.length > 0 ? sapEligible : dirUsers),
    [sapEligible, dirUsers],
  );
  const eligibleLoading = usersLoading || (sapEligible.length === 0 && dirLoading);


  const canManage = isAdmin || canManageAll;

  /** Identificadores do usuário logado (e-mail Cloud e usuário SAP). */
  const myIdentities = useMemo(() => {
    const set = new Set<string>();
    for (const v of [authEmail, session?.userName || ""]) {
      const n = (v || "").toLowerCase().trim();
      if (!n) continue;
      set.add(n);
      set.add(localPart(n));
    }
    return set;
  }, [authEmail, session?.userName]);

  const isMine = (value: string | null | undefined) => {
    const v = (value || "").toLowerCase().trim();
    if (!v) return false;
    return myIdentities.has(v) || myIdentities.has(localPart(v));
  };

  /** Meu registro na lista de usuários do ERP (para preencher o formulário). */
  const me = useMemo(
    () => eligible.find((u) => isMine(u.email) || isMine(u.name) || isMine(u.code)) || null,
    [eligible, myIdentities], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const active = useMemo(() => rows.filter((r) => statusOf(r) === "active" || statusOf(r) === "scheduled"), [rows]);
  const history = useMemo(() => rows.filter((r) => statusOf(r) === "expired" || statusOf(r) === "revoked"), [rows]);

  const openCreate = (self: boolean) => {
    setSelfMode(self);
    if (self) {
      const email = me?.email || authEmail || session?.userName || "";
      setOfficialEmail(email);
      setOfficialName(me?.name || "");
    } else {
      setOfficialEmail(""); setOfficialName("");
    }
    setSubstituteEmail(""); setSubstituteName("");
    setReason("");
    setCcScope("");
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
    const ccPrefixes = ccScope
      .split(/[,;\s]+/)
      .map((v) => v.trim().replace(/%+$/, "").replace(/\.+$/, ""))
      .filter(Boolean);
    const invalid = ccPrefixes.filter((v) => !/^[0-9]+(\.[0-9]+)*$/.test(v));
    if (invalid.length > 0) {
      toast.error(`Centro de custo inválido: ${invalid.join(", ")}`);
      return;
    }
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
        cost_center_prefixes: ccPrefixes.length ? ccPrefixes : null,
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
        <div className="flex items-center gap-2">
          <Button size="sm" variant={canManage ? "outline" : "default"} onClick={() => openCreate(true)} className="gap-1.5">
            <CalendarClock className="w-4 h-4" /> Definir meu substituto (férias)
          </Button>
          {canManage && (
            <Button size="sm" onClick={() => openCreate(false)} className="gap-1.5">
              <UserPlus className="w-4 h-4" /> Nova substituição
            </Button>
          )}
        </div>

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
                <TableHead>Escopo (CC)</TableHead>
                <TableHead>Período (BRT)</TableHead>
                <TableHead>Concedida por</TableHead>
                <TableHead>Motivo</TableHead>
                {!showHistory && <TableHead className="text-right">Ações</TableHead>}
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
                    {r.cost_center_prefixes && r.cost_center_prefixes.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {r.cost_center_prefixes.map((p) => (
                          <Badge key={p} variant="outline" className="font-mono text-[10px]">{p}.%</Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Todos</span>
                    )}
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
                  {!showHistory && (
                    <TableCell className="text-right">
                      {(canManage || isMine(r.official_email) || isMine(r.granted_by_email)) ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => setPendingRevoke(r)}
                        >
                          <XCircle className="w-4 h-4 mr-1" /> Revogar
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
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
            <DialogTitle>
              {selfMode ? "Definir meu substituto (ausência/férias)" : "Nova substituição de aprovador"}
            </DialogTitle>
            <DialogDescription>
              Enquanto a janela estiver ativa, o substituto poderá visualizar e aprovar todos os
              documentos pendentes do aprovador oficial. A concessão fica registrada no audit log.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Aprovador oficial</Label>
              {selfMode ? (
                <Input value={officialName ? `${officialName} (${officialEmail})` : officialEmail} disabled />
              ) : (
                <Select
                  value={officialEmail}
                  onValueChange={(v) => {
                    setOfficialEmail(v);
                    const u = eligible.find((x) => x.email === v);
                    setOfficialName(u?.name || "");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={eligibleLoading ? "Carregando usuários..." : "Selecione o oficial"} />
                  </SelectTrigger>
                  <SelectContent>
                    {eligible.length === 0 && (
                      <div className="px-2 py-3 text-xs text-muted-foreground">
                        {eligibleLoading ? "Carregando usuários..." : "Nenhum usuário disponível"}
                      </div>
                    )}
                    {eligible.filter((u) => u.email).map((u) => (
                      <SelectItem key={`off-${u.email}`} value={u.email}>
                        {u.name} <span className="opacity-60">({u.email})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>

                </Select>
              )}
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
                <SelectTrigger>
                  <SelectValue placeholder={eligibleLoading ? "Carregando usuários..." : "Selecione o substituto"} />
                </SelectTrigger>
                <SelectContent>
                  {eligible.length === 0 && (
                    <div className="px-2 py-3 text-xs text-muted-foreground">
                      {eligibleLoading ? "Carregando usuários..." : "Nenhum usuário disponível"}
                    </div>
                  )}
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
              <Label className="text-xs">Restringir a centros de custo (opcional)</Label>
              <Input
                value={ccScope}
                onChange={(e) => setCcScope(e.target.value)}
                placeholder="Ex.: 1.8 (vale para 1.8 e todos os 1.8.x). Vazio = todas as alçadas do oficial."
              />
              <p className="text-[11px] text-muted-foreground">
                Separe por vírgula para mais de uma diretoria. O substituto verá apenas documentos
                cujos centros de custo estejam nesses ramos.
              </p>
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
