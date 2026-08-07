import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Eye, EyeOff, Loader2, Lock, ShieldCheck, User } from "lucide-react";

export interface SapCredentialsDialogProps {
  open: boolean;
  companyDB: string;
  companyLabel?: string;
  defaultUser?: string;
  loading?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSubmit: (userName: string, password: string, remember: boolean) => void;
}

/**
 * Modal de credenciais do ERP exibido apenas quando uma ação precisa do
 * Service Layer e o usuário não possui senha provisionada para a empresa.
 */
export function SapCredentialsDialog({
  open,
  companyDB,
  companyLabel,
  defaultUser,
  loading,
  error,
  onCancel,
  onSubmit,
}: SapCredentialsDialogProps) {
  const [userName, setUserName] = useState(defaultUser || "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);

  useEffect(() => {
    if (open) {
      setUserName(defaultUser || "");
      setPassword("");
      setShowPassword(false);
    }
  }, [open, defaultUser]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !loading) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
            Autenticação no ERP
          </DialogTitle>
          <DialogDescription>
            Esta ação precisa se comunicar com o ERP de{" "}
            <span className="font-medium">{companyLabel || companyDB}</span>. Informe suas credenciais
            do ERP para continuar.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!userName.trim() || !password) return;
            onSubmit(userName.includes("@") ? userName.split("@")[0].trim() : userName.trim(), password, remember);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="erp-user">Usuário do ERP</Label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                id="erp-user"
                className="pl-9"
                autoComplete="username"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                disabled={loading}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="erp-password">Senha</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                id="erp-password"
                className="pl-9 pr-10"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                required
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="erp-remember"
              checked={remember}
              onCheckedChange={(v) => setRemember(v === true)}
              disabled={loading}
            />
            <Label htmlFor="erp-remember" className="text-sm font-normal leading-snug text-muted-foreground">
              Lembrar minhas credenciais nesta empresa (armazenadas com segurança) para autenticar
              automaticamente nas próximas ações.
            </Label>
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">{error}</p>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading || !userName.trim() || !password}>
              {loading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Conectando…</>) : "Conectar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
