import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, CheckCircle2, AlertCircle, MinusCircle } from "lucide-react";
import {
  listSapTargetCompanies,
  changePasswordInCompanies,
  type MultiCompanyPasswordResult,
} from "@/lib/sap-multi-password";
import { toast } from "sonner";

interface CompanyOption {
  company_db: string;
  display_name: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userCode: string;
  userName?: string;
  currentCompanyDb: string;
  currentCompanyName?: string;
  onDone?: () => void;
}

export function BackofficeChangePasswordDialog({
  open, onOpenChange, userCode, userName, currentCompanyDb, currentCompanyName, onDone,
}: Props) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [otherCompanies, setOtherCompanies] = useState<CompanyOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<MultiCompanyPasswordResult[] | null>(null);

  useEffect(() => {
    if (!open) return;
    listSapTargetCompanies(currentCompanyDb).then((cs) => {
      setOtherCompanies(cs.map((c) => ({ company_db: c.company_db, display_name: c.display_name })));
    });
  }, [open, currentCompanyDb]);

  const reset = () => {
    setNewPassword("");
    setConfirmPassword("");
    setSelected(new Set());
    setSummary(null);
  };

  const toggle = (db: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(db)) next.delete(db); else next.add(db);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("A nova senha e a confirmação não coincidem.");
      return;
    }
    if (newPassword.length < 4) {
      toast.error("A nova senha deve ter pelo menos 4 caracteres.");
      return;
    }

    setLoading(true);
    setSummary(null);
    try {
      const targets = [currentCompanyDb, ...Array.from(selected)];
      const results = await changePasswordInCompanies(userCode, newPassword, targets);
      // Ensure current company shows the friendly name even if listSapTargetCompanies excluded it
      const fixed = results.map((r) =>
        r.companyDB === currentCompanyDb && currentCompanyName
          ? { ...r, displayName: currentCompanyName }
          : r,
      );
      setSummary(fixed);

      const successes = fixed.filter((r) => r.status === "success").length;
      const skipped = fixed.filter((r) => r.status === "skipped").length;
      const failures = fixed.filter((r) => r.status === "error").length;

      if (failures === 0 && successes > 0) {
        toast.success(
          `Senha alterada em ${successes} empresa(s)${skipped ? ` (${skipped} ignorada(s))` : ""}. Usuário desbloqueado.`,
        );
        onDone?.();
      } else if (failures === 0 && successes === 0) {
        toast.info(`Nenhuma alteração aplicada (${skipped} ignorada(s)).`);
      } else if (successes > 0) {
        toast.warning(`Concluído com falhas: ${successes} sucesso(s), ${skipped} ignorada(s), ${failures} erro(s).`);
        onDone?.();
      } else {
        toast.error(`Falhou em todas as empresas (${failures}).`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao alterar senha");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Redefinir senha</DialogTitle>
          <DialogDescription>
            {userCode}{userName ? ` — ${userName}` : ""}. O usuário será desbloqueado automaticamente.
          </DialogDescription>
        </DialogHeader>

        {summary ? (
          <div className="space-y-3 mt-2">
            <p className="text-sm text-muted-foreground">Resumo da operação:</p>
            <div className="max-h-64 overflow-y-auto space-y-1.5 rounded-md border border-border p-2">
              {summary.map((r) => (
                <div key={r.companyDB} className="flex items-start gap-2 text-sm">
                  {r.status === "success" && <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />}
                  {r.status === "skipped" && <MinusCircle className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />}
                  {r.status === "error" && <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="text-foreground font-medium">{r.displayName}</div>
                    {r.message && (
                      <div className={`text-xs ${r.status === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                        {r.message}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={reset}>Nova alteração</Button>
              <Button className="flex-1" onClick={() => { onOpenChange(false); reset(); }}>Fechar</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label htmlFor="bo-new-pw">Nova Senha</Label>
              <Input
                id="bo-new-pw"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bo-confirm-pw">Confirmar Nova Senha</Label>
              <Input
                id="bo-confirm-pw"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>

            <div className="space-y-2 pt-2 border-t border-border">
              <Label className="text-sm">Aplicar em outras empresas</Label>
              <p className="text-xs text-muted-foreground">
                A senha sempre será alterada em <span className="font-medium text-foreground">{currentCompanyName || currentCompanyDb}</span>. Selecione bases adicionais onde o mesmo código de usuário existe. Empresas sem o usuário ou com senha igual à anterior serão ignoradas.
              </p>
              {otherCompanies.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Nenhuma outra empresa SAP cadastrada.</p>
              ) : (
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
              )}
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Redefinir senha
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
