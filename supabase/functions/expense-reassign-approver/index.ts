// Reprocessamento de roteamento de aprovação.
//
// Contexto: quando o centro de custo do documento não possui regra na matriz,
// a criação caía no `get_default_expense_approver` e o documento parava na
// caixa de um admin qualquer (que não é o aprovador daquele CC).
//
// Esta função reavalia documentos pendentes contra a matriz atual e, quando o
// CC exato não tem alçada, usa o fallback hierárquico (regra do ramo mais
// próximo: 1.80.1.x → 1.80.x). Registra audit_log e notifica o novo aprovador.
//
// Autorização: apenas admin (Cloud admin ou SAP admin/superuser).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { requireUser, validateSapSession, AuthError } from "../_shared/auth.ts";
import { corsFor, rejectForeignOrigin } from "../_shared/cors-allowlist.ts";
import { notifyApprovalPending } from "../_shared/approval-notify.ts";
import { resolveIdentityAliases } from "../_shared/user-aliases.ts";
import {
  findMatchingRule,
  pickHierarchicalFallbackRule,
  type RuleRow,
} from "../_shared/rule-match.ts";
import {
  buildRateioSegments,
  buildReembolsoSegments,
  persistRateioSegments,
  persistSegmentSubset,
  pendingApproverLabel,
} from "../_shared/rateio-segments.ts";
import {
  activeRevisionApprovalsFromLogs,
  priorApprovalsForSegment,
  resolveReprocessedApprovalState,
  type PriorApproval,
} from "../_shared/approval-reprocess.ts";

const norm = (v: unknown) => String(v ?? "").toLowerCase().trim();
type ReprocessRuleRow = RuleRow & { auto_approve?: boolean | null };

async function loadPriorApprovals(admin: any, expenseId: string): Promise<{
  document: PriorApproval[];
  bySegment: Map<string, PriorApproval[]>;
}> {
  const { data: logsRaw } = await admin
    .from("expense_approval_log")
    .select(
      "decision, approver_name, approver_email, substituted_for_name, substituted_for_email, created_at, remarks",
    )
    .eq("expense_id", expenseId)
    .order("created_at", { ascending: true });
  const logs = (logsRaw || []) as Array<Record<string, any>>;
  const lastReset = [...logs].reverse().find((row) =>
    ["created", "submitted", "reactivated"].includes(String(row.decision))
  );
  const resetAt = lastReset?.created_at ? String(lastReset.created_at) : null;
  const document = activeRevisionApprovalsFromLogs(logs);
  const historicalAliases = await resolveIdentityAliases(
    admin,
    document.flatMap((approval) => [
      approval.approver_email,
      approval.approver_name,
      approval.substituted_for_email,
      approval.substituted_for_name,
    ]),
  );
  document.push(...Array.from(historicalAliases).map((alias) => ({ approver_name: alias })));

  let auditQuery = admin
    .from("expense_audit_log")
    .select(
      "segment_key, actor_identity, actor_email, substituted_for_name, substituted_for_email, created_at",
    )
    .eq("expense_id", expenseId)
    .eq("decision", "approved")
    .not("segment_key", "is", null);
  if (resetAt) auditQuery = auditQuery.gte("created_at", resetAt);
  const { data: auditRaw } = await auditQuery;
  const bySegment = new Map<string, PriorApproval[]>();
  for (const row of (auditRaw || []) as Array<Record<string, any>>) {
    const key = String(row.segment_key || "");
    if (!key) continue;
    const list = bySegment.get(key) || [];
    list.push({
      approver_name: row.actor_identity,
      approver_email: row.actor_email,
      substituted_for_name: row.substituted_for_name,
      substituted_for_email: row.substituted_for_email,
    });
    bySegment.set(key, list);
  }
  return { document, bySegment };
}

async function dispatchApprovedExpense(expenseId: string, alreadyIntegrated: boolean): Promise<void> {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const serviceUrl = Deno.env.get("SUPABASE_URL") || "";
  if (!serviceKey || !serviceUrl) return;
  const response = await fetch(`${serviceUrl}/functions/v1/expense-to-sap`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "x-internal-retry": "1",
    },
    body: JSON.stringify({
      expense_id: expenseId,
      patch_document: alreadyIntegrated,
      use_service_account: true,
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    console.warn("[expense-reassign-approver] integração após reprocesso falhou:", payload);
  }
}

Deno.serve(async (req) => {
  const foreign = rejectForeignOrigin(req);
  if (foreign) return foreign;
  const corsHeaders = corsFor(req);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let body: {
    company_db?: string | null;
    expense_ids?: string[];
    dry_run?: boolean;
    only_unmatched?: boolean;
    /** Reprocessa apenas as trilhas deste centro de custo (ex.: "1.8.1.8"). */
    segment_cost_center?: string | null;
    /** Opcional: restringe também pelo projeto do segmento. */
    segment_project?: string | null;
  } = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Corpo inválido (JSON malformado)." });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // ── Autorização (admin apenas) ────────────────────────────────────────
  let isAdminCaller = false;
  let actorLabel = "desconhecido";
  // Chamada interna (rotinas administrativas) autentica com a service role key
  // ou com o segredo de scheduler usado pelas demais automações.
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (bearer && bearer === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
    isAdminCaller = true;
    actorLabel = "sistema";
  }
  const schedulerSecret = (req.headers.get("x-scheduler-secret") || "").trim();
  const expectedSecret = (Deno.env.get("SCHEDULER_SECRET") || "").trim();
  if (schedulerSecret && expectedSecret && schedulerSecret === expectedSecret) {
    isAdminCaller = true;
    actorLabel = "sistema";
  }

  try {
    const cloudUser = await requireUser(req);
    actorLabel = cloudUser.email || cloudUser.id;
    const { data: hasAdmin } = await admin.rpc("has_role", { _user_id: cloudUser.id, _role: "admin" });
    if (hasAdmin === true) isAdminCaller = true;
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
  }
  const sap = await validateSapSession(req);
  if (sap) {
    actorLabel = sap.email || sap.userName || actorLabel;
    try {
      const { data: mappedAdmin } = await admin.rpc("is_sap_user_admin", {
        _sap_username: norm(sap.userName),
      });
      if (mappedAdmin === true) isAdminCaller = true;
    } catch { /* noop */ }
    if (norm(sap.userName) === "manager") isAdminCaller = true;
  }
  if (!isAdminCaller) {
    return json(403, { error: "Apenas administradores podem reprocessar o roteamento de aprovação." });
  }

  const dryRun = body.dry_run === true;
  const segmentCc = String(body.segment_cost_center || "").trim();
  const segmentProject = body.segment_project == null ? null : String(body.segment_project).trim();

  const onlyUnmatched = segmentCc ? false : body.only_unmatched !== false; // padrão: só os sem regra
  const companyDb = body.company_db ? String(body.company_db) : null;

  try {
    // ── Documentos alvo ────────────────────────────────────────────────
    let q = admin
      .from("expenses")
      .select(
        "id, company_db, doc_type, cost_center, project, supplier_name, supplier_code, currency, total_amount, requester_name, requester_email, current_approver, original_approver, current_level_order, approval_rule_id, rateio_type, status, sap_doc_entry",
      )
      .eq("status", "pendente_aprovacao")
      .limit(500);
    if (companyDb) q = q.eq("company_db", companyDb);
    if (Array.isArray(body.expense_ids) && body.expense_ids.length > 0) {
      q = q.in("id", body.expense_ids.slice(0, 200));
    } else if (onlyUnmatched) {
      q = q.is("approval_rule_id", null);
    }

    const { data: docsRaw, error: docsErr } = await q;
    if (docsErr) return json(500, { error: docsErr.message });
    const docs = (docsRaw || []) as Record<string, any>[];
    if (docs.length === 0) {
      return json(200, { ok: true, scanned: 0, reassigned: 0, results: [], dry_run: dryRun });
    }

    // ── Modo "reprocessar apenas um CC" ────────────────────────────────
    // Regenera somente as trilhas do segmento informado, preservando as
    // demais (inclusive aprovações já registradas em outros segmentos).
    if (segmentCc) {
      const segResults: Record<string, unknown>[] = [];
      let changed = 0;
      for (const doc of docs) {
        const { data: itemsSeg } = await admin
          .from("expense_items")
          .select("expense_id, cost_center, project, line_total")
          .eq("expense_id", doc.id);
        const allItems = (itemsSeg || []) as Record<string, any>[];
        const built = await buildRateioSegments(admin, allItems as any, {
          companyDb: doc.company_db,
          docType: String(doc.doc_type || "purchase"),
          currency: doc.currency || "BRL",
          requesterName: doc.requester_name || null,
          supplierName: doc.supplier_name || null,
          supplierCode: doc.supplier_code || null,
          headerCostCenter: doc.cost_center || null,
          headerProject: doc.project || null,
          rateioType: String(doc.rateio_type || "padrao").toLowerCase(),
        } as any, { allowSingle: true });
        const target = (built || []).filter((sg) =>
          norm(sg.cost_center) === norm(segmentCc) &&
          (segmentProject === null || segmentProject === "" || norm(sg.project) === norm(segmentProject))
        );
        if (target.length === 0) {
          segResults.push({ expense_id: doc.id, skipped: "segmento_nao_encontrado", cost_center: segmentCc });
          continue;
        }
        if (dryRun) {
          segResults.push({
            expense_id: doc.id,
            action: "segment_rebuild",
            dry_run: true,
            segments: target.map((sg) => ({
              cost_center: sg.cost_center,
              project: sg.project,
              amount: sg.amount,
              rule_id: sg.rule_id,
              rule_name: sg.rule_name,
              resolution: sg.resolution,
              first_approver: sg.chain[0]?.approver_name || null,
            })),
          });
          changed += 1;
          continue;
        }

        const before = await admin
          .from("expense_approval_segments")
          .select("segment_key, cost_center, project, current_approver, status")
          .eq("expense_id", doc.id);
        const priorApprovals = await loadPriorApprovals(admin, doc.id);
        const approvedBySegment = new Map<string, PriorApproval[]>();
        for (const segment of target) {
          approvedBySegment.set(
            segment.segment_key,
            priorApprovalsForSegment(
              priorApprovals.bySegment,
              segment.segment_key,
              priorApprovals.document,
            ),
          );
        }
        const rows = await persistSegmentSubset(
          admin,
          doc.id,
          target,
          doc.requester_name || null,
          doc.requester_email || null,
          { approvedBySegment },
        );

        // Recalcula o rótulo do documento com TODAS as trilhas (as preservadas + as novas).
        const { data: allSegs } = await admin
          .from("expense_approval_segments")
          .select("status, current_approver, current_level")
          .eq("expense_id", doc.id);
        const segsAll = (allSegs || []) as Record<string, any>[];
        const label = pendingApproverLabel(segsAll as any);
        const pendingLevels = segsAll.filter((r) => r.status === "pendente").map((r) => Number(r.current_level || 1));
        const finalized = pendingLevels.length === 0;
        await admin
          .from("expenses")
          .update({
            status: finalized ? "aprovado" : "pendente_aprovacao",
            current_approver: label,
            current_level_order: finalized ? 0 : Math.min(...pendingLevels),
            updated_at: new Date().toISOString(),
          })
          .eq("id", doc.id)
          .eq("status", "pendente_aprovacao");

        await admin.from("audit_log").insert({
          actor_email: actorLabel,
          action: "approval_segment_rebuild",
          entity_type: "expense",
          entity_id: doc.id,
          company_db: doc.company_db,
          details: {
            cost_center: segmentCc,
            project: segmentProject,
            before: (before.data || []).filter((r: any) => norm(r.cost_center) === norm(segmentCc)),
            after: rows.map((r) => ({
              cost_center: r.cost_center,
              project: r.project,
              amount: r.amount,
              approver: r.current_approver,
            })),
            document_approver: label,
          },
        });

        for (const r of rows) {
          if (r.status === "pendente") await notifyApprovalPending(admin, {
            expenseId: doc.id,
            companyDb: doc.company_db,
            approverEmail: r.current_approver_email || null,
            approverName: r.current_approver || null,
            levelOrder: r.current_level || 1,
            requesterName: doc.requester_name,
            supplierName: doc.supplier_name,
            totalAmount: r.amount,
            currency: doc.currency,
            docType: String(doc.doc_type || "purchase"),
            resolution: {
              source: "manual_reassign",
              reason: `Trilha reprocessada: CC ${r.cost_center || "—"} / projeto ${r.project || "—"}`,
              ruleId: r.rule_id,
              ruleName: null,
              costCenter: r.cost_center,
              project: r.project,
              metadata: { scope: "segment_only" },
            },
          } as any);
        }

        if (finalized) {
          await dispatchApprovedExpense(doc.id, !!doc.sap_doc_entry);
        }

        changed += 1;
        segResults.push({
          expense_id: doc.id,
          action: "segment_rebuild",
          cost_center: segmentCc,
          document_approver: label,
          finalized,
          segments: rows.map((r) => ({
            cost_center: r.cost_center,
            project: r.project,
            amount: r.amount,
            approver: r.current_approver,
          })),
        });
      }
      return json(200, { ok: true, scanned: docs.length, reassigned: changed, results: segResults, dry_run: dryRun, scope: "segment" });
    }

    // ── Itens (CC quando o cabeçalho está vazio + contexto de regra) ────
    const ids = docs.map((d) => d.id);
    const { data: itemsRaw } = await admin
      .from("expense_items")
      .select(
        "expense_id, cost_center, project, line_total, item_code, description, items_group_name",
      )
      .in("expense_id", ids);
    const itemsByDoc = new Map<string, Record<string, any>[]>();
    for (const it of (itemsRaw || []) as Record<string, any>[]) {
      const arr = itemsByDoc.get(it.expense_id) || [];
      arr.push(it);
      itemsByDoc.set(it.expense_id, arr);
    }

    // ── Matriz por empresa (cache) ─────────────────────────────────────
    const rulesCache = new Map<string, ReprocessRuleRow[]>();
    const loadRules = async (db: string): Promise<ReprocessRuleRow[]> => {
      if (rulesCache.has(db)) return rulesCache.get(db)!;
      const { data } = await admin
        .from("approval_rules")
        .select("id, name, is_active, priority, doc_type, criteria, company_db, auto_approve")
        .eq("company_db", db)
        .eq("is_active", true);
      const rows = (data || []) as ReprocessRuleRow[];
      rulesCache.set(db, rows);
      return rows;
    };
    const levelsOf = async (ruleId: string) => {
      const { data } = await admin
        .from("approval_rule_levels")
        .select("level_order, approver_name, approver_email")
        .eq("rule_id", ruleId)
        .order("level_order", { ascending: true });
      return (data || []) as Array<{
        level_order: number;
        approver_name: string | null;
        approver_email: string | null;
      }>;
    };

    const results: Record<string, unknown>[] = [];
    let reassigned = 0;

    for (const doc of docs) {
      const rules = await loadRules(doc.company_db);
      if (rules.length === 0) {
        results.push({ expense_id: doc.id, skipped: "matriz_vazia" });
        continue;
      }

      const items = itemsByDoc.get(doc.id) || [];
      const ccs = [
        String(doc.cost_center || "").trim(),
        ...items.map((i) => String(i.cost_center || "").trim()),
      ].filter(Boolean);
      const candidateCcs = Array.from(new Set(ccs));
      const docType = String(doc.doc_type || "purchase");

      const priorApprovals = await loadPriorApprovals(admin, doc.id);

      // ── Rateio: reconstrói trilhas independentes por (CC + projeto) ────
      // A matriz e as cadeias são recalculadas, mas cada trilha avança por
      // todos os aprovadores que já decidiram neste documento.
      const rateioTypeNorm = String(doc.rateio_type || "").toLowerCase();
      const isReembolso = rateioTypeNorm === "reembolso";
      const rateioOverride = ["folha", "imposto", "viagens"].includes(rateioTypeNorm);
      if (!rateioOverride) {
        const segCtx = {
          companyDb: doc.company_db,
          docType,
          currency: doc.currency || "BRL",
          requesterName: doc.requester_name || null,
          supplierName: doc.supplier_name || null,
          supplierCode: doc.supplier_code || null,
          headerCostCenter: doc.cost_center || null,
          headerProject: doc.project || null,
          rateioType: rateioTypeNorm || "padrao",
        };
        const segments = isReembolso
          ? await buildReembolsoSegments(admin, items as any, segCtx as any)
          : await buildRateioSegments(admin, items as any, segCtx as any);
        if (segments && segments.length > 0) {
          const approvedBySegment = new Map<string, PriorApproval[]>();
          const preservedBySegment = new Map<string, number[]>();
          for (const segment of segments) {
            const approvals = priorApprovalsForSegment(
              priorApprovals.bySegment,
              segment.segment_key,
              priorApprovals.document,
            );
            approvedBySegment.set(segment.segment_key, approvals);
            preservedBySegment.set(
              segment.segment_key,
              resolveReprocessedApprovalState(
                segment.chain,
                approvals,
                doc.requester_name || null,
                doc.requester_email || null,
              ).preserved_levels,
            );
          }
          if (dryRun) {
            results.push({
              expense_id: doc.id,
              action: "rateio_segments",
              dry_run: true,
              segments: segments.map((s) => ({
                cost_center: s.cost_center,
                project: s.project,
                amount: s.amount,
                rule_id: s.rule_id,
                ...resolveReprocessedApprovalState(
                  s.chain,
                  approvedBySegment.get(s.segment_key) || [],
                  doc.requester_name || null,
                  doc.requester_email || null,
                ),
              })),
            });
            reassigned += 1;
            continue;
          }
          const rows = await persistRateioSegments(
            admin,
            doc.id,
            segments,
            doc.requester_name || null,
            doc.requester_email || null,
            { approvedBySegment },
          );
          const pendingRows = rows.filter((row) => row.status === "pendente");
          const finalized = pendingRows.length === 0;
          const label = pendingApproverLabel(rows);
          await admin
            .from("expenses")
            .update({
              status: finalized ? "aprovado" : "pendente_aprovacao",
              current_approver: label,
              current_level_order: finalized
                ? 0
                : Math.min(...pendingRows.map((r) => r.current_level || 1)),
              original_approver: doc.original_approver || doc.current_approver,
              updated_at: new Date().toISOString(),
            })
            .eq("id", doc.id)
            .eq("status", "pendente_aprovacao");

          await admin.from("audit_log").insert({
            actor_email: actorLabel,
            action: "approval_segments_rebuild",
            entity_type: "expense",
            entity_id: doc.id,
            company_db: doc.company_db,
            details: {
              from_approver: doc.current_approver,
              to_approvers: label,
              finalized,
              preserved_levels: Array.from(preservedBySegment.values()).flat().length,
              segments: rows.map((r) => ({
                cost_center: r.cost_center,
                project: r.project,
                amount: r.amount,
                approver: r.current_approver,
                status: r.status,
              })),
            },
          });

          // Auditoria por TRILHA (padrão x reembolso) — todos os eventos do
          // mesmo reprocesso compartilham o correlation_id do documento.
          const correlationId = `${doc.id}:reprocess:${new Date().toISOString()}`;
          for (const r of rows) {
            try {
              await admin.from("expense_audit_log").insert({
                expense_id: doc.id,
                action: "reprocess",
                decision: "pending",
                level_order: r.current_level || 1,
                actor_identity: actorLabel,
                actor_email: actorLabel?.includes("@") ? actorLabel : null,
                actor_source: "cloud_admin",
                company_db: doc.company_db,
                correlation_id: correlationId,
                step: "rebuild_track",
                segment_key: r.segment_key,
                track: r.segment_key === "__reembolso__" ? "reembolso" : "padrao",
                cost_center: r.cost_center,
                project: r.project,
                rule_id: r.rule_id,
                rule_name: (r as any).rule_name ?? null,
                reason: `Trilha recriada por reprocesso (${rateioTypeNorm || "padrao"})`,
                metadata: {
                  amount: Number(r.amount || 0),
                  approver: r.current_approver,
                  preserved_levels: preservedBySegment.get(r.segment_key) || [],
                  from_approver: doc.current_approver,
                  rateio_type: rateioTypeNorm || "padrao",
                  parallel_reembolso: isReembolso,
                },
              } as any);
            } catch (e) {
              console.warn("[expense-reassign-approver] audit log falhou:", e);
            }
            if (r.status === "pendente") await notifyApprovalPending(admin, {
              expenseId: doc.id,
              companyDb: doc.company_db,
              approverEmail: r.current_approver_email || null,
              approverName: r.current_approver || null,
              levelOrder: r.current_level || 1,
              requesterName: doc.requester_name,
              supplierName: doc.supplier_name,
              totalAmount: r.amount,
              currency: doc.currency,
              docType,
              resolution: {
                source: "manual_reassign",
                reason: `Trilha por rateio recriada: CC ${r.cost_center || "—"} / projeto ${r.project || "—"}`,
                ruleId: r.rule_id,
                ruleName: null,
                costCenter: r.cost_center,
                project: r.project,
                metadata: { from_approver: doc.current_approver },
              },
            } as any);
          }

          if (finalized) {
            await dispatchApprovedExpense(doc.id, !!doc.sap_doc_entry);
          }

          reassigned += 1;
          results.push({
            expense_id: doc.id,
            action: "rateio_segments",
            from_approver: doc.current_approver,
            to_approvers: label,
            finalized,
            preserved_levels: Array.from(preservedBySegment.values()).flat().length,
            segments: rows.map((r) => ({
              cost_center: r.cost_center,
              project: r.project,
              amount: r.amount,
              approver: r.current_approver,
              status: r.status,
            })),
          });
          continue;
        }
      }


      let matched: ReprocessRuleRow | null = null;
      let fallbackInfo: { branch: string; sibling: string } | null = null;
      let usedCc: string | null = null;

      // Regras por item/grupo (ex.: "Folha") só batem se o contexto trouxer os
      // tokens dos itens — mesmo formato usado no frontend (envolto em espaços).
      const wrapTokens = (arr: string[]) => (arr.length ? ` ${arr.join(" ")} ` : "");
      const codeTokens = items.map((i) => String(i.item_code || "").trim().toLowerCase()).filter(Boolean);
      const nameTokens = items.map((i) => String(i.description || "").trim().toLowerCase()).filter(Boolean);
      const groupTokens = items
        .map((i) => String(i.items_group_name || "").trim().toLowerCase())
        .filter(Boolean);
      const itemCtx = {
        item_codes: wrapTokens([...codeTokens, ...nameTokens]),
        item_groups: wrapTokens(groupTokens),
        "item.code": wrapTokens(codeTokens),
        "item.name": wrapTokens(nameTokens),
        "item.any": wrapTokens([...codeTokens, ...nameTokens]),
      };

      for (const cc of candidateCcs.length > 0 ? candidateCcs : [""]) {
        const ctx: Record<string, unknown> = {
          total_amount: Number(doc.total_amount || 0),
          cost_center: cc,
          project: doc.project || items[0]?.project || "",
          requester_name: doc.requester_name || doc.requester_email || "",
          supplier_name: `${doc.supplier_name || ""} ${doc.supplier_code || ""}`.trim(),
          "supplier.name": norm(doc.supplier_name),
          "supplier.code": norm(doc.supplier_code),
          currency: doc.currency || "BRL",
          doc_type: docType,
          rateio_type: String(doc.rateio_type || "padrao").toLowerCase(),
          ...itemCtx,
        };
        matched = findMatchingRule(rules, ctx, docType);
        if (matched) {
          usedCc = cc;
          break;
        }
        const hier = pickHierarchicalFallbackRule(rules, ctx, docType);
        if (hier && !fallbackInfo) {
          matched = hier.rule;
          fallbackInfo = { branch: hier.matchedBranch, sibling: hier.siblingCostCenter };
          usedCc = cc;
          break;
        }
      }

      if (!matched) {
        results.push({
          expense_id: doc.id,
          skipped: "sem_regra_nem_ramo",
          cost_centers: candidateCcs,
          current_approver: doc.current_approver,
        });
        continue;
      }

      const levels = await levelsOf(matched.id);
      const automaticApproval = matched.auto_approve === true;
      if (levels.length === 0 && !automaticApproval) {
        results.push({ expense_id: doc.id, skipped: "regra_sem_nivel", rule_id: matched.id });
        continue;
      }
      const state = automaticApproval
        ? {
            status: "aprovado" as const,
            current_level: 0,
            current_approver: null,
            current_approver_email: null,
            preserved_levels: [] as number[],
          }
        : resolveReprocessedApprovalState(
            levels,
            priorApprovals.document,
            doc.requester_name || null,
            doc.requester_email || null,
          );
      const finalized = state.status === "aprovado";
      const newApprover = state.current_approver;

      const entry = {
        expense_id: doc.id,
        company_db: doc.company_db,
        cost_center: usedCc,
        from_approver: doc.current_approver,
        to_approver: newApprover,
        rule_id: matched.id,
        rule_name: matched.name,
        level_order: finalized ? 0 : state.current_level,
        preserved_levels: state.preserved_levels,
        automatic_approval: automaticApproval,
        finalized,
        hierarchical_fallback: fallbackInfo,
      };

      if (dryRun) {
        results.push({ ...entry, dry_run: true });
        reassigned += 1;
        continue;
      }

      await admin.from("expense_approval_segments").delete().eq("expense_id", doc.id);
      const { error: updErr } = await admin
        .from("expenses")
        .update({
          status: finalized ? "aprovado" : "pendente_aprovacao",
          current_approver: newApprover,
          approval_rule_id: matched.id,
          current_level_order: finalized ? 0 : state.current_level,
          original_approver: doc.original_approver || doc.current_approver,
          updated_at: new Date().toISOString(),
        })
        .eq("id", doc.id)
        .eq("status", "pendente_aprovacao");
      if (updErr) {
        results.push({ expense_id: doc.id, error: updErr.message });
        continue;
      }

      await admin.from("audit_log").insert({
        actor_email: actorLabel,
        action: "approval_routing_reprocess",
        entity_type: "expense",
        entity_id: doc.id,
        company_db: doc.company_db,
        details: entry,
      });

      if (!finalized) await notifyApprovalPending(admin, {
        expenseId: doc.id,
        companyDb: doc.company_db,
        approverEmail: state.current_approver_email,
        approverName: state.current_approver,
        levelOrder: state.current_level,
        requesterName: doc.requester_name,
        supplierName: doc.supplier_name,
        totalAmount: doc.total_amount,
        currency: doc.currency,
        docType,
        resolution: {
          source: "manual_reassign",
          reason: `Reprocessamento de roteamento: regra "${matched.name}" aplicada ao CC ${usedCc || "—"}${fallbackInfo ? " (fallback hierárquico do ramo)" : ""}`,
          ruleId: matched.id,
          ruleName: matched.name,
          costCenter: usedCc || null,
          project: (doc as any).project || null,
          metadata: { from_approver: doc.current_approver, hierarchical_fallback: fallbackInfo },
        },
      });

      if (finalized) {
        await dispatchApprovedExpense(doc.id, !!doc.sap_doc_entry);
      }

      reassigned += 1;
      results.push(entry);
    }

    return json(200, { ok: true, scanned: docs.length, reassigned, dry_run: dryRun, results });
  } catch (e) {
    console.error("[expense-reassign-approver]", e);
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
