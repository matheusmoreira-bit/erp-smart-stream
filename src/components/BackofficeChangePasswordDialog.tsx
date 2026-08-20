import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, CheckCircle2, AlertCircle, MinusCircle, RefreshCw, Copy, Eye, EyeOff } from "lucide-react";
import {
  listSapTargetCompanies,
  changePasswordInCompanies,
  type MultiCompanyPasswordResult,
} from "@/lib/sap-multi-password";
import { PasswordPolicyChecklist } from "@/components/PasswordPolicyChecklist";
import { checkPasswordPolicy, generateStrongPassword } from "@/lib/password-policy";
import { toast } from "sonner";

const DEFAULT_RESET_PASSWORD = "Sap@2025";

type PasswordMode = "default" | "random" | "known";

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
  targetEmail?: string | null;
  onDone?: () => void;
}

export function BackofficeChangePasswordDialog({
  open, onOpenChange, userCode, userName, currentCompanyDb, currentCompanyName, targetEmail, onDone,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [otherCompanies, setOtherCompanies] = useState<CompanyOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<MultiCompanyPasswordResult[] | null>(null);
  const [mode, setMode] = useState<PasswordMode>("default");
  const [password, setPassword] = useState<string>(DEFAULT_RESET_PASSWORD);
  const [showPassword, setShowPassword] = useState(false);
  const [provision, setProvision] = useState(false);
  const policy = useMemo(() => checkPasswordPolicy(password, userCode), [password, userCode]);
  const canProvision = mode !== "default" && !!targetEmail;

  useEffect(() => {
    if (!open) return;
    setMode("default");
    setPassword(DEFAULT_RESET_PASSWORD);
    setShowPassword(false);
    setProvision(false);
    listSapTargetCompanies(currentCompanyDb).then((cs) => {
      setOtherCompanies(cs.map((c) => ({ company_db: c.company_db, display_name: c.display_name })));
    });
  }, [open, currentCompanyDb]);

  const reset = () => {
    setSelected(new Set());
    setSummary(null);
    setMode("default");
    setPassword(DEFAULT_RESET_PASSWORD);
    setShowPassword(false);
    setProvision(false);
  };

  const setPasswordMode = (next: PasswordMode) => {
    setMode(next);
    setProvision(false);
    setShowPassword(next === "random");
    setPassword(
      next === "default"
        ? DEFAULT_RESET_PASSWORD
        : next === "random"
          ? generateStrongPassword(20, userCode)
          : "",
    );
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
    if (!password) {
      toast.error("Informe uma senha");
      return;
    }
    if (mode !== "default" && !policy.valid) {
      toast.error(`A senha não atende à política: ${policy.failed[0]?.label || "revise a senha"}`);
      return;
    }
    setLoading(true);
    setSummary(null);
    try {
      const targets = [currentCompanyDb, ...Array.from(selected)];
      const results = await changePasswordInCompanies(
        userCode,
        password,
        targets,
        undefined,
        provision,
        provision && targetEmail ? { targetEmail } : undefined,
      );
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
          `${provision ? "Senha redefinida e provisionada" : "Senha redefinida"} em ${successes} empresa(s)${skipped ? ` (${skipped} ignorada(s))` : ""}. Usuário desbloqueado.`,
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
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
            <div className="space-y-3 rounded-md border border-border bg-muted/40 p-3">
              <Label className="text-sm">Tipo de senha</Label>
              <RadioGroup
                value={mode}
                onValueChange={(value) => setPasswordMode(value as PasswordMode)}
                className="grid gap-2"
              >
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <RadioGroupItem value="default" className="mt-0.5" />
                  <span><strong>Senha padrão</strong><span className="block text-xs text-muted-foreground">Sap@2025</span></span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <RadioGroupItem value="random" className="mt-0.5" />
                  <span><strong>Senha aleatória</strong><span className="block text-xs text-muted-foreground">Gerada com política forte e exclusiva.</span></span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <RadioGroupItem value="known" className="mt-0.5" />
                  <span><strong>Senha conhecida</strong><span className="block text-xs text-muted-foreground">Definida pelo administrador.</span></span>
                </label>
              </RadioGroup>

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="new-password"
                    type={showPassword || mode === "default" ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    readOnly={mode !== "known"}
                    className="pr-9 font-mono"
                    autoComplete="new-password"
                    placeholder={mode === "known" ? "Digite a nova senha" : undefined}
                  />
                  {mode === "known" && (
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  )}
                </div>
                {mode === "random" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title="Gerar outra senha"
                    onClick={() => setPassword(generateStrongPassword(20, userCode))}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                )}
                {mode !== "default" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title="Copiar senha"
                    disabled={!password}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(password);
                        toast.success("Senha copiada");
                      } catch {
                        toast.error("Não foi possível copiar a senha");
                      }
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                )}
              </div>

              {mode !== "default" && <PasswordPolicyChecklist password={password} userCode={userCode} />}

              <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                <div>
                  <Label htmlFor="provision-password" className="text-sm">Provisionar senha</Label>
                  <p className="text-xs text-muted-foreground">
                    {targetEmail
                      ? "Salva a credencial criptografada para login transparente no ERP Flow."
                      : "Cadastre um e-mail para habilitar o provisionamento."}
                  </p>
                </div>
                <Switch
                  id="provision-password"
                  checked={provision}
                  onCheckedChange={setProvision}
                  disabled={!canProvision}
                />
              </div>
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

            <Button
              type="submit"
              className="w-full"
              disabled={loading || !password || (mode !== "default" && !policy.valid)}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {provision ? "Redefinir e provisionar" : "Redefinir senha"}
            </Button>
          </form>

        )}
      </DialogContent>
    </Dialog>
  );
}
