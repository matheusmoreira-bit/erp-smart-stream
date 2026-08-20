import { useCallback, useEffect, useState } from "react";
import { Loader2, Copy, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { generateStrongPassword } from "@/lib/password-policy";
import { logAuditAction } from "@/hooks/useAuditLog";

type CompanyOption = { company_db: string; display_name: string };

type CompanyAccess = {
  company: CompanyOption;
  internalKey: number | null;
  locked: boolean;
};

function sameUser(raw: Record<string, unknown>, code: string, email?: string | null) {
  const rc = String(raw.UserCode || "").trim().toLowerCase();
  const re = String(raw.eMail || "").trim().toLowerCase();
  return (!!code && rc === code.trim().toLowerCase()) || (!!email && !!re && re === email.trim().toLowerCase());
}

/**
 * Empresas em que o usuário tem acesso (base SAP a base SAP).
 * Permite ativar/inativar (Locked) por empresa e replicar o usuário
 * para bases onde ele ainda não existe.
 */
export default function UserCompaniesTab({
  userCode,
  userName,
  email,
  sourceCompanyDb,
  onChanged,
}: {
  userCode: string;
  userName: string;
  email?: string | null;
  sourceCompanyDb?: string | null;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<CompanyAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: cData, error: cErr } = await supabase.functions.invoke("sap-users-admin", {
        body: { action: "list_companies" },
      });
      if (cErr) throw cErr;
      const companies = ((cData as { companies?: CompanyOption[] })?.companies || []);
      const result = await Promise.all(
        companies.map(async (company): Promise<CompanyAccess> => {
          try {
            const { data } = await supabase.functions.invoke("sap-users-admin", {
              body: { action: "list_users", company_db: company.company_db },
            });
            const users = ((data as { users?: Record<string, unknown>[] })?.users || []);
            const match = users.find((u) => sameUser(u, userCode, email));
            return {
              company,
              internalKey: match ? Number(match.InternalKey || 0) || null : null,
              locked: match ? match.Locked === "tYES" : false,
            };
          } catch {
            return { company, internalKey: null, locked: false };
          }
        }),
      );
      setRows(result.sort((a, b) => a.company.display_name.localeCompare(b.company.display_name, "pt-BR")));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar empresas");
    } finally {
      setLoading(false);
    }
  }, [userCode, email]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleAccess = async (row: CompanyAccess, active: boolean) => {
    if (!row.internalKey) return;
    setBusy(row.company.company_db);
    try {
      const { data, error } = await supabase.functions.invoke("sap-users-admin", {
        body: {
          action: "update_user",
          company_db: row.company.company_db,
          internal_key: row.internalKey,
          patch: { Locked: active ? "tNO" : "tYES" },
        },
      });
      const errMsg = (data as { error?: string } | null)?.error || error?.message;
      if (errMsg) throw new Error(errMsg);
      setRows((prev) =>
        prev.map((r) => (r.company.company_db === row.company.company_db ? { ...r, locked: !active } : r)),
      );
      await logAuditAction({
        action: active ? "user_unblocked" : "user_blocked",
        entity_type: "user",
        entity_id: userCode,
        company_db: row.company.company_db,
      });
      toast.success(`${active ? "Ativado" : "Inativado"} em ${row.company.display_name}`);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao alterar acesso");
    } finally {
      setBusy(null);
    }
  };

  const replicate = async (row: CompanyAccess) => {
    if (!sourceCompanyDb) {
      toast.error("Sem empresa de origem para replicar. Entre em uma empresa primeiro.");
      return;
    }
    setBusy(row.company.company_db);
    try {
      const password = generateStrongPassword(16);
      const { data, error } = await supabase.functions.invoke("sap-users-admin", {
        body: {
          action: "replicate_users",
          source_company_dbs: [sourceCompanyDb],
          target_company_db: row.company.company_db,
          user_codes: [userCode],
          default_password: password,
          include_superusers: true,
        },
      });
      const payload = data as { error?: string; created?: string[]; failed?: { code: string; error: string }[] } | null;
      const errMsg = payload?.error || error?.message;
      if (errMsg) throw new Error(errMsg);
      if (payload?.failed?.length) throw new Error(payload.failed[0].error);
      if (!payload?.created?.length) throw new Error("Usuário não foi criado (verifique se já existe na base)");
      toast.success(`Replicado para ${row.company.display_name}`, {
        description: `Senha provisória: ${password}`,
        action: {
          label: "Copiar senha",
          onClick: () => navigator.clipboard.writeText(password),
        },
        duration: 15000,
      });
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao replicar usuário");
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Consultando bases…
      </div>
    );
  }

  return (
    <div className="space-y-2 pt-1">
      <p className="text-xs text-muted-foreground">
        Ative ou inative {userName} por empresa. Bases sem acesso podem receber o usuário por replicação.
      </p>
      {rows.map((row) => {
        const isBusy = busy === row.company.company_db;
        return (
          <div
            key={row.company.company_db}
            className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{row.company.display_name}</p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">{row.company.company_db}</p>
            </div>
            {isBusy ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            ) : row.internalKey ? (
              <div className="flex items-center gap-2">
                <Badge variant={row.locked ? "destructive" : "secondary"} className="text-[10px]">
                  {row.locked ? "Inativo" : "Ativo"}
                </Badge>
                <Switch checked={!row.locked} onCheckedChange={(v) => toggleAccess(row, v)} />
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => replicate(row)}>
                <PlusCircle className="w-3.5 h-3.5 mr-1" />
                Replicar
              </Button>
            )}
          </div>
        );
      })}
      {rows.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma empresa SAP ativa encontrada.</p>
      )}
      <Button variant="ghost" size="sm" onClick={() => load()}>
        <Copy className="w-3.5 h-3.5 mr-1" />
        Recarregar bases
      </Button>
    </div>
  );
}
