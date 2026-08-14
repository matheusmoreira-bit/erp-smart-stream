// Helper compartilhado: identificação do Pedido de Compra (PC) correspondente a
// uma NF capturada pelo MasterTax.
//
// Motivo: a rotina antiga só olhava PCs com DocumentStatus = 'bost_Open'. Quando
// o PC já havia sido lançado/encerrado no SAP (status "Fechado"), a NF ficava
// eternamente como "Sem pedido vinculado". Aqui ampliamos a busca:
//   1. PCs abertos do fornecedor
//   2. PCs fechados/qualquer status (não cancelados) dentro de uma janela de datas
//   3. Esboços (Drafts oPurchaseOrders)
// E classificamos o candidato por confiança: só vinculamos automaticamente PC
// fechado quando o valor bate exatamente (ou o código da despesa aparece nas
// observações do PC).

export const escapeOData = (s: string) => (s || "").replace(/'/g, "''");

const digitsOf = (v?: string | null) => (v || "").replace(/\D/g, "");

function maskCnpj(d: string): string {
  if (d.length !== 14) return d;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

async function getJson(url: string, cookie: string): Promise<any | null> {
  try {
    const r = await fetch(url, { headers: { Cookie: cookie } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/** Localiza o CardCode do fornecedor por CNPJ (com e sem máscara, raiz) e por nome. */
export async function findSupplierCardCode(
  baseUrl: string,
  cookie: string,
  cnpj: string,
  nome: string,
): Promise<string | null> {
  const d = digitsOf(cnpj);
  const tries: string[] = [];
  if (d) {
    tries.push(`FederalTaxID eq '${d}'`);
    if (d.length === 14) {
      tries.push(`FederalTaxID eq '${maskCnpj(d)}'`);
      // Cobre cadastros com máscara parcial/espaços.
      tries.push(`contains(FederalTaxID,'${d.slice(0, 8)}')`);
      // Raiz do CNPJ cobre filiais cadastradas com sufixo diferente.
      tries.push(`startswith(FederalTaxID,'${d.slice(0, 8)}')`);
    }
  }
  for (const f of tries) {
    // Sem filtro de CardType: fornecedores cadastrados como 'cLid'/'cCustomer'
    // também emitem NF contra a empresa e antes ficavam sem vínculo.
    const j = await getJson(
      `${baseUrl}/BusinessPartners?$filter=${f}&$select=CardCode,CardType&$top=5`,
      cookie,
    );
    const list = (j?.value || []) as Array<{ CardCode?: string; CardType?: string }>;
    const pick = list.find((b) => b.CardType === "cSupplier") || list[0];
    if (pick?.CardCode) return String(pick.CardCode);
  }

  // Fallback por nome: exige razão social completa ou os dois primeiros termos
  // significativos — um único termo genérico ("FOTOGRAFIAS") gerava vínculo errado.
  const cleanName = (nome || "").trim();
  const tokens = cleanName
    .replace(/[.,/\\-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !/^(ltda|s\/?a|me|epp|eireli|associados)$/i.test(t));
  const probes: string[] = [];
  if (cleanName.length >= 6) probes.push(cleanName);
  if (tokens.length >= 2) probes.push(tokens.slice(0, 2).join(" "));
  for (const probe of probes) {
    const j = await getJson(
      `${baseUrl}/BusinessPartners?$filter=contains(CardName,'${escapeOData(probe)}')&$select=CardCode,CardType&$top=5`,
      cookie,
    );
    const list = (j?.value || []) as Array<{ CardCode?: string; CardType?: string }>;
    const pick = list.find((b) => b.CardType === "cSupplier") || list[0];
    if (pick?.CardCode) return String(pick.CardCode);
  }
  return null;
}

export interface PoCandidate {
  docEntry: string;
  docNum?: number | null;
  docTotal: number;
  docDate?: string | null;
  status?: string | null;
  comments?: string | null;
  cardCode?: string | null;
  isDraft: boolean;
}

export interface PoMatch extends PoCandidate {
  confidence: "alta" | "media" | "baixa";
  reason: string;
}


const SELECT = "DocEntry,DocNum,DocTotal,DocDate,DocumentStatus,Comments,Cancelled";

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Candidatos vindos do cache local de PCs do SAP (`sap_purchase_order_cache`).
 * Serve como rede de segurança: mesmo que a consulta ao Service Layer falhe,
 * fique fora da janela de datas ou o CardCode não seja resolvido pelo CNPJ,
 * ainda encontramos o PC já existente e evitamos lançamento duplicado.
 */
export async function poCandidatesFromCache(
  supabase: any,
  companyDb: string,
  opts: { cardCode?: string | null; nome?: string | null },
): Promise<PoCandidate[]> {
  if (!supabase || !companyDb) return [];
  const out: PoCandidate[] = [];
  const push = (rows: any[]) => {
    for (const r of rows || []) {
      if (r?.cancelled === "tYES") continue;
      out.push({
        docEntry: String(r.doc_entry),
        docNum: r.doc_num ?? null,
        docTotal: Number(r.doc_total ?? 0),
        docDate: r.doc_date ?? null,
        status: r.document_status ?? null,
        comments: r.raw_json?.Comments ?? null,
        cardCode: r.card_code ?? null,
        isDraft: false,
      });
    }
  };
  try {
    if (opts.cardCode) {
      const { data } = await supabase
        .from("sap_purchase_order_cache")
        .select("doc_entry,doc_num,doc_total,doc_date,document_status,cancelled,card_code,raw_json")
        .eq("company_db", companyDb)
        .eq("card_code", opts.cardCode)
        .order("doc_date", { ascending: false })
        .limit(100);
      push(data);
    }
    const tokens = (opts.nome || "")
      .replace(/[.,/\\-]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 4 && !/^(ltda|s\/?a|me|epp|eireli|associados)$/i.test(t));
    const probe = tokens.slice(0, 2).join(" ");
    if (probe.length >= 4) {
      const { data } = await supabase
        .from("sap_purchase_order_cache")
        .select("doc_entry,doc_num,doc_total,doc_date,document_status,cancelled,card_code,raw_json")
        .eq("company_db", companyDb)
        .ilike("card_name", `%${probe}%`)
        .order("doc_date", { ascending: false })
        .limit(100);
      push(data);
    }
  } catch {
    // cache é best-effort
  }
  return out;
}

/** Resolve CardCode a partir do cache local (quando o Service Layer não resolve). */
export async function cardCodeFromCache(
  supabase: any,
  companyDb: string,
  nome: string,
): Promise<string | null> {
  const cands = await poCandidatesFromCacheRaw(supabase, companyDb, nome);
  return cands ?? null;
}

async function poCandidatesFromCacheRaw(supabase: any, companyDb: string, nome: string): Promise<string | null> {
  const tokens = (nome || "")
    .replace(/[.,/\\-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !/^(ltda|s\/?a|me|epp|eireli|associados)$/i.test(t));
  const probe = tokens.slice(0, 2).join(" ");
  if (probe.length < 4) return null;
  try {
    const { data } = await supabase
      .from("sap_purchase_order_cache")
      .select("card_code")
      .eq("company_db", companyDb)
      .ilike("card_name", `%${probe}%`)
      .not("card_code", "is", null)
      .limit(1);
    return data?.[0]?.card_code ?? null;
  } catch {
    return null;
  }
}

/**
 * Busca o PC correspondente à NF. `windowDays` limita a janela ao redor da
 * emissão da nota quando incluímos PCs já fechados.
 */
export async function findPoForNf(
  baseUrl: string,
  cookie: string,
  opts: {
    cardCode: string;
    valor: number;
    dataEmissao?: string | null;
    expenseCode?: string | null;
    nfNumero?: string | null;
    chaveAcesso?: string | null;
    extraCandidates?: PoCandidate[];
    windowDays?: number;
    allowLooseFallback?: boolean;
  },
): Promise<PoMatch | null> {

  const { cardCode, valor } = opts;
  const windowDays = opts.windowDays ?? 120;
  const cc = escapeOData(cardCode);

  const candidates: PoCandidate[] = [];

  const pushDocs = (arr: any[], isDraft: boolean) => {
    for (const r of arr || []) {
      if (r?.Cancelled === "tYES") continue;
      candidates.push({
        docEntry: String(r.DocEntry),
        docNum: r.DocNum ?? null,
        docTotal: Number(r.DocTotal ?? 0),
        docDate: r.DocDate ?? null,
        status: r.DocumentStatus ?? null,
        comments: r.Comments ?? null,
        isDraft,
      });
    }
  };

  // 1) PCs abertos (qualquer data)
  const open = await getJson(
    `${baseUrl}/PurchaseOrders?$filter=CardCode eq '${cc}' and DocumentStatus eq 'bost_Open'&$select=${SELECT}&$orderby=DocEntry desc&$top=50`,
    cookie,
  );
  pushDocs(open?.value, false);

  // 2) Qualquer status (inclui fechados) na janela de datas da emissão
  if (opts.dataEmissao) {
    const from = shiftDate(opts.dataEmissao, -windowDays);
    const to = shiftDate(opts.dataEmissao, windowDays);
    const any = await getJson(
      `${baseUrl}/PurchaseOrders?$filter=CardCode eq '${cc}' and DocDate ge '${from}' and DocDate le '${to}'&$select=${SELECT}&$orderby=DocEntry desc&$top=50`,
      cookie,
    );
    pushDocs(any?.value, false);
  }

  // 3) Esboços
  const drafts = await getJson(
    `${baseUrl}/Drafts?$filter=DocObjectCode eq 'oPurchaseOrders' and CardCode eq '${cc}'&$select=${SELECT}&$orderby=DocEntry desc&$top=50`,
    cookie,
  );
  pushDocs(drafts?.value, true);

  // 4) Candidatos vindos do cache local (rede de segurança contra duplicidade)
  for (const c of opts.extraCandidates || []) candidates.push(c);

  if (!candidates.length) return null;

  // Dedup por (isDraft, docEntry)
  const seen = new Set<string>();
  const uniq = candidates.filter((c) => {
    const k = `${c.isDraft ? "D" : "P"}${c.docEntry}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const code = (opts.expenseCode || "").trim().toUpperCase();

  // 3.1) Código da despesa nas observações do PC → vínculo mais forte possível
  if (code.length >= 6) {
    const byCode = uniq.find((c) => (c.comments || "").toUpperCase().includes(code));
    if (byCode) {
      return { ...byCode, confidence: "alta", reason: `código da despesa (${code}) nas observações do PC` };
    }
  }

  // 3.1b) Chave de acesso ou nº da NF nas observações do PC
  const chave = digitsOf(opts.chaveAcesso);
  if (chave.length >= 20) {
    const byChave = uniq.find((c) => digitsOf(c.comments).includes(chave));
    if (byChave) {
      return { ...byChave, confidence: "alta", reason: "chave de acesso da NF nas observações do PC" };
    }
  }
  const nfNum = digitsOf(opts.nfNumero).replace(/^0+/, "");
  if (nfNum.length >= 3) {
    const byNf = uniq.find((c) => new RegExp(`(^|\\D)0*${nfNum}(\\D|$)`).test(c.comments || ""));
    if (byNf) {
      return { ...byNf, confidence: "alta", reason: `nº da NF (${nfNum}) nas observações do PC` };
    }
  }


  // 3.2) Valor exato
  const exact = uniq.filter((c) => Math.abs(c.docTotal - valor) < 0.01);
  if (exact.length) {
    const pick = exact.find((c) => c.status === "bost_Open") || exact[0];
    return {
      ...pick,
      confidence: "alta",
      reason: `valor exato (${pick.docTotal.toFixed(2)})${pick.status === "bost_Close" ? " — PC já fechado no SAP" : ""}`,
    };
  }

  // 3.3) Tolerância de 1% (arredondamentos/frete)
  const near = uniq
    .map((c) => ({ c, diff: Math.abs(c.docTotal - valor) }))
    .filter(({ c, diff }) => c.docTotal > 0 && diff / c.docTotal <= 0.01)
    .sort((a, b) => a.diff - b.diff);
  if (near.length) {
    const pick = near[0].c;
    return { ...pick, confidence: "media", reason: `valor aproximado (PC ${pick.docTotal.toFixed(2)} × NF ${valor.toFixed(2)})` };
  }

  // 3.4) Fallback: PC aberto mais recente do fornecedor (cardinalidade 1 PC : N NF)
  if (opts.allowLooseFallback) {
    const openPick = uniq.find((c) => !c.isDraft && c.status === "bost_Open") || uniq[0];
    return { ...openPick, confidence: "baixa", reason: "fornecedor compatível, PC mais recente (valores divergentes)" };
  }

  return null;
}
