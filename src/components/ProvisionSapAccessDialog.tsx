import { useState } from "react";
import { Loader2, KeyRound, ShieldCheck, Check, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompanies } from "@/hooks/useCompanies";

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
  const { companies, isLoading: loadingCompanies } = useCompanies(true);
  const sapCompanies = companies.filter((c) => c.erp_type === "sap");
  const [selected, setSelected] = useState<Set<string>>(new Set(initialCompanyDbs || []));
  const [sapUser, setSapUser] = useState<string>(initialSapUser || defaultSapUser(targetEmail));
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ProvisionResult[] | null>(null);

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
    setBusy(true);
    setResults(null);
    const { data, error } = await supabase.functions.invoke("sap-provision-user-access", {
      body: {
        target_user_id: targetUserId,
        target_email: targetUserId ? undefined : targetEmail,
        sap_user: sapUser.trim(),
        company_dbs: Array.from(selected),
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
            O sistema irá gerar uma senha aleatória forte, alterá-la no SAP e armazená-la
            criptografada para <strong>{targetEmail}</strong>. O usuário não conhecerá a senha —
            o login ficará transparente (após autenticação Cloud → seleciona empresa → entra).
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
