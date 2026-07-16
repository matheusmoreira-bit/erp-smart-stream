// Executa a sincronização JumpCloud -> SAP EmployeesInfo para uma configuração.
// Suporta modos "execute" e "simulate". Apenas bases TST%.
import { logIntegrationCall } from "../_shared/integration-log.ts";
import {
  CORS_HEADERS, jsonResponse, admin, loadCredentials, assertTstCompany,
  fetchAllJumpCloudUsers, normalizeJumpCloud, hashEmployee, buildSapPayload, computeChangedFields,
  sapLogin, sapListEmployees, sapCheckUdfs, sapCreateEmployee, sapPatchEmployee,
  type NormalizedEmployee,
} from "../_shared/employee-sync.ts";

interface RunBody {
  integration_config_id: string;
  mode?: "execute" | "simulate";
  triggered_by?: string | null;
  triggered_by_email?: string | null;
  execution_type?: "manual" | "scheduled" | "simulate";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const started = Date.now();
  const supabase = admin();
  let executionId: string | null = null;
  let lockAcquired = false;
  let lockName = "";
  let companyDb = "";

  try {
    const body = (await req.json()) as RunBody;
    if (!body?.integration_config_id) throw new Error("integration_config_id ausente.");
    const mode = body.mode ?? "execute";
    const executionType: "manual" | "scheduled" | "simulate" =
      body.execution_type ?? (mode === "simulate" ? "simulate" : "manual");

    const { data: config, error: cfgErr } = await supabase
      .from("employee_integration_config")
      .select("*")
      .eq("id", body.integration_config_id)
      .single();
    if (cfgErr || !config) throw new Error(`Configuração não encontrada: ${cfgErr?.message}`);
    companyDb = config.company_db;
    assertTstCompany(companyDb);
    if (!config.is_active && executionType === "scheduled") {
      return jsonResponse({ ok: false, skipped: "integration_inactive" });
    }

    // Advisory lock
    lockName = `employees-sync:${companyDb}`;
    const { data: lockRes, error: lockErr } = await supabase.rpc("try_watcher_lock", {
      _name: lockName,
      _ttl_minutes: 15,
    });
    if (lockErr) throw new Error(`Lock falhou: ${lockErr.message}`);
    lockAcquired = Boolean(lockRes);
    if (!lockAcquired) {
      return jsonResponse({
        ok: false,
        error: "Já existe uma sincronização de colaboradores em andamento para esta base.",
      }, 409);
    }

    // Executa registro de execução
    const { data: execRow, error: execErr } = await supabase
      .from("employee_sync_execution")
      .insert({
        integration_config_id: config.id,
        company_db: companyDb,
        execution_type: executionType,
        status: "running",
        triggered_by: body.triggered_by ?? null,
        triggered_by_email: body.triggered_by_email ?? null,
      })
      .select("id")
      .single();
    if (execErr) throw new Error(`Falha criando execução: ${execErr.message}`);
    executionId = execRow.id;

    // Carrega credenciais
    const jcCreds = await loadCredentials(supabase, "jumpcloud", companyDb);
    if (!jcCreds.api_key) throw new Error("JumpCloud API Key não configurada para a base.");
    const sapCreds = await loadCredentials(supabase, "sap", companyDb);

    // Login SAP
    const session = await sapLogin(sapCreds);

    // Verifica UDFs
    const udfs = await sapCheckUdfs(session);
    if (udfs.missing.length > 0) {
      throw new Error(
        `Campos de usuário ausentes no SAP: ${udfs.missing.join(", ")}. ` +
        `Crie os UDFs em OHEM antes de executar a sincronização.`,
      );
    }

    // Fetch JumpCloud + SAP
    const jcUsers = await fetchAllJumpCloudUsers(jcCreds.api_key, jcCreds.org_id);
    const sapUsers = await sapListEmployees(session);

    // Index SAP por U_JC_UserId (primário) e email (fallback)
    const sapByJc = new Map<string, Record<string, unknown>>();
    const sapByEmail = new Map<string, Record<string, unknown>>();
    for (const s of sapUsers) {
      const jc = s.U_JC_UserId ? String(s.U_JC_UserId) : "";
      if (jc) sapByJc.set(jc, s);
      const em = s.EMail ? String(s.EMail).toLowerCase() : "";
      if (em) sapByEmail.set(em, s);
    }

    // Departamento
    const { data: deptMappings } = await supabase
      .from("employee_department_mapping")
      .select("jumpcloud_department, sap_department_code")
      .eq("integration_config_id", config.id);
    const deptMap = new Map<string, string>();
    for (const m of (deptMappings ?? []) as Array<{ jumpcloud_department: string; sap_department_code: string | null }>) {
      if (m.sap_department_code) deptMap.set(m.jumpcloud_department.toLowerCase(), m.sap_department_code);
    }

    // Contadores + items
    const counters = {
      total_source: jcUsers.length,
      total_matched: 0,
      total_created: 0,
      total_updated: 0,
      total_unchanged: 0,
      total_inactivated: 0,
      total_pending: 0,
      total_errors: 0,
    };
    const jcNormMap = new Map<string, NormalizedEmployee>();
    const items: Array<Record<string, unknown>> = [];

    for (const raw of jcUsers) {
      const norm = normalizeJumpCloud(raw);
      jcNormMap.set(norm.jumpCloudUserId, norm);
      const existing =
        sapByJc.get(norm.jumpCloudUserId) ??
        (norm.email ? sapByEmail.get(norm.email) : undefined);
      if (existing) counters.total_matched++;

      // Skip inativos se sync_inactive_users=false e não existe no SAP
      if (!config.sync_inactive_users && norm.suspended && !existing) {
        items.push(itemBase(config.id, executionId!, companyDb, norm, existing, {
          result: "would_skip", message: "Colaborador suspenso no JC; sync_inactive_users=false.",
        }));
        continue;
      }

      // Departamento
      let deptCode: string | null = null;
      let deptPending = false;
      if (norm.departmentName) {
        deptCode = deptMap.get(norm.departmentName.toLowerCase()) ?? null;
        if (!deptCode && config.default_department_code) deptCode = config.default_department_code;
        if (!deptCode) deptPending = true;
      } else if (config.default_department_code) {
        deptCode = config.default_department_code;
      }

      if (deptPending) {
        counters.total_pending++;
        items.push(itemBase(config.id, executionId!, companyDb, norm, existing, {
          result: "pending", message: `Departamento "${norm.departmentName}" sem mapeamento.`,
          department_source: norm.departmentName,
        }));
        continue;
      }

      const status = norm.suspended ? "SUSPENDED" : norm.active ? "ACTIVE" : "INACTIVE";
      const hash = await hashEmployee(norm, { departmentCode: deptCode, status });
      const payload = buildSapPayload(norm, {
        departmentCode: deptCode,
        branchCode: config.default_branch_code,
        hash,
      });

      try {
        if (!existing) {
          if (mode === "simulate") {
            counters.total_created++;
            items.push(itemBase(config.id, executionId!, companyDb, norm, null, {
              result: "would_create", hash, sap_payload: payload,
              department_source: norm.departmentName, department_target: deptCode,
            }));
          } else {
            const created = await sapCreateEmployee(session, payload);
            const empId = Number(created?.EmployeeID ?? created?.EmployeeId ?? 0) || null;
            counters.total_created++;
            items.push(itemBase(config.id, executionId!, companyDb, norm, null, {
              result: "created", hash, sap_payload: payload,
              sap_employee_id: empId,
              department_source: norm.departmentName, department_target: deptCode,
            }));
          }
        } else {
          const currentHash = existing.U_JC_LastHash ? String(existing.U_JC_LastHash) : "";
          const changed = computeChangedFields(existing, payload);
          const suspendedTransition = norm.suspended && String(existing.U_JC_Active ?? "Y") === "Y";
          if (currentHash === hash && changed.length === 0 && !suspendedTransition) {
            counters.total_unchanged++;
            items.push(itemBase(config.id, executionId!, companyDb, norm, existing, {
              result: "unchanged", hash,
              department_source: norm.departmentName, department_target: deptCode,
            }));
          } else {
            const empId = Number(existing.EmployeeID ?? 0);
            if (mode === "simulate") {
              if (suspendedTransition) counters.total_inactivated++;
              else counters.total_updated++;
              items.push(itemBase(config.id, executionId!, companyDb, norm, existing, {
                result: suspendedTransition ? "would_inactivate" : "would_update",
                hash, sap_payload: payload, changed_fields: changed,
                sap_employee_id: empId || null,
                department_source: norm.departmentName, department_target: deptCode,
              }));
            } else {
              await sapPatchEmployee(session, empId, payload);
              if (suspendedTransition) counters.total_inactivated++;
              else counters.total_updated++;
              items.push(itemBase(config.id, executionId!, companyDb, norm, existing, {
                result: suspendedTransition ? "inactivated" : "updated",
                hash, sap_payload: payload, changed_fields: changed,
                sap_employee_id: empId,
                department_source: norm.departmentName, department_target: deptCode,
              }));
            }
          }
        }
      } catch (e) {
        counters.total_errors++;
        items.push(itemBase(config.id, executionId!, companyDb, norm, existing, {
          result: "error",
          message: (e as Error).message.slice(0, 800),
          department_source: norm.departmentName, department_target: deptCode,
        }));
      }
    }

    // Segunda passada: relações de gestores
    if (config.sync_managers && mode !== "simulate") {
      const finalSap = await sapListEmployees(session, "EmployeeID,U_JC_UserId,Manager");
      const empIdByJc = new Map<string, number>();
      for (const s of finalSap) {
        if (s.U_JC_UserId) empIdByJc.set(String(s.U_JC_UserId), Number(s.EmployeeID));
      }
      for (const norm of jcNormMap.values()) {
        if (!norm.managerJumpCloudUserId) continue;
        const empId = empIdByJc.get(norm.jumpCloudUserId);
        const managerEmpId = empIdByJc.get(norm.managerJumpCloudUserId);
        if (!empId) continue;
        if (!managerEmpId) {
          await supabase.from("employee_pending_relation").upsert({
            integration_config_id: config.id,
            employee_jc_id: norm.jumpCloudUserId,
            manager_jc_id: norm.managerJumpCloudUserId,
            last_attempt_at: new Date().toISOString(),
            message: "Gestor ainda não sincronizado.",
            resolved_at: null,
          }, { onConflict: "integration_config_id,employee_jc_id" });
          continue;
        }
        try {
          await sapPatchEmployee(session, empId, { Manager: managerEmpId });
          await supabase.from("employee_pending_relation").upsert({
            integration_config_id: config.id,
            employee_jc_id: norm.jumpCloudUserId,
            manager_jc_id: norm.managerJumpCloudUserId,
            resolved_at: new Date().toISOString(),
            last_attempt_at: new Date().toISOString(),
            message: null,
          }, { onConflict: "integration_config_id,employee_jc_id" });
        } catch (e) {
          await supabase.from("employee_pending_relation").upsert({
            integration_config_id: config.id,
            employee_jc_id: norm.jumpCloudUserId,
            manager_jc_id: norm.managerJumpCloudUserId,
            last_attempt_at: new Date().toISOString(),
            message: (e as Error).message.slice(0, 500),
            resolved_at: null,
          }, { onConflict: "integration_config_id,employee_jc_id" });
        }
      }
    }

    // Persist items em lote
    for (let i = 0; i < items.length; i += 500) {
      const chunk = items.slice(i, i + 500);
      const { error: insErr } = await supabase.from("employee_sync_item").insert(chunk);
      if (insErr) console.warn("employee_sync_item insert failed", insErr.message);
    }

    const status =
      counters.total_errors > 0 && (counters.total_created + counters.total_updated) === 0
        ? "error"
        : counters.total_errors > 0
          ? "partial"
          : "success";

    const finished = new Date().toISOString();
    await supabase.from("employee_sync_execution").update({
      status,
      finished_at: finished,
      duration_ms: Date.now() - started,
      ...counters,
    }).eq("id", executionId);

    await supabase.from("employee_integration_config").update({
      last_execution_at: finished,
      last_execution_status: status,
      last_execution_message: `${counters.total_created} criados, ${counters.total_updated} atualizados, ${counters.total_errors} erros`,
    }).eq("id", config.id);

    await logIntegrationCall({
      system_name: "jumpcloud_employees",
      action: mode === "simulate" ? "simulate" : "sync",
      company_db: companyDb,
      status: status === "success" ? "ok" : "error",
      duration_ms: Date.now() - started,
      response_meta: counters,
    });

    return jsonResponse({ ok: true, execution_id: executionId, status, ...counters });
  } catch (e) {
    const msg = (e as Error).message;
    if (executionId) {
      await supabase.from("employee_sync_execution").update({
        status: "error",
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - started,
        error_message: msg.slice(0, 1000),
      }).eq("id", executionId);
    }
    await logIntegrationCall({
      system_name: "jumpcloud_employees",
      action: "sync",
      company_db: companyDb || null,
      status: "error",
      error_message: msg.slice(0, 500),
      duration_ms: Date.now() - started,
    }).catch(() => {});
    return jsonResponse({ ok: false, error: msg, execution_id: executionId }, 500);
  } finally {
    if (lockAcquired) {
      await supabase.rpc("release_watcher_lock", { _name: lockName, _status: "ok", _message: null })
        .catch(() => {});
    }
  }
});

function itemBase(
  configId: string,
  executionId: string,
  companyDb: string,
  norm: NormalizedEmployee,
  existing: Record<string, unknown> | null | undefined,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    execution_id: executionId,
    integration_config_id: configId,
    company_db: companyDb,
    jumpcloud_user_id: norm.jumpCloudUserId,
    sap_employee_id: existing?.EmployeeID ? Number(existing.EmployeeID) : null,
    employee_name: norm.displayName ?? ([norm.firstName, norm.lastName].filter(Boolean).join(" ") || null),
    employee_email: norm.email,
    manager_jc_id: norm.managerJumpCloudUserId,
    normalized_payload: norm as unknown as Record<string, unknown>,
    ...extra,
  };
}
