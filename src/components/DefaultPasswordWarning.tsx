import { useEffect, useState } from "react";
import { useSap } from "@/contexts/SapContext";
import { ChangePasswordDialog } from "./ChangePasswordDialog";

const STORAGE_KEY = "erp:default-password-warning";

/**
 * Detecta login com a senha padrão "Sap@2025" em base de produção e
 * exibe um aviso obrigatório com o formulário de troca de senha.
 * A flag é definida pelo SapLoginForm no momento do login bem-sucedido.
 */
export function DefaultPasswordWarning() {
  const { session } = useSap();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!session) return;
    try {
      if (sessionStorage.getItem(STORAGE_KEY) === "1") {
        setOpen(true);
      }
    } catch { /* noop */ }
  }, [session]);

  if (!session) return null;

  return (
    <ChangePasswordDialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
        }
      }}
      hideTrigger
      warningMessage={
        <div className="space-y-1">
          <div className="font-semibold">Você está usando a senha padrão em uma base de produção.</div>
          <div className="text-xs opacity-90">
            Manter a senha padrão <span className="font-mono">Sap@2025</span> representa um risco de segurança grave: qualquer pessoa que conheça esse padrão pode acessar seu usuário no ERP. Defina agora uma nova senha pessoal e forte.
          </div>
        </div>
      }
    />
  );
}
