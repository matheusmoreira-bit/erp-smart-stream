import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Loader2, LogOut, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clearAuthCache } from "@/lib/auth-cache";

/**
 * F09: administradores precisam do segundo fator (código do aplicativo
 * autenticador). A trava real está no servidor (has_role exige aal2 e as
 * funções recusam admin sem aal2); esta tela só conduz o cadastro/confirmação.
 */
type MfaStatus = { requires_mfa: boolean; has_verified_factor: boolean; aal: string };
type View =
  | { kind: "loading" }
  | { kind: "ok" }
  | { kind: "error"; message: string }
  | { kind: "enroll"; factorId: string; qr: string; secret: string }
  | { kind: "challenge"; factorId: string };

export function AdminMfaGate({ children }: { children: ReactNode }) {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const evaluate = useCallback(async () => {
    try {
      const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalData?.currentLevel === "aal2") { setView({ kind: "ok" }); return; }

      const { data, error } = await supabase.rpc("my_mfa_status");
      if (error) throw error;
      const status = (data ?? null) as MfaStatus | null;
      if (!status?.requires_mfa) { setView({ kind: "ok" }); return; }

      const { data: factors, error: fErr } = await supabase.auth.mfa.listFactors();
      if (fErr) throw fErr;
      const verified = factors?.totp?.find((f) => f.status === "verified");
      if (verified) { setView({ kind: "challenge", factorId: verified.id }); return; }

      // Remove cadastros iniciados e não concluídos antes de gerar um novo.
      for (const f of factors?.all ?? []) {
        if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data: enr, error: eErr } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `ERP Flow ${new Date().toISOString().slice(0, 10)}`,
      });
      if (eErr || !enr) throw eErr ?? new Error("Falha ao iniciar o cadastro");
      setView({ kind: "enroll", factorId: enr.id, qr: enr.totp.qr_code, secret: enr.totp.secret });
    } catch (e) {
      setView({ kind: "error", message: e instanceof Error ? e.message : "Falha ao verificar o segundo fator" });
    }
  }, []);

  useEffect(() => { void evaluate(); }, [evaluate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (view.kind !== "enroll" && view.kind !== "challenge") return;
    const clean = code.replace(/\D/g, "");
    if (clean.length !== 6) { setFormError("Digite os 6 números do aplicativo."); return; }
    setBusy(true);
    setFormError(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: view.factorId, code: clean });
    setBusy(false);
    if (error) { setFormError("Código incorreto ou expirado. Tente o código atual do aplicativo."); setCode(""); return; }
    clearAuthCache();
    setCode("");
    setView({ kind: "ok" });
  };

  const signOut = async () => { await supabase.auth.signOut(); };

  if (view.kind === "ok") return <>{children}</>;

  if (view.kind === "loading") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center" role="status" aria-label="Verificando acesso">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="glass-card w-full max-w-md p-6 space-y-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-primary" aria-hidden="true" />
          <h1 className="text-lg font-semibold text-foreground">Verificação em duas etapas</h1>
        </div>

        {view.kind === "error" && (
          <div className="space-y-3">
            <p className="text-sm text-destructive" role="alert">{view.message}</p>
            <Button onClick={() => { setView({ kind: "loading" }); void evaluate(); }}>Tentar novamente</Button>
          </div>
        )}

        {view.kind === "enroll" && (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              Administradores precisam de um segundo fator. Abra um aplicativo autenticador
              (Google Authenticator, Microsoft Authenticator ou Authy) e leia o QR code abaixo.
            </p>
            <div className="flex justify-center rounded-md bg-card p-3">
              <img src={view.qr} alt="QR code para cadastrar o ERP Flow no aplicativo autenticador" className="w-44 h-44" />
            </div>
            <p>
              Não consegue ler? Digite esta chave no aplicativo:{" "}
              <code className="break-all rounded bg-muted px-1 py-0.5 text-foreground">{view.secret}</code>
            </p>
          </div>
        )}

        {view.kind === "challenge" && (
          <p className="text-sm text-muted-foreground">
            Digite o código de 6 números que aparece no seu aplicativo autenticador.
          </p>
        )}

        {(view.kind === "enroll" || view.kind === "challenge") && (
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="mfa-code">Código de verificação</Label>
              <Input
                id="mfa-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                aria-invalid={!!formError}
                aria-describedby={formError ? "mfa-error" : undefined}
                autoFocus
              />
              {formError && <p id="mfa-error" className="text-xs text-destructive" role="alert">{formError}</p>}
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" />}
              {view.kind === "enroll" ? "Ativar e continuar" : "Confirmar"}
            </Button>
            {view.kind === "challenge" && (
              <p className="text-xs text-muted-foreground">
                Perdeu o celular? Peça a outro administrador para redefinir o seu segundo fator.
              </p>
            )}
          </form>
        )}

        <Button variant="ghost" size="sm" onClick={signOut} className="w-full">
          <LogOut className="w-4 h-4 mr-2" aria-hidden="true" /> Sair
        </Button>
      </div>
    </div>
  );
}
