import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { KeyRound, Loader2 } from "lucide-react";
import { useSap } from "@/contexts/SapContext";
import { sapLogin, sapAction, sapQuery } from "@/lib/sap-client";
import { listSapTargetCompanies, changePasswordInCompanies, type MultiCompanyPasswordResult } from "@/lib/sap-multi-password";
import { toast } from "sonner";

interface CompanyOption {
  company_db: string;
  display_name: string;
}

export function ChangePasswordDialog() {
  const { session } = useSap();
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [otherCompanies, setOtherCompanies] = useState<CompanyOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open || !session) return;
    listSapTargetCompanies(session.companyDB).then((cs) => {
      setOtherCompanies(cs.map((c) => ({ company_db: c.company_db, display_name: c.display_name })));
    });
  }, [open, session]);

  const reset = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setSelected(new Set());
  };

  const toggle = (db: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(db)) next.delete(db);
      else next.add(db);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;

    if (newPassword !== confirmPassword) {
      toast.error("A nova senha e a confirmação não coincidem.");
      return;
    }

    if (newPassword.length < 4) {
      toast.error("A nova senha deve ter pelo menos 4 caracteres.");
      return;
    }

    setLoading(true);
    try {
      // Step 1: Validate current password via Login
      await sapLogin(session.userName, currentPassword, session.companyDB);

      // Step 2: Look up InternalKey for the current user (Users entity key is integer)
      const lookup = await sapQuery(
        session,
        `Users?$filter=UserCode eq '${session.userName.replace(/'/g, "''")}'&$select=InternalKey`,
        undefined,
        false,
      );
      const rows = Array.isArray(lookup.data)
        ? (lookup.data as Array<{ InternalKey?: number }>)
        : (((lookup.data as { value?: Array<{ InternalKey?: number }> })?.value) || []);
      const internalKey = rows[0]?.InternalKey;
      if (internalKey == null) throw new Error("Usuário não encontrado no SAP.");

      // Step 3: Change password in current company
      await sapAction(
        session,
        `Users(${internalKey})`,
        "PATCH",
        { UserPassword: newPassword }
      );

      // Step 3: Replicate to additional companies, if any
      let extraResults: MultiCompanyPasswordResult[] = [];
      if (selected.size > 0) {
        extraResults = await changePasswordInCompanies(session.userName, newPassword, Array.from(selected));
      }

      const failures = extraResults.filter((r) => r.status === "error");
      const skipped = extraResults.filter((r) => r.status === "skipped");
      const successes = extraResults.filter((r) => r.status === "success");

      if (extraResults.length === 0) {
        toast.success("Senha alterada com sucesso!");
      } else if (failures.length === 0) {
        toast.success(
          `Senha alterada em ${1 + successes.length} empresa(s)${skipped.length ? ` (${skipped.length} ignorada(s))` : ""}.`,
        );
      } else {
        toast.warning(
          `Alterada em ${1 + successes.length} empresa(s). Falhas: ${failures.map((f) => f.displayName).join(", ")}`,
        );
      }

      setOpen(false);
      reset();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao alterar senha";
      if (msg.includes("login") || msg.includes("Login") || msg.includes("Invalid")) {
        toast.error("Senha atual incorreta.");
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!session) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <button className="text-xs text-muted-foreground hover:text-foreground transition-colors" title="Alterar senha">
          <KeyRound className="w-4 h-4" />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Alterar Senha</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label htmlFor="current-pw">Senha Atual</Label>
            <Input
              id="current-pw"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-pw">Nova Senha</Label>
            <Input
              id="new-pw"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-pw">Confirmar Nova Senha</Label>
            <Input
              id="confirm-pw"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>

          {otherCompanies.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-border">
              <Label className="text-sm">Aplicar também em outras empresas</Label>
              <p className="text-xs text-muted-foreground">
                A nova senha será aplicada ao usuário <span className="font-medium text-foreground">{session.userName}</span> em cada empresa selecionada (caso exista).
              </p>
              <div className="max-h-40 overflow-y-auto space-y-2 rounded-md border border-border p-2">
                {otherCompanies.map((c) => (
                  <label key={c.company_db} className="flex items-center gap-2 cursor-pointer text-sm">
                    <Checkbox
                      checked={selected.has(c.company_db)}
                      onCheckedChange={() => toggle(c.company_db)}
                    />
                    <span className="text-foreground">{c.display_name}</span>
                    <span className="text-xs text-muted-foreground">({c.company_db})</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Alterar Senha
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
