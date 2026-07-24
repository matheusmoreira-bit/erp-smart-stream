import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, CheckCircle2, AlertCircle, MinusCircle, RefreshCw } from "lucide-react";
import {
  listSapTargetCompanies,
  changePasswordInCompanies,
  type MultiCompanyPasswordResult,
} from "@/lib/sap-multi-password";
import { PasswordPolicyChecklist } from "@/components/PasswordPolicyChecklist";
import { checkPasswordPolicy } from "@/lib/password-policy";
import { toast } from "sonner";

const DEFAULT_RESET_PASSWORD = "Sap@2025";

// Gera senha única forte para contornar o histórico de senhas do SAP
// quando "Sap@2025" já tiver sido usada no passado pelo usuário.
function generateUniquePassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const specials = "!@#$%&*?";
  const pick = (src: string) => src[Math.floor(Math.random() * src.length)];
  const rand = [pick(upper), pick(lower), pick(digits), pick(specials)];
  const all = upper + lower + digits + specials;
  for (let i = 0; i < 6; i++) rand.push(pick(all));
  return rand.sort(() => Math.random() - 0.5).join("");
}

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
  const [loading, setLoading] = useState(false);
  const [otherCompanies, setOtherCompanies] = useState<CompanyOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<MultiCompanyPasswordResult[] | null>(null);
  const [password, setPassword] = useState<string>(DEFAULT_RESET_PASSWORD);
  const policy = useMemo(() => checkPasswordPolicy(password, userCode), [password, userCode]);

  useEffect(() => {
    if (!open) return;
    setPassword(DEFAULT_RESET_PASSWORD);
    listSapTargetCompanies(currentCompanyDb).then((cs) => {
      setOtherCompanies(cs.map((c) => ({ company_db: c.company_db, display_name: c.display_name })));
    });
  }, [open, currentCompanyDb]);

  const reset = () => {
    setSelected(new Set());
    setSummary(null);
    setPassword(DEFAULT_RESET_PASSWORD);
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
    if (!policy.valid) {
      toast.error(`Senha não atende à política: ${policy.failed[0]?.label || "revise os requisitos"}`);
      return;
    }
    setLoading(true);
    setSummary(null);
    try {
      const targets = [currentCompanyDb, ...Array.from(selected)];
      const results = await changePasswordInCompanies(userCode, password, targets);
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
          `Senha redefinida em ${successes} empresa(s)${skipped ? ` (${skipped} ignorada(s))` : ""}. Usuário desbloqueado.`,
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
      toast.error(err instanceof Error ? err.message : "Erro ao redefinir senha");
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
            <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="new-password" className="text-sm">Nova senha temporária</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setPassword(generateUniquePassword())}
                >
                  <RefreshCw className="w-3 h-3 mr-1" /> Gerar única
                </Button>
              </div>
              <Input
                id="new-password"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="font-mono"
                autoComplete="off"
              />
              <PasswordPolicyChecklist password={password} userCode={userCode} />
              <p className="text-xs text-muted-foreground">
                Padrão: <span className="font-mono">{DEFAULT_RESET_PASSWORD}</span>. Se o SAP recusar por "senha igual à anterior" (histórico de senhas), clique em <span className="font-medium">Gerar única</span> para uma senha nova, ou digite uma manualmente. O usuário será solicitado a alterá-la no próximo login.
              </p>
            </div>


            <div className="space-y-2 pt-2 border-t border-border">
              <Label className="text-sm">Empresas onde a senha será redefinida</Label>
              <p className="text-xs text-muted-foreground">
                A senha sempre será redefinida em <span className="font-medium text-foreground">{currentCompanyName || currentCompanyDb}</span>. Selecione bases adicionais onde o mesmo código de usuário existe. Empresas sem o usuário ou com senha igual à anterior serão ignoradas.
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

            <Button type="submit" className="w-full" disabled={loading || !policy.valid}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Redefinir senha
            </Button>
          </form>

        )}
      </DialogContent>
    </Dialog>
  );
}
