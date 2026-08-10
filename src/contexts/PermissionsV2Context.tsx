import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";
import type { PermissionAction, PermissionMode } from "@/lib/permissions-v2";

/**
 * PermissionsV2 — snapshot em memória para decisões *síncronas* no clique.
 *
 * Filosofia:
 *   - Nada aqui bloqueia UI com await. Todas as decisões saem de um snapshot
 *     em RAM, atualizado no login e via Supabase Realtime.
 *   - Log de negativa (shadow) é fire-and-forget — não afeta latência do clique.
 *   - Fonte final da verdade continua sendo o servidor (RLS + edge functions).
 *     Este gate é UX: esconde botões que iriam falhar e coleta telemetria.
 */

interface Snapshot {
  v2Enabled: boolean;      // feature_flag: permissions_v2
  killSwitch: boolean;     // feature_flag: permissions_v2_kill (força tudo off)
  scope: Record<string, PermissionMode>; // company_db lowercase → mode
  globalMode: PermissionMode;            // fallback quando não há linha por empresa
  loaded: boolean;
}

const INITIAL: Snapshot = {
  v2Enabled: false,
  killSwitch: false,
  scope: {},
  globalMode: "off",
  loaded: false,
};

// Snapshot global acessível fora de React (event handlers, libs).
let snapshotRef: Snapshot = INITIAL;

export interface GateResult {
  mode: PermissionMode;
  allow: boolean;      // decisão final a aplicar na UI
  wouldDeny: boolean;  // true quando v2 negaria (usado para telemetria de shadow)
}

/** Resolve modo efetivo para uma empresa a partir do snapshot atual. */
function resolveMode(companyDb: string | null | undefined, snap: Snapshot): PermissionMode {
  if (snap.killSwitch || !snap.v2Enabled) return "off";
  const key = (companyDb ?? "").toLowerCase();
  if (key && snap.scope[key]) return snap.scope[key];
  return snap.globalMode;
}

/**
 * Gate síncrono. Uso em event handlers:
 *   const g = gateSync({ module: "approvals", action: "approve", clientAllows: canApprove, companyDb, identifier });
 *   if (!g.allow) { toast.error("..."); return; }
 */
export function gateSync(params: {
  module: string;
  action: PermissionAction;
  clientAllows: boolean;
  companyDb: string | null;
  identifier: string | null;
}): GateResult {
  const { module, action, clientAllows, companyDb, identifier } = params;
  const snap = snapshotRef;
  const mode = resolveMode(companyDb, snap);

  if (mode === "off") {
    return { mode, allow: clientAllows, wouldDeny: false };
  }

  // v2 não tem snapshot próprio de permissões (usa v1 já em memória).
  // Aqui apenas espelhamos a decisão do cliente e, se ela for `deny`,
  // registramos assíncrono para auditoria.
  const wouldDeny = !clientAllows;

  if (wouldDeny) {
    // fire-and-forget — nunca bloqueia o clique
    void supabase.rpc("log_permission_shadow", {
      _company_db: companyDb,
      _module: module,
      _action: action,
      _decision: "deny",
      _mode: mode,
      _reason: "client_deny",
      _identifier: identifier,
      _context: { source: "gateSync" },
    }).then(() => {}, () => {});
  }

  return {
    mode,
    allow: mode === "enforce" ? !wouldDeny : clientAllows, // shadow respeita v1
    wouldDeny,
  };
}

/* ────────────────────────────────────────────────────────────────────
 * Provider — carrega snapshot no login e mantém atualizado via Realtime.
 * ─────────────────────────────────────────────────────────────────── */

const Ctx = createContext<Snapshot>(INITIAL);

export function PermissionsV2Provider({ children }: { children: ReactNode }) {
  const { session } = useSap();
  const [snap, setSnap] = useState<Snapshot>(INITIAL);
  const bumpRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      const [{ data: flags }, { data: scope, error: scopeError }] = await Promise.all([
        supabase
          .from("feature_flags")
          .select("key, enabled")
          .in("key", ["permissions_v2", "permissions_v2_kill"]),
        // A tabela expõe `enabled` (boolean); pedir uma coluna `mode` fazia o
        // PostgREST interpretar `mode` como agregado e devolver 400, quebrando
        // a entrada em empresas com enforcement ligado (ex.: ANA Gaming).
        supabase
          .from("permissions_enforcement_scope")
          .select("company_db, enabled"),
      ]);

      if (cancelled) return;

      if (scopeError) {
        console.error("[permissions-v2] falha ao carregar enforcement scope", scopeError);
      }

      const flagMap = new Map((flags || []).map((f: any) => [f.key, !!f.enabled]));
      const scopeMap: Record<string, PermissionMode> = {};
      for (const row of (scope || []) as any[]) {
        if (row.company_db) {
          scopeMap[String(row.company_db).toLowerCase()] = (row.enabled ? "enforce" : "shadow") as PermissionMode;
        }
      }


      const next: Snapshot = {
        v2Enabled: flagMap.get("permissions_v2") ?? false,
        killSwitch: flagMap.get("permissions_v2_kill") ?? false,
        scope: scopeMap,
        globalMode: "shadow", // default seguro quando o flag global está ligado
        loaded: true,
      };
      snapshotRef = next;
      setSnap(next);
    }

    loadAll();

    // Realtime: reagir a mudanças em flags/scope sem exigir reload.
    const channel = supabase
      .channel(`permissions-v2-${session?.userName ?? "anon"}-${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "feature_flags" }, () => {
        bumpRef.current += 1; loadAll();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "permissions_enforcement_scope" }, () => {
        bumpRef.current += 1; loadAll();
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [session?.userName]);

  const value = useMemo(() => snap, [snap]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Hook — retorna gate síncrono já plugado no session atual. */
export function usePermissionGate() {
  const snap = useContext(Ctx);
  const { session } = useSap();
  const companyDb = session?.companyDB ?? null;
  const identifier = session?.userName ?? null;

  const gate = useMemo(() => {
    return (params: { module: string; action: PermissionAction; clientAllows: boolean }): GateResult =>
      gateSync({ ...params, companyDb, identifier });
  }, [companyDb, identifier, snap]);

  return { gate, mode: resolveMode(companyDb, snap), loaded: snap.loaded };
}
