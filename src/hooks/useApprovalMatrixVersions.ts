import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";
import {
  buildSnapshot,
  countLevels,
  type MatrixVersion,
  type SnapshotRule,
} from "@/lib/approval-matrix-versions";
import type { ApprovalRule } from "@/hooks/useApprovalRules";

/**
 * Versionamento da matriz de alçadas.
 *
 * Cada "publicação" congela o estado completo das regras da empresa ativa em
 * `approval_matrix_versions.snapshot`. O rollback reescreve as regras vivas a
 * partir de um snapshot e publica automaticamente uma nova versão marcada com
 * `restored_from_version`, preservando a trilha de auditoria (nunca apagamos
 * versões anteriores).
 */
export function useApprovalMatrixVersions() {
  const { session } = useSap();
  const companyDb = session?.companyDB || null;
  const actor = session?.userName || "";
  const [versions, setVersions] = useState<MatrixVersion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchVersions = useCallback(async () => {
    if (!companyDb) {
      setVersions([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("approval_matrix_versions")
        .select("*")
        .eq("company_db", companyDb)
        .order("version_no", { ascending: false })
        .limit(100);
      if (err) throw err;
      setVersions(
        (data || []).map((v: any) => ({
          ...v,
          snapshot: Array.isArray(v.snapshot) ? (v.snapshot as SnapshotRule[]) : [],
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar versões");
    } finally {
      setIsLoading(false);
    }
  }, [companyDb]);

  useEffect(() => {
    void fetchVersions();
  }, [fetchVersions]);

  const publishVersion = useCallback(
    async (
      rules: ApprovalRule[],
      opts?: { label?: string; description?: string; restoredFrom?: number | null },
    ) => {
      if (!companyDb) throw new Error("Selecione uma empresa antes de publicar uma versão");
      const snapshot = buildSnapshot(rules);

      const { data: last } = await supabase
        .from("approval_matrix_versions")
        .select("version_no")
        .eq("company_db", companyDb)
        .order("version_no", { ascending: false })
        .limit(1);
      const nextNo = ((last?.[0] as any)?.version_no || 0) + 1;

      const { data, error: err } = await supabase
        .from("approval_matrix_versions")
        .insert({
          company_db: companyDb,
          version_no: nextNo,
          label: opts?.label?.trim() || `Publicação #${nextNo}`,
          description: opts?.description?.trim() || null,
          rules_count: snapshot.length,
          levels_count: countLevels(snapshot),
          snapshot: snapshot as any,
          created_by: actor || null,
          restored_from_version: opts?.restoredFrom ?? null,
        })
        .select()
        .single();
      if (err) throw err;

      await supabase.rpc("insert_audit_log", {
        p_action: opts?.restoredFrom ? "rollback_approval_matrix" : "publish_approval_matrix",
        p_entity_type: "approval_matrix_version",
        p_entity_id: (data as any).id,
        p_actor_email: actor,
        p_company_db: companyDb,
        p_details: {
          version_no: nextNo,
          rules_count: snapshot.length,
          restored_from_version: opts?.restoredFrom ?? null,
        } as any,
      });

      await fetchVersions();
      return data as any as MatrixVersion;
    },
    [companyDb, actor, fetchVersions],
  );

  /** Reescreve as regras vivas com o conteúdo do snapshot informado. */
  const restoreVersion = useCallback(
    async (version: MatrixVersion, currentRules: ApprovalRule[]) => {
      if (!companyDb) throw new Error("Selecione uma empresa antes de restaurar");

      // Backup implícito do estado atual antes de sobrescrever.
      await publishVersion(currentRules, {
        label: `Backup automático antes do rollback → v${version.version_no}`,
        description: "Gerado automaticamente pelo versionamento da matriz.",
      });

      const snapshot = version.snapshot || [];

      // Remove as regras atuais da empresa (níveis caem por cascade/limpeza explícita).
      const currentIds = currentRules.map((r) => r.id);
      if (currentIds.length > 0) {
        const CHUNK = 100;
        for (let i = 0; i < currentIds.length; i += CHUNK) {
          const chunk = currentIds.slice(i, i + CHUNK);
          await supabase.from("approval_rule_levels").delete().in("rule_id", chunk);
        }
      }
      const { error: delErr } = await supabase
        .from("approval_rules")
        .delete()
        .eq("company_db", companyDb);
      if (delErr) throw delErr;

      if (snapshot.length > 0) {
        const { data: inserted, error: insErr } = await supabase
          .from("approval_rules")
          .insert(
            snapshot.map((r) => ({
              id: r.id,
              name: r.name,
              is_active: r.is_active,
              priority: r.priority,
              doc_type: r.doc_type,
              criteria: r.criteria as any,
              created_by: actor || "rollback",
              company_db: companyDb,
            })),
          )
          .select("id");
        if (insErr) throw insErr;

        const levelRows = snapshot.flatMap((r) =>
          (r.levels || []).map((l) => ({
            rule_id: r.id,
            level_order: l.level_order,
            approver_name: l.approver_name,
            approver_email: l.approver_email || null,
          })),
        );
        if (levelRows.length > 0 && inserted) {
          const { error: lvlErr } = await supabase.from("approval_rule_levels").insert(levelRows);
          if (lvlErr) throw lvlErr;
        }
      }

      // Publica a versão resultante do rollback.
      const restoredRules = snapshot.map(
        (r) =>
          ({
            ...r,
            created_by: actor,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            company_db: companyDb,
            levels: r.levels,
          }) as unknown as ApprovalRule,
      );
      await publishVersion(restoredRules, {
        label: `Rollback para v${version.version_no}`,
        description: version.label ? `Estado restaurado de "${version.label}".` : null,
        restoredFrom: version.version_no,
      });
    },
    [companyDb, actor, publishVersion],
  );

  return { versions, isLoading, error, refresh: fetchVersions, publishVersion, restoreVersion };
}
