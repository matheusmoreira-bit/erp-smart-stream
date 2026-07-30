import { useState } from "react";
import { Loader2, KeyRound, ShieldCheck, Check, X, AlertCircle, Eye, EyeOff, Wand2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompanies } from "@/hooks/useCompanies";
import { checkPasswordPolicy, generateStrongPassword } from "@/lib/password-policy";
import { PasswordPolicyChecklist } from "@/components/PasswordPolicyChecklist";


interface ProvisionResult {
  companyDB: string;
  displayName: string;
  status: "success" | "error" | "skipped";
  message?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Either targetUserId or targetEmail must be provided. */
  targetUserId?: string;
  targetEmail: string;
  /** Optional initial SAP UserCode override (defaults to email prefix). */
  initialSapUser?: string;
  /** Optional pre-selection of companies. */
  initialCompanyDbs?: string[];
}

function defaultSapUser(email: string): string {
  return (email.split("@")[0] || "").toLowerCase().slice(0, 20);
}

export function ProvisionSapAccessDialog({ open, onOpenChange, targetUserId, targetEmail, initialSapUser, initialCompanyDbs }: Props) {
  const { companies, loading: loadingCompanies } = useCompanies(true);
  const sapCompanies = companies.filter((c) => c.erp_type === "sap");
  const [selected, setSelected] = useState<Set<string>>(new Set(initialCompanyDbs || []));
  const [sapUser, setSapUser] = useState<string>(initialSapUser || defaultSapUser(targetEmail));
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ProvisionResult[] | null>(null);
  const [mode, setMode] = useState<"random" | "custom">("random");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const policy = checkPasswordPolicy(password, sapUser);
  const passwordReady = mode === "random" || policy.valid;


  const toggle = (db: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(db)) next.delete(db); else next.add(db);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === sapCompanies.length) setSelected(new Set());
    else setSelected(new Set(sapCompanies.map((c) => c.company_db)));
  };

  const submit = async () => {
    if (selected.size === 0) {
      toast.error("Selecione ao menos uma empresa");
      return;
    }
    if (!sapUser.trim()) {
      toast.error("UserCode do SAP obrigatório");
      return;
    }
    if (mode === "custom" && !policy.valid) {
      toast.error(`Senha não atende à política: ${policy.failed[0].label}`);
      return;
    }
    setBusy(true);
    setResults(null);
    const { data, error } = await supabase.functions.invoke("sap-provision-user-access", {
      body: {
        target_user_id: targetUserId,
        target_email: targetUserId ? undefined : targetEmail,
        sap_user: sapUser.trim(),
        company_dbs: Array.from(selected),
        password: mode === "custom" ? password : undefined,
      },
    });

    setBusy(false);
    if (error || (data as { error?: string })?.error) {
      toast.error((data as { error?: string })?.error || error?.message || "Falha ao provisionar acesso");
      return;
    }
    const rows: ProvisionResult[] = (data as { results?: ProvisionResult[] })?.results || [];
    setResults(rows);
    const ok = rows.filter((r) => r.status === "success").length;
    if (ok > 0) toast.success(`Acesso provisionado em ${ok} empresa(s)`);
    else toast.warning("Nenhuma empresa provisionada");
  };

  const close = () => {
    if (busy) return;
    setResults(null);
    setSelected(new Set());
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : close())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" /> Provisionar acesso SAP
          </DialogTitle>
          <DialogDescription>
            A senha será aplicada no SAP e armazenada criptografada para <strong>{targetEmail}</strong>,
            deixando o login transparente (autenticação Cloud → seleciona empresa → entra).
            Escolha entre uma senha aleatória (que ninguém conhece) ou uma senha definida por você.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">UserCode do SAP</label>
            <Input
              value={sapUser}
              onChange={(e) => setSapUser(e.target.value)}
              placeholder="matheus.moreira"
              maxLength={20}
              disabled={busy}
            />
            <p className="text-[11px] text-muted-foreground">
              Por padrão, é o prefixo do email (antes do @), limitado a 20 caracteres.
            </p>
          </div>

          <div className="space-y-2 rounded-lg border border-border p-3">
            <span className="text-xs font-medium text-foreground">Senha</span>
            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as "random" | "custom")}
              className="space-y-1.5"
              disabled={busy}
            >
              <div className="flex items-start gap-2">
                <RadioGroupItem value="random" id="pwd-random" className="mt-0.5" />
                <Label htmlFor="pwd-random" className="font-normal cursor-pointer">
                  <span className="text-sm text-foreground">Senha aleatória (recomendado)</span>
                  <span className="block text-[11px] text-muted-foreground">
                    Gerada com 24 caracteres e nunca exibida — login somente pelo ERP Flow.
                  </span>
                </Label>
              </div>
              <div className="flex items-start gap-2">
                <RadioGroupItem value="custom" id="pwd-custom" className="mt-0.5" />
                <Label htmlFor="pwd-custom" className="font-normal cursor-pointer">
                  <span className="text-sm text-foreground">Definir uma senha conhecida</span>
                  <span className="block text-[11px] text-muted-foreground">
                    O usuário poderá usá-la também para entrar diretamente no SAP.
                  </span>
                </Label>
              </div>
            </RadioGroup>

            {mode === "custom" && (
              <div className="space-y-2 pt-1">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Senha do SAP"
                      autoComplete="new-password"
                      maxLength={32}
                      disabled={busy}
                      className="pr-9"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title="Gerar senha segura"
                    aria-label="Gerar senha segura"
                    disabled={busy}
                    onClick={() => {
                      const generated = generateStrongPassword(16, sapUser);
                      setPassword(generated);
                      setShowPassword(true);
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
                    disabled={busy || !password}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(password);
                        toast.success("Senha copiada");
                      } catch {
                        toast.error("Não foi possível copiar");
                      }
                    }}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
                <PasswordPolicyChecklist password={password} userCode={sapUser} />
              </div>
            )}
          </div>


          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-foreground">
                Empresas SAP <Badge variant="outline" className="ml-1 text-[10px]">{sapCompanies.length}</Badge>
              </label>
              <button
                type="button"
                onClick={toggleAll}
                className="text-xs text-primary hover:underline"
                disabled={busy || loadingCompanies}
              >
                {selected.size === sapCompanies.length ? "Limpar" : "Selecionar todas"}
              </button>
            </div>
            <div className="rounded-lg border border-border max-h-56 overflow-y-auto">
              {loadingCompanies ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Carregando...
                </div>
              ) : sapCompanies.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  Nenhuma empresa SAP ativa
                </div>
              ) : (
                sapCompanies.map((c) => {
                  const r = results?.find((x) => x.companyDB === c.company_db);
                  return (
                    <label
                      key={c.company_db}
                      className="flex items-center gap-3 px-3 py-2 border-b border-border last:border-b-0 hover:bg-muted/20 cursor-pointer"
                    >
                      <Checkbox
                        checked={selected.has(c.company_db)}
                        onCheckedChange={() => toggle(c.company_db)}
                        disabled={busy}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">{c.display_name}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{c.company_db}</div>
                      </div>
                      {r && (
                        <div className="text-[11px] flex items-center gap-1">
                          {r.status === "success" && <Check className="w-3.5 h-3.5 text-emerald-500" />}
                          {r.status === "error" && <X className="w-3.5 h-3.5 text-destructive" />}
                          {r.status === "skipped" && <AlertCircle className="w-3.5 h-3.5 text-amber-500" />}
                          <span
                            className={
                              r.status === "success" ? "text-emerald-600" :
                              r.status === "error" ? "text-destructive" : "text-amber-600"
                            }
                            title={r.message}
                          >
                            {r.status === "success" ? "OK" : r.status === "skipped" ? "Ignorado" : "Erro"}
                          </span>
                        </div>
                      )}
                    </label>
                  );
                })
              )}
            </div>
          </div>

          {results && results.some((r) => r.status !== "success") && (
            <div className="text-xs space-y-1 max-h-24 overflow-y-auto">
              {results
                .filter((r) => r.status !== "success" && r.message)
                .map((r) => (
                  <div key={r.companyDB} className="text-muted-foreground">
                    <strong>{r.displayName}:</strong> {r.message}
                  </div>
                ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={busy}>
            {results ? "Fechar" : "Cancelar"}
          </Button>
          <Button onClick={submit} disabled={busy || selected.size === 0}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <KeyRound className="w-4 h-4 mr-1" />}
            Provisionar {selected.size > 0 ? `(${selected.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
