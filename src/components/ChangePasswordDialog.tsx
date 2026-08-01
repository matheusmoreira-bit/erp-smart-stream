import { useState, useEffect, type ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { KeyRound, Loader2, CheckCircle2, AlertCircle, MinusCircle, ShieldAlert, Wand2, Eye, EyeOff, Copy } from "lucide-react";
import { useSap } from "@/contexts/SapContext";
import {
  listSapTargetCompanies,
  changePasswordInCompanies,
  type MultiCompanyPasswordResult,
} from "@/lib/sap-multi-password";
import { toast } from "sonner";
import { checkPasswordPolicy, generateStrongPassword } from "@/lib/password-policy";
import { PasswordPolicyChecklist } from "@/components/PasswordPolicyChecklist";
import { saveUserSapCredential } from "@/lib/user-sap-credentials";
import { clearErpLocalState } from "@/lib/clear-erp-local-state";


interface CompanyOption {
  company_db: string;
  display_name: string;
}

interface ChangePasswordDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
  warningMessage?: ReactNode;
}

export function ChangePasswordDialog({ open: openProp, onOpenChange, hideTrigger, warningMessage }: ChangePasswordDialogProps = {}) {
  const { session } = useSap();
  const [openState, setOpenState] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp! : openState;
  const setOpen = (v: boolean) => {
    if (!isControlled) setOpenState(v);
    onOpenChange?.(v);
  };
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [otherCompanies, setOtherCompanies] = useState<CompanyOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customPick, setCustomPick] = useState(false);
  const [managed, setManaged] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [summary, setSummary] = useState<MultiCompanyPasswordResult[] | null>(null);

  const isTest = (db: string) => db.toUpperCase().startsWith("TST");
  const prodCompanies = otherCompanies.filter((c) => !isTest(c.company_db));
  const testCompanies = otherCompanies.filter((c) => isTest(c.company_db));
  const allProdSelected = prodCompanies.length > 0 && prodCompanies.every((c) => selected.has(c.company_db));
  const allTestSelected = testCompanies.length > 0 && testCompanies.every((c) => selected.has(c.company_db));

  useEffect(() => {
    if (!open || !session) return;
    listSapTargetCompanies(session.companyDB).then((cs) => {
      const opts = cs.map((c) => ({ company_db: c.company_db, display_name: c.display_name }));
      setOtherCompanies(opts);
      setSelected(new Set(opts.map((o) => o.company_db)));
    });
  }, [open, session]);

  const reset = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setSelected(new Set(otherCompanies.map((o) => o.company_db)));
    setCustomPick(false);
    setSummary(null);
    setShowNew(false);
  };

  const toggleGroup = (group: "prod" | "test", checked: boolean) => {
    const list = group === "prod" ? prodCompanies : testCompanies;
    setSelected((prev) => {
      const next = new Set(prev);
      list.forEach((c) => {
        if (checked) next.add(c.company_db);
        else next.delete(c.company_db);
      });
      return next;
    });
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

    if (currentPassword && currentPassword === newPassword) {
      toast.error("A nova senha deve ser diferente da senha atual.");
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error("A nova senha e a confirmação não coincidem.");
      return;
    }

    const policy = checkPasswordPolicy(newPassword, session.userName);
    if (!policy.valid) {
      toast.error(`Senha não atende à política: ${policy.failed[0].label}`);
      return;
    }

    setLoading(true);
    setSummary(null);
    try {
      // Roteia TODAS as empresas (inclusive a atual) pela edge function
      // `sap-change-password`, que executa PATCH atômico + verificação via
      // login real. Assim garantimos que a nova senha realmente autentica —
      // um PATCH direto pela sessão do usuário pode retornar 204 mas não
      // aplicar a senha silenciosamente em algumas bases.
      const targets = new Set<string>([session.companyDB, ...Array.from(selected)]);
      const allResults = await changePasswordInCompanies(
        session.userName,
        newPassword,
        Array.from(targets),
        currentPassword,
        managed,
      );

      setSummary(allResults);

      if (managed) {
        // O servidor grava o login gerenciado logo após confirmar o login com a
        // nova senha (mesma string exata). Só salvamos pelo cliente quando o
        // servidor não conseguiu — e NUNCA em empresas onde a troca não foi
        // confirmada, para não deixar banco e SAP divergentes.
        const pending = allResults.filter((r) => r.verified === true && r.managedSaved !== true);
        const alreadySaved = allResults.filter((r) => r.managedSaved === true).length;
        const saveResults = await Promise.allSettled(
          pending.map((r) => saveUserSapCredential(r.companyDB, session.userName, newPassword)),
        );
        const savedOk = alreadySaved + saveResults.filter((r) => r.status === "fulfilled").length;
        const savedFail = saveResults.filter((r) => r.status === "rejected").length;
        const notVerified = allResults.filter((r) => r.verified !== true).length;
        if (savedOk > 0) {
          toast.success(`Login gerenciado salvo em ${savedOk} empresa(s).`);
        }
        if (savedFail > 0) {
          toast.warning(`Falha ao salvar login gerenciado em ${savedFail} empresa(s).`);
        }
        if (notVerified > 0) {
          toast.info(`${notVerified} empresa(s) sem troca confirmada — login gerenciado não foi salvo nelas.`);
        }
      }


      const successes = allResults.filter((r) => r.status === "success").length;
      const skipped = allResults.filter((r) => r.status === "skipped").length;
      const failures = allResults.filter((r) => r.status === "error").length;

      if (failures === 0 && successes > 0) {
        toast.success(
          `Senha alterada em ${successes} empresa(s)${skipped ? ` (${skipped} ignorada(s))` : ""}.`,
        );
      } else if (failures === 0 && successes === 0) {

        toast.info(`Nenhuma alteração aplicada (${skipped} ignorada(s)).`);
      } else if (successes > 0) {
        toast.warning(`Concluído com falhas: ${successes} sucesso(s), ${skipped} ignorada(s), ${failures} erro(s).`);
      } else {
        const firstError = allResults.find((r) => r.status === "error")?.message;
        toast.error(
          `Falhou em todas as empresas (${failures})${firstError ? `: ${firstError}` : ""}. Veja o resumo abaixo.`,
        );
      }

      // Sessões ERP ativas são revogadas no servidor após a troca de senha:
      // encerramos o estado local e pedimos novo login.
      if (successes > 0) {
        toast.info("Por segurança, sua sessão foi encerrada. Faça login novamente com a nova senha.");
        setTimeout(() => {
          clearErpLocalState();
          window.location.replace("/");
        }, 2500);
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao alterar senha";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  if (!session) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      {!hideTrigger && (
        <DialogTrigger asChild>
          <button className="text-xs text-muted-foreground hover:text-foreground transition-colors" title="Alterar senha">
            <KeyRound className="w-4 h-4" />
          </button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Alterar Senha</DialogTitle>
        </DialogHeader>

        {warningMessage && !summary && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
            <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
            <div>{warningMessage}</div>
          </div>
        )}

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
              <Button className="flex-1" onClick={() => { setOpen(false); reset(); }}>Fechar</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label htmlFor="current-pw">
                Senha Atual <span className="text-xs text-muted-foreground">(opcional)</span>
              </Label>
              <Input
                id="current-pw"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Deixe em branco se não lembrar"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-pw">Nova Senha</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="new-pw"
                    type={showNew ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    className="pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showNew ? "Ocultar senha" : "Mostrar senha"}
                  >
                    {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  title="Gerar senha segura"
                  aria-label="Gerar senha segura"
                  onClick={() => {
                    const generated = generateStrongPassword(16, session.userName);
                    setNewPassword(generated);
                    setConfirmPassword(generated);
                    setShowNew(true);
                  }}
                >
                  <Wand2 className="w-4 h-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  title="Copiar senha"
                  aria-label="Copiar senha"
                  disabled={!newPassword}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(newPassword);
                      toast.success("Senha copiada");
                    } catch {
                      toast.error("Não foi possível copiar");
                    }
                  }}
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
              <PasswordPolicyChecklist password={newPassword} userCode={session.userName} />
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
                <p className="text-xs text-muted-foreground">
                  A nova senha será aplicada ao usuário <span className="font-medium text-foreground">{session.userName}</span> em cada empresa (caso exista). Empresas onde a senha já for igual à atual serão ignoradas automaticamente.
                </p>

                <div className="space-y-1.5">
                  {prodCompanies.length > 0 && (
                    <label className="flex items-center gap-2 cursor-pointer text-sm">
                      <Checkbox
                        checked={allProdSelected}
                        onCheckedChange={(v) => toggleGroup("prod", v === true)}
                      />
                      <span className="text-foreground font-medium">Todas as bases de produção</span>
                      <span className="text-xs text-muted-foreground">({prodCompanies.length})</span>
                    </label>
                  )}
                  {testCompanies.length > 0 && (
                    <label className="flex items-center gap-2 cursor-pointer text-sm">
                      <Checkbox
                        checked={allTestSelected}
                        onCheckedChange={(v) => toggleGroup("test", v === true)}
                      />
                      <span className="text-foreground font-medium">Todas as bases de testes</span>
                      <span className="text-xs text-muted-foreground">({testCompanies.length})</span>
                    </label>
                  )}
                </div>

                <label className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground pt-1">
                  <Checkbox
                    checked={customPick}
                    onCheckedChange={(v) => setCustomPick(v === true)}
                  />
                  <span>Selecionar bases manualmente</span>
                </label>

                {customPick && (
                  <div className="max-h-40 overflow-y-auto space-y-2 rounded-md border border-border p-2">
                    {otherCompanies.map((c) => (
                      <label key={c.company_db} className="flex items-center gap-2 cursor-pointer text-sm">
                        <Checkbox
                          checked={selected.has(c.company_db)}
                          onCheckedChange={() => toggle(c.company_db)}
                        />
                        <span className="text-foreground">{c.display_name}</span>
                        <span className="text-xs text-muted-foreground">({c.company_db})</span>
                        {isTest(c.company_db) && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400">TST</span>
                        )}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="rounded-md border border-border p-3 space-y-1.5">
              <label className="flex items-start gap-2 cursor-pointer text-sm">
                <Checkbox
                  checked={managed}
                  onCheckedChange={(v) => setManaged(v === true)}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <div className="font-medium text-foreground">Tornar esta senha gerenciada pelo ERP Flow</div>
                  <div className="text-xs text-muted-foreground">
                    A senha será salva criptografada e vinculada às empresas selecionadas acima. Nos próximos logins você não precisará digitá-la — basta escolher a empresa.
                  </div>
                </div>
              </label>
            </div>


            <Button
              type="submit"
              className="w-full"
              disabled={
                loading ||
                !checkPasswordPolicy(newPassword, session.userName).valid ||
                newPassword !== confirmPassword
              }

            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Alterar Senha
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
