import { useState, useEffect } from "react";
import { UserPlus, Loader2, CheckCircle2, XCircle, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";

interface ReplicationResult {
  companyDB: string;
  displayName: string;
  status: "success" | "error";
  message?: string;
}

interface CompanyOption {
  company_db: string;
  display_name: string;
  is_current: boolean;
}

interface CreateUserDialogProps {
  onCreateUser: (
    userData: { UserCode: string; UserName: string; eMail: string; Password: string },
    targetCompanyDbs?: string[],
  ) => Promise<{ created: boolean; replicationResults: ReplicationResult[] }>;
  isLoading?: boolean;
}

export default function CreateUserDialog({ onCreateUser, isLoading }: CreateUserDialogProps) {
  const { session } = useSap();
  const [open, setOpen] = useState(false);
  const [userCode, setUserCode] = useState("");
  const [userName, setUserName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("Sap@2025");
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<ReplicationResult[] | null>(null);

  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [selectedDbs, setSelectedDbs] = useState<Set<string>>(new Set());
  const [loadingCompanies, setLoadingCompanies] = useState(false);

  // Load eligible companies (same erp_type) when dialog opens
  useEffect(() => {
    if (!open || !session) return;
    const erpType = session.erpType || "sap";
    const currentDb = session.companyDB;
    setLoadingCompanies(true);
    supabase
      .from("companies")
      .select("company_db, display_name, erp_type")
      .eq("is_active", true)
      .eq("erp_type", erpType)
      .order("display_name")
      .then(({ data }) => {
        const list: CompanyOption[] = ((data || []) as { company_db: string; display_name: string }[]).map((c) => ({
          company_db: c.company_db,
          display_name: c.display_name,
          is_current: c.company_db === currentDb,
        }));
        setCompanies(list);
        // Default: all selected
        setSelectedDbs(new Set(list.map((c) => c.company_db)));
        setLoadingCompanies(false);
      });
  }, [open, session]);

  const resetForm = () => {
    setUserCode("");
    setUserName("");
    setEmail("");
    setPassword("Sap@2025");
    setResults(null);
  };

  const toggleDb = (db: string) => {
    setSelectedDbs((prev) => {
      const next = new Set(prev);
      if (next.has(db)) next.delete(db);
      else next.add(db);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!userCode.trim() || !userName.trim() || !password.trim()) {
      toast.error("Preencha código, nome e senha");
      return;
    }
    if (selectedDbs.size === 0) {
      toast.error("Selecione ao menos uma empresa");
      return;
    }
    setSubmitting(true);
    setResults(null);
    try {
      const res = await onCreateUser(
        {
          UserCode: userCode.trim(),
          UserName: userName.trim(),
          eMail: email.trim(),
          Password: password,
        },
        Array.from(selectedDbs),
      );
      const currentDb = session?.companyDB;
      const createdInCurrent = !!currentDb && selectedDbs.has(currentDb) && res.created;
      const createdElsewhere = res.replicationResults.filter((r) => r.status === "success").length;
      const totalCreated = (createdInCurrent ? 1 : 0) + createdElsewhere;
      if (totalCreated > 0) {
        toast.success(`Usuário ${userName} criado em ${totalCreated} empresa(s)`);
      }
      if (res.replicationResults.length > 0 || (createdInCurrent && res.replicationResults.length === 0 && selectedDbs.size > 1)) {
        // Show report dialog (include current row synthesized if relevant)
        const currentRow: ReplicationResult[] = currentDb && selectedDbs.has(currentDb)
          ? [{
              companyDB: currentDb,
              displayName: companies.find((c) => c.company_db === currentDb)?.display_name || currentDb,
              status: res.created ? "success" : "error",
              message: res.created ? undefined : "Falha ao criar na empresa atual",
            }]
          : [];
        setResults([...currentRow, ...res.replicationResults]);
      } else {
        setOpen(false);
        resetForm();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar usuário");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) resetForm();
    setOpen(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <UserPlus className="w-4 h-4 mr-2" />
          Novo Usuário
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Criar Novo Usuário</DialogTitle>
          <DialogDescription>
            Selecione em quais empresas o usuário deve ser criado.
          </DialogDescription>
        </DialogHeader>

        {!results ? (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="userCode">Código do Usuário *</Label>
              <Input id="userCode" value={userCode} onChange={(e) => setUserCode(e.target.value)} placeholder="joao.silva" disabled={submitting} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="userName">Nome Completo *</Label>
              <Input id="userName" value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="João da Silva" disabled={submitting} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="joao@empresa.com" disabled={submitting} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha *</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={submitting} />
            </div>

            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5" />
                  Empresas
                  <Badge variant="secondary" className="ml-1 text-[10px]">
                    {selectedDbs.size}/{companies.length}
                  </Badge>
                </Label>
                <div className="flex gap-2 text-[11px]">
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => setSelectedDbs(new Set(companies.map((c) => c.company_db)))}
                  >
                    Todas
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground hover:underline"
                    onClick={() => setSelectedDbs(new Set())}
                  >
                    Nenhuma
                  </button>
                </div>
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1 rounded-md border border-border p-2">
                {loadingCompanies ? (
                  <div className="flex items-center justify-center py-3 text-xs text-muted-foreground">
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                    Carregando empresas…
                  </div>
                ) : companies.length === 0 ? (
                  <div className="text-center text-xs text-muted-foreground py-3">
                    Nenhuma empresa ativa encontrada
                  </div>
                ) : (
                  companies.map((c) => (
                    <label key={c.company_db} className="flex items-center gap-2 cursor-pointer text-sm py-0.5 px-1 rounded hover:bg-muted/40">
                      <Checkbox
                        checked={selectedDbs.has(c.company_db)}
                        onCheckedChange={() => toggleDb(c.company_db)}
                        disabled={submitting}
                      />
                      <span className="text-foreground flex-1 truncate">{c.display_name}</span>
                      {c.is_current && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">atual</Badge>
                      )}
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground font-medium">Resultado por empresa:</p>
            {results.map((r) => (
              <div
                key={r.companyDB}
                className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/20"
              >
                {r.status === "success" ? (
                  <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0" />
                ) : (
                  <XCircle className="w-5 h-5 text-destructive flex-shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{r.displayName}</p>
                  <p className="text-xs text-muted-foreground truncate">{r.companyDB}</p>
                  {r.message && (
                    <p className="text-xs text-destructive mt-0.5">{r.message}</p>
                  )}
                </div>
                <Badge variant={r.status === "success" ? "secondary" : "destructive"} className={r.status === "success" ? "bg-success/20 text-success border-success/30" : ""}>
                  {r.status === "success" ? "OK" : "Erro"}
                </Badge>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          {results ? (
            <Button onClick={() => { setOpen(false); resetForm(); }}>
              Fechar
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleClose(false)} disabled={submitting}>
                Cancelar
              </Button>
              <Button onClick={handleSubmit} disabled={submitting || isLoading || selectedDbs.size === 0}>
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Criando…
                  </>
                ) : (
                  `Criar em ${selectedDbs.size} empresa(s)`
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
