import { useState } from "react";
import { UserPlus, Loader2, CheckCircle2, XCircle, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface ReplicationResult {
  companyDB: string;
  displayName: string;
  status: "success" | "error";
  message?: string;
}

interface CreateUserDialogProps {
  onCreateUser: (userData: {
    UserCode: string;
    UserName: string;
    eMail: string;
    Password: string;
  }) => Promise<{ created: boolean; replicationResults: ReplicationResult[] }>;
  isLoading?: boolean;
}

export default function CreateUserDialog({ onCreateUser, isLoading }: CreateUserDialogProps) {
  const [open, setOpen] = useState(false);
  const [userCode, setUserCode] = useState("");
  const [userName, setUserName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("Sap@2025");
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<ReplicationResult[] | null>(null);

  const resetForm = () => {
    setUserCode("");
    setUserName("");
    setEmail("");
    setPassword("Sap@2025");
    setResults(null);
  };

  const handleSubmit = async () => {
    if (!userCode.trim() || !userName.trim() || !password.trim()) {
      toast.error("Preencha código, nome e senha");
      return;
    }
    setSubmitting(true);
    setResults(null);
    try {
      const res = await onCreateUser({
        UserCode: userCode.trim(),
        UserName: userName.trim(),
        eMail: email.trim(),
        Password: password,
      });
      if (res.created) {
        toast.success(`Usuário ${userName} criado com sucesso`);
        if (res.replicationResults.length > 0) {
          setResults(res.replicationResults);
        } else {
          setOpen(false);
          resetForm();
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar usuário");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      resetForm();
    }
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
            O usuário será criado na base atual e replicado para as demais empresas do mesmo ERP.
          </DialogDescription>
        </DialogHeader>

        {!results ? (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="userCode">Código do Usuário *</Label>
              <Input
                id="userCode"
                value={userCode}
                onChange={(e) => setUserCode(e.target.value)}
                placeholder="joao.silva"
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="userName">Nome Completo *</Label>
              <Input
                id="userName"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="João da Silva"
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="joao@empresa.com"
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha *</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground font-medium">Replicação nas demais empresas:</p>
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
              <Button onClick={handleSubmit} disabled={submitting || isLoading}>
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Criando…
                  </>
                ) : (
                  "Criar Usuário"
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
