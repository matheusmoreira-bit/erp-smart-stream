/**
 * Conteúdo canônico usado para reconhecer a MESMA tentativa de criação de
 * pedido (duplo clique, replay, reenvio automático). Inclui os anexos (hash do
 * conteúdo), a linha do boleto e a observação: dois pedidos com fornecedor,
 * datas, itens e valor iguais, mas com NFs diferentes, são pedidos distintos.
 */
const norm = (v: unknown): string => String(v ?? "").trim().toLowerCase();
const digits = (v: unknown): string => String(v ?? "").replace(/\D/g, "");

export function sanitizeAttachmentHashes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const h of raw.slice(0, 50)) {
    const s = String(h ?? "").trim().toLowerCase();
    if (/^[0-9a-f]{64}$/.test(s)) out.add(s);
  }
  return [...out].sort();
}

export function buildCreateFingerprintPayload(
  callerIdentity: unknown,
  callerCompanyDb: unknown,
  input: Record<string, unknown> | null | undefined,
): string {
  const i = (input ?? {}) as Record<string, any>;
  const items = Array.isArray(i.items) ? i.items : [];
  return JSON.stringify({
    who: norm(callerIdentity),
    db: norm(i.company_db || callerCompanyDb),
    supplier: norm(i.supplier_code || i.supplier_name),
    doc: norm(i.doc_date),
    due: norm(i.due_date),
    total: items.reduce((s: number, it: any) => s + Number(it?.line_total || 0), 0),
    items: items.map((it: any) => [it?.item_code, it?.quantity, it?.unit_price, it?.cost_center, it?.project]),
    files: sanitizeAttachmentHashes(i.attachment_hashes),
    boleto: digits(i.payment_boleto_digitable_line) || digits(i.payment_boleto_barcode),
    remarks: norm(i.remarks),
  });
}
