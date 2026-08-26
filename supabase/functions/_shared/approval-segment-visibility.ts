export interface ApprovalSegmentVisibilityRow {
  id?: string | null;
  segment_key?: string | null;
  cost_center?: string | null;
  project?: string | null;
  amount?: number | string | null;
  rule_id?: string | null;
  status?: string | null;
  current_approver?: string | null;
  current_approver_email?: string | null;
  [key: string]: unknown;
}

export interface ScopedApprovalDocument extends Record<string, any> {
  items?: Array<Record<string, any>>;
  total_amount?: number | string | null;
}

export function approvalSegmentBelongsToAliases(
  segment: ApprovalSegmentVisibilityRow,
  aliases: Iterable<string>,
  matches: (candidate: unknown, alias: string) => boolean,
): boolean {
  const chain = Array.isArray(segment.chain) ? segment.chain : [];
  const candidates = [
    segment.current_approver,
    segment.current_approver_email,
    ...chain.flatMap((entry) => {
      const row = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
      return [row.approver_name, row.approver_email];
    }),
  ].filter(Boolean);
  const aliasList = Array.from(aliases);
  return candidates.some((candidate) => aliasList.some((alias) => matches(candidate, alias)));
}

function normalizedSegmentKey(costCenter: unknown, project: unknown): string {
  return `${String(costCenter ?? "").trim().toLowerCase()}||${String(project ?? "").trim().toLowerCase()}`;
}

function uniquePeople(
  segments: ApprovalSegmentVisibilityRow[],
): Array<{ name: string; email: string }> {
  const people = new Map<string, { name: string; email: string }>();
  for (const segment of segments) {
    if (segment.status && segment.status !== "pendente") continue;
    const name = String(segment.current_approver || "").trim();
    const email = String(segment.current_approver_email || "").trim();
    const key = (email || name).toLowerCase();
    if (key) people.set(key, { name, email });
  }
  return Array.from(people.values());
}

/**
 * Recorta um documento rateado para as ramificacoes em que o caller participa.
 * O payload restrito nunca carrega valores, regras, projetos ou cadeias de
 * outras ramificacoes; o cliente recebe apenas quantidades para renderizar os
 * respectivos placeholders.
 */
export function scopeApprovalDocumentToSegments(
  document: ScopedApprovalDocument,
  segments: ApprovalSegmentVisibilityRow[],
  ownsSegment: (segment: ApprovalSegmentVisibilityRow) => boolean,
): ScopedApprovalDocument {
  const allSegments = Array.isArray(segments) ? segments : [];
  const ownSegments = allSegments.filter(ownsSegment);
  const base = { ...document };

  if (allSegments.length < 2 || ownSegments.length === 0 || ownSegments.length === allSegments.length) {
    return { ...base, approval_segments: allSegments };
  }

  // A trilha de reembolso avalia o documento inteiro, nao um subconjunto de
  // linhas. Quem participa dela precisa enxergar o documento completo.
  if (ownSegments.some((segment) => segment.segment_key === "__reembolso__")) {
    return { ...base, approval_segments: allSegments };
  }

  const ownKeys = new Set(
    ownSegments.map((segment) => String(segment.segment_key || "").toLowerCase()).filter(Boolean),
  );
  const allItems = Array.isArray(document.items) ? document.items : [];
  const ownItems = allItems.filter((item) =>
    ownKeys.has(normalizedSegmentKey(item.cost_center, item.project))
  );
  const scopedTotal = ownSegments.reduce((sum, segment) => sum + Number(segment.amount || 0), 0);
  const ownCurrentApprovers = uniquePeople(ownSegments);
  const ownCostCenters = Array.from(new Set(
    ownSegments.map((segment) => String(segment.cost_center || "").trim()).filter(Boolean),
  ));
  const ownProjects = Array.from(new Set(
    ownSegments.map((segment) => String(segment.project || "").trim()).filter(Boolean),
  ));

  return {
    ...base,
    items: ownItems,
    total_amount: scopedTotal,
    cost_center: ownCostCenters.length === 1 ? ownCostCenters[0] : null,
    project: ownProjects.length === 1 ? ownProjects[0] : null,
    current_approver: ownCurrentApprovers.map((person) => person.name || person.email).join(" / ") || base.current_approver,
    original_approver: null,
    level_approvers: ownCurrentApprovers,
    approval_rule_id: new Set(ownSegments.map((segment) => segment.rule_id).filter(Boolean)).size === 1
      ? ownSegments.find((segment) => segment.rule_id)?.rule_id || null
      : null,
    approval_segments: ownSegments,
    viewer_segment_keys: Array.from(ownKeys),
    viewer_segmented: true,
    restricted_segment_count: allSegments.length - ownSegments.length,
    restricted_item_count: Math.max(0, allItems.length - ownItems.length),
  };
}
