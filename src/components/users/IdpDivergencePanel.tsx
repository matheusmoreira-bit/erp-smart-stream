import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Loader2, ShieldOff, Link2Off, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { SapUser } from "@/lib/cache-repository";
import type { IdpMapping, IdpProvider, IdpUser } from "@/hooks/useIdpSync";
import { logAuditAction } from "@/hooks/useAuditLog";

const IGNORE_KEY_PREFIX = "idp:divergences:ignored";

function loadIgnored(provider: IdpProvider): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(`${IGNORE_KEY_PREFIX}:${provider}`) || "[]") as string[]);
  } catch {
    return new Set();
  }
}

type Bucket = "removed" | "suspended" | "unlinked";

interface Row {
  user: SapUser;
  bucket: Bucket;
  idpEmail: string | null;
}

const BUCKET_META: Record<Bucket, { title: string; hint: string; tone: string; icon: typeof ShieldOff }> = {
  removed: {
    title: "Removido no IdP + ERP não bloqueado",
    hint: "Divergência crítica de segurança: o acesso ao ERP continua ativo.",
    tone: "border-destructive/40 bg-destructive/5",
    icon: ShieldOff,
  },
  suspended: {
    title: "Suspenso no IdP + ERP não bloqueado",
    hint: "O usuário está suspenso no IdP mas segue ativo no ERP.",
    tone: "border-warning/40 bg-warning/5",
    icon: AlertTriangle,
  },
  unlinked: {
    title: "Sem vínculo",
    hint: "Usuário ativo no ERP sem identidade correspondente no IdP.",
    tone: "border-border bg-muted/20",
    icon: Link2Off,
  },
};

interface Props {
  sapUsers: SapUser[];
  idpUsers: IdpUser[];
  mappings: IdpMapping[];
  provider: IdpProvider;
  companyDb?: string | null;
  onBlock: (user: SapUser) => Promise<void>;
  focusUser?: string | null;
}

/**
 * Painel operacional de divergências IdP ↔ ERP: agrupa por estado,
 * permite resolver caso a caso ou em lote (bloqueio imediato no ERP).
 */
export default function IdpDivergencePanel({ sapUsers, idpUsers, mappings, provider, companyDb, onBlock, focusUser }: Props) {
  const navigate = useNavigate();
  const [ignored, setIgnored] = useState<Set<string>>(() => loadIgnored(provider));
  const [busy, setBusy] = useState<string | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);

  useEffect(() => {
    setIgnored(loadIgnored(provider));
  }, [provider]);

  const rows = useMemo<Row[]>(() => {
    const idpByEmail = new Map(idpUsers.map((user) => [(user.email || "").toLowerCase(), user]));
    const mapByCode = new Map(mappings.map((m) => [m.sap_user_code, m]));

    const out: Row[] = [];
    for (const user of sapUsers) {
      if (user.Locked === "tYES") continue; // já bloqueado no ERP: sem gap
      if (ignored.has(user.UserCode)) continue;

      const mapping = mapByCode.get(user.UserCode);
      const idpUser = user.eMail ? idpByEmail.get(user.eMail.toLowerCase()) : undefined;

      if (mapping?.status === "disabled_by_idp" || (mapping?.status === "linked" && !idpUser && idpUsers.length > 0)) {
        out.push({ user, bucket: "removed", idpEmail: mapping?.idp_email ?? null });
      } else if (idpUser?.suspended) {
        out.push({ user, bucket: "suspended", idpEmail: idpUser.email ?? null });
      } else if (!mapping || mapping.status !== "linked") {
        out.push({ user, bucket: "unlinked", idpEmail: null });
      }
    }
    return out;
  }, [sapUsers, idpUsers, mappings, ignored]);

  const grouped = useMemo(
    () => ({
      removed: rows.filter((r) => r.bucket === "removed"),
      suspended: rows.filter((r) => r.bucket === "suspended"),
      unlinked: rows.filter((r) => r.bucket === "unlinked"),
    }),
    [rows],
  );

  const ignore = (code: string) => {
    const next = new Set(ignored);
    next.add(code);
    setIgnored(next);
    localStorage.setItem(`${IGNORE_KEY_PREFIX}:${provider}`, JSON.stringify(Array.from(next)));
    toast.success("Divergência marcada como esperada");
  };

  const block = async (user: SapUser) => {
    setBusy(user.UserCode);
    try {
      await onBlock(user);
      await logAuditAction({
        action: "idp_divergence_resolved_block",
        entity_type: "user",
        entity_id: user.UserCode,
        company_db: companyDb || undefined,
      });
      toast.success(`${user.UserName || user.UserCode} bloqueado no ERP`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao bloquear no ERP");
    } finally {
      setBusy(null);
    }
  };

  const resolveAllCritical = async () => {
    const targets = [...grouped.removed, ...grouped.suspended];
    if (targets.length === 0) return;
    setBulkRunning(true);
    let ok = 0;
    for (const r of targets) {
      try {
        await onBlock(r.user);
        ok += 1;
      } catch {
        /* segue para o próximo */
      }
    }
    await logAuditAction({
      action: "idp_divergence_bulk_resolved",
      entity_type: "user",
      company_db: companyDb || undefined,
      details: { attempted: targets.length, blocked: ok },
    });
    toast.success(`${ok} de ${targets.length} usuário(s) bloqueados no ERP`);
    setBulkRunning(false);
  };

  const criticalCount = grouped.removed.length + grouped.suspended.length;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Divergências</h2>
          <p className="text-xs text-muted-foreground">
            Estados que exigem ação. O bloqueio é aplicado imediatamente no ERP.
          </p>
        </div>
        <Button size="sm" variant="destructive" onClick={resolveAllCritical} disabled={criticalCount === 0 || bulkRunning}>
          {bulkRunning && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
          Resolver todos os críticos ({criticalCount})
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-10 text-center space-y-1">
          <CheckCircle2 className="w-6 h-6 mx-auto text-success" />
          <p className="text-sm text-foreground">Nenhuma divergência aberta</p>
        </div>
      ) : (
        (Object.keys(BUCKET_META) as Bucket[]).map((bucket) => {
          const list = grouped[bucket];
          if (list.length === 0) return null;
          const meta = BUCKET_META[bucket];
          const Icon = meta.icon;
          return (
            <div key={bucket} className={`rounded-xl border ${meta.tone}`}>
              <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
                <Icon className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">{meta.title}</span>
                <Badge variant="outline" className="text-[10px]">{list.length}</Badge>
                <span className="hidden text-xs text-muted-foreground sm:inline">· {meta.hint}</span>
              </div>
              <div className="divide-y divide-border/60">
                {list.map((r) => (
                  <div
                    key={r.user.UserCode}
                    className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
                      focusUser && focusUser === r.user.UserCode ? "ring-1 ring-primary rounded-md" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {r.user.UserName || r.user.UserCode}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {r.user.UserCode} · {r.user.eMail || "sem e-mail"}
                        {r.idpEmail ? ` · IdP: ${r.idpEmail}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {bucket !== "unlinked" && (
                        <Button size="sm" variant="destructive" onClick={() => block(r.user)} disabled={busy === r.user.UserCode}>
                          {busy === r.user.UserCode && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}
                          Bloquear no ERP agora
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => navigate("/usuarios/permissoes")}>
                        Revisar grupos
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => ignore(r.user.UserCode)}>
                        Ignorar
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}
