import { useState, useEffect, type ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { KeyRound, Loader2, CheckCircle2, AlertCircle, MinusCircle, ShieldAlert } from "lucide-react";
import { useSap } from "@/contexts/SapContext";
import { sapAction, sapQuery } from "@/lib/sap-client";
import {
  listSapTargetCompanies,
  changePasswordInCompanies,
  isSamePasswordError,
  type MultiCompanyPasswordResult,
} from "@/lib/sap-multi-password";
import { toast } from "sonner";

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
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [otherCompanies, setOtherCompanies] = useState<CompanyOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customPick, setCustomPick] = useState(false);
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
    setNewPassword("");
    setConfirmPassword("");
    setSelected(new Set(otherCompanies.map((o) => o.company_db)));
    setCustomPick(false);
    setSummary(null);
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
    const allResults: MultiCompanyPasswordResult[] = [];
    const currentDisplay = session.companyDB;
    try {
      // Look up InternalKey for the current user (Users entity key is integer)
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

      // Change password in current company (uses the active session — não pede senha atual)
      try {
        await sapAction(session, `Users(${internalKey})`, "PATCH", { UserPassword: newPassword });
        allResults.push({ companyDB: session.companyDB, displayName: currentDisplay, status: "success" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isSamePasswordError(msg)) {
          allResults.push({
            companyDB: session.companyDB,
            displayName: currentDisplay,
            status: "skipped",
            message: "Senha igual à anterior",
          });
        } else {
          allResults.push({
            companyDB: session.companyDB,
            displayName: currentDisplay,
            status: "error",
            message: msg,
          });
        }
      }

      // Replicate to additional companies, if any (cada empresa é independente)
      if (selected.size > 0) {
        const extra = await changePasswordInCompanies(session.userName, newPassword, Array.from(selected));
        allResults.push(...extra);
      }

      setSummary(allResults);

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
        toast.error(`Falhou em todas as empresas (${failures}).`);
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
      <DialogTrigger asChild>
        <button className="text-xs text-muted-foreground hover:text-foreground transition-colors" title="Alterar senha">
          <KeyRound className="w-4 h-4" />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Alterar Senha</DialogTitle>
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
              <Button className="flex-1" onClick={() => { setOpen(false); reset(); }}>Fechar</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
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

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Alterar Senha
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
