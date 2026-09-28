import { AuthError } from "./auth.ts";

// A chave única no banco arbitra instâncias distintas. Nunca expirar uma reserva
// e repetir POST automaticamente: o SAP pode ter gravado sem devolver resposta.
export async function createNfDraftOnce(
  db: any, importId: string,
  create: () => Promise<string>, reconcile: () => Promise<string | null>,
): Promise<string> {
  const token = crypto.randomUUID();
  const { error } = await db.from("nf_po_draft_jobs").insert({ import_id: importId, state: "processing", token });
  let reconcileOnly = false;
  if (error) {
    if (error.code === "23514") throw new AuthError("NF não está mais elegível para integração", 409);
    if (error.code !== "23505") throw new Error("Não foi possível reservar a integração da NF");
    const { data: job, error: readError } = await db.from("nf_po_draft_jobs").select("*").eq("import_id", importId).single();
    if (readError || !job) throw new Error("Não foi possível consultar a reserva da NF");
    if (job.state === "completed" && job.draft_id) return job.draft_id;
    if (job.state !== "uncertain") throw new AuthError("NF em processamento; não repita a criação. Se o processo foi interrompido, solicite reconciliação.", 409);
    const { data: claimed, error: claimError } = await db.from("nf_po_draft_jobs")
      .update({ state: "processing", token, updated_at: new Date().toISOString() })
      .eq("import_id", importId).eq("state", "uncertain").select("import_id").maybeSingle();
    if (claimError || !claimed) throw new AuthError("NF já está em reconciliação", 409);
    reconcileOnly = true;
  }
  try {
    const found = await reconcile();
    if (!found && reconcileOnly) throw new AuthError("Resultado anterior ainda incerto; não será criado outro Draft. Reconciliação necessária.", 409);
    const draftId = found || await create();
    if (!draftId || !/^\d+$/.test(draftId)) throw new Error("SAP não confirmou um DocEntry válido");
    const { data, error: finishError } = await db.from("nf_po_draft_jobs")
      .update({ state: "completed", draft_id: draftId, updated_at: new Date().toISOString() })
      .eq("import_id", importId).eq("token", token).select("import_id").maybeSingle();
    if (finishError || !data) throw new Error("Draft criado, mas confirmação local falhou; reconciliação necessária");
    return draftId;
  } catch (error) {
    // Se até esta escrita falhar, permanece processing: recuperação assistida,
    // nunca um segundo POST por timeout de lock.
    await db.from("nf_po_draft_jobs").update({ state: "uncertain", updated_at: new Date().toISOString() })
      .eq("import_id", importId).eq("token", token);
    throw error;
  }
}

export function assertNfDraftEligible(row: { status: string; sap_po_draft_id: string | null }): void {
  if (["cancelled", "erpflow_rejected", "sap_rejected", "completed"].includes(row.status)) {
    throw new AuthError("Estado da NF não permite criar ou reprocessar Draft", 409);
  }
  if (!row.sap_po_draft_id && !["pending_expense", "integration_error"].includes(row.status)) {
    throw new AuthError("NF não está elegível para integração", 409);
  }
}
