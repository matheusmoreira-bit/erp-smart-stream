import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, RefreshCw, Lock, Unlock, KeyRound, Pencil, Search, Users, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useSapUsersAdmin, type SapAdminUser } from "@/hooks/useSapUsersAdmin";
import { PageTitle } from "@/components/PageTitle";
import { BackofficeChangePasswordDialog } from "@/components/BackofficeChangePasswordDialog";

export default function SapUsersAdmin() {
  const navigate = useNavigate();
  const {
    companies, companyDb, setCompanyDb,
    users, loadingCompanies, loadingUsers, error,
    refresh, updateUser,
  } = useSapUsersAdmin();

  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<SapAdminUser | null>(null);
  const [editForm, setEditForm] = useState({ UserName: "", eMail: "", UserPermission: "", UserPassword: "" });
  const [savingId, setSavingId] = useState<number | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [pwdUser, setPwdUser] = useState<SapAdminUser | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      (u.UserCode || "").toLowerCase().includes(q) ||
      (u.UserName || "").toLowerCase().includes(q) ||
      (u.eMail || "").toLowerCase().includes(q)
    );
  }, [users, search]);

  const openEdit = (u: SapAdminUser) => {
    setEditing(u);
    setEditForm({
      UserName: u.UserName || "",
      eMail: u.eMail || "",
      UserPermission: u.UserPermission || "",
      UserPassword: "",
    });
  };

  const handleToggleLock = async (u: SapAdminUser) => {
    setSavingId(u.InternalKey);
    try {
      await updateUser(u.InternalKey, { Locked: u.Locked === "tYES" ? "tNO" : "tYES" });
      toast.success(u.Locked === "tYES" ? "Usuário desbloqueado" : "Usuário bloqueado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao alterar status");
    } finally {
      setSavingId(null);
    }
  };

  const handleResetPassword = async (u: SapAdminUser) => {
    const pwd = prompt(`Nova senha para ${u.UserCode}:`);
    if (!pwd) return;
    setSavingId(u.InternalKey);
    try {
      await updateUser(u.InternalKey, { UserPassword: pwd });
      toast.success("Senha redefinida");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao redefinir senha");
    } finally {
      setSavingId(null);
    }
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    setSavingEdit(true);
    try {
      const patch: Record<string, unknown> = {};
      if (editForm.UserName !== (editing.UserName || "")) patch.UserName = editForm.UserName;
      if (editForm.eMail !== (editing.eMail || "")) patch.eMail = editForm.eMail;
      if (editForm.UserPermission !== (editing.UserPermission || "")) patch.UserPermission = editForm.UserPermission || null;
      if (editForm.UserPassword) patch.UserPassword = editForm.UserPassword;
      if (Object.keys(patch).length === 0) {
        toast.info("Nenhuma alteração");
        setEditing(null);
        return;
      }
      await updateUser(editing.InternalKey, patch);
      toast.success("Usuário atualizado");
      setEditing(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <PageTitle title="Usuários SAP" />
      <header className="sticky top-0 z-30 bg-card/80 backdrop-blur border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/backoffice")}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Backoffice
          </Button>
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-muted-foreground" />
            <h1 className="text-xl font-bold text-foreground">Usuários SAP</h1>
          </div>
          <div className="ml-auto">
            <Button size="sm" variant="outline" onClick={() => navigate("/backoffice/sap-users/replicate")}>
              <Copy className="w-4 h-4 mr-1" /> Replicar entre bases
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[260px]">
            <Label className="text-xs text-muted-foreground">Empresa</Label>
            <Select value={companyDb} onValueChange={setCompanyDb} disabled={loadingCompanies}>
              <SelectTrigger className="bg-card">
                <SelectValue placeholder={loadingCompanies ? "Carregando..." : "Selecione"} />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.company_db} value={c.company_db}>
                    {c.display_name} <span className="text-muted-foreground text-xs ml-2">({c.company_db})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[240px]">
            <Label className="text-xs text-muted-foreground">Buscar</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 bg-card" placeholder="Código, nome ou e-mail" />
            </div>
          </div>
          <Button variant="outline" onClick={refresh} disabled={loadingUsers}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loadingUsers ? "animate-spin" : ""}`} /> Atualizar
          </Button>
        </div>

        {error && (
          <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-sm text-destructive">{error}</div>
        )}

        <div className="glass-card overflow-hidden">
          {loadingUsers ? (
            <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Grupo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">Nenhum usuário</TableCell></TableRow>
                ) : filtered.map((u) => {
                  const isLocked = u.Locked === "tYES";
                  const isSuper = u.Superuser === "tYES";
                  const busy = savingId === u.InternalKey;
                  return (
                    <TableRow key={u.InternalKey}>
                      <TableCell className="font-mono text-xs">{u.UserCode}</TableCell>
                      <TableCell>{u.UserName || "-"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{u.eMail || "-"}</TableCell>
                      <TableCell className="text-xs">{u.UserPermission || "-"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {isLocked
                            ? <Badge variant="destructive" className="text-[10px]">Bloqueado</Badge>
                            : <Badge variant="outline" className="text-[10px] border-emerald-500/50 text-emerald-500">Ativo</Badge>}
                          {isSuper && <Badge className="text-[10px] bg-amber-500/20 text-amber-500 border-amber-500/40">Super</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" disabled={busy} onClick={() => openEdit(u)} title="Editar">
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button size="icon" variant="ghost" disabled={busy} onClick={() => handleResetPassword(u)} title="Redefinir senha">
                            <KeyRound className="w-4 h-4" />
                          </Button>
                          <Button size="icon" variant="ghost" disabled={busy} onClick={() => handleToggleLock(u)} title={isLocked ? "Desbloquear" : "Bloquear"}>
                            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : isLocked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </main>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar usuário SAP</DialogTitle>
            <DialogDescription>{editing?.UserCode} — {companies.find((c) => c.company_db === companyDb)?.display_name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Nome</Label>
              <Input value={editForm.UserName} onChange={(e) => setEditForm({ ...editForm, UserName: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">E-mail</Label>
              <Input type="email" value={editForm.eMail} onChange={(e) => setEditForm({ ...editForm, eMail: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Grupo (UserPermission)</Label>
              <Input value={editForm.UserPermission} onChange={(e) => setEditForm({ ...editForm, UserPermission: e.target.value })} placeholder="Ex.: ADMIN" />
            </div>
            <div>
              <Label className="text-xs">Nova senha (opcional)</Label>
              <Input type="password" value={editForm.UserPassword} onChange={(e) => setEditForm({ ...editForm, UserPassword: e.target.value })} placeholder="Deixe vazio para manter" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={savingEdit}>Cancelar</Button>
            <Button onClick={handleSaveEdit} disabled={savingEdit}>
              {savingEdit && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
