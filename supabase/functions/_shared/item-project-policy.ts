// Regras de uso de itens e projetos em pedidos de compra (validadas no servidor).
//
// 1) Itens com código "IMP%" só podem ser usados por quem é do centro de custo
//    FISCAL/TRIBUTÁRIO — 1.2.2.4. CC desconhecido também bloqueia.
// 2) Usuários da BU Lotus (e-mail @lotusblanca.net) só podem usar os projetos
//    da Lotus: VERA, CASSINO e 7K.
// Administradores / super-usuários ficam fora das duas regras.
// Espelho no navegador: src/lib/item-project-policy.ts (mantenha em sincronia).
// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export const TAX_ITEM_PREFIX = "IMP";
export const TAX_COST_CENTER = "1.2.2.4";
export const LOTUS_EMAIL_DOMAINS = ["lotusblanca.net"];
export const LOTUS_PROJECTS = ["VERA", "CASSINO", "7K"];

const norm = (v: unknown) => String(v ?? "").trim();

export function isTaxItem(code: unknown): boolean {
  return norm(code).toUpperCase().startsWith(TAX_ITEM_PREFIX);
}

export function isTaxCostCenter(cc: unknown): boolean {
  const c = norm(cc);
  return c === TAX_COST_CENTER || c.startsWith(`${TAX_COST_CENTER}.`);
}

export function isLotusUser(email: unknown): boolean {
  const e = norm(email).toLowerCase();
  const domain = e.includes("@") ? e.split("@").pop() || "" : "";
  return LOTUS_EMAIL_DOMAINS.includes(domain);
}

export function isLotusProject(project: unknown): boolean {
  return LOTUS_PROJECTS.includes(norm(project).toUpperCase());
}

/** Centro de custo do usuário (mapeamento IdP), por e-mail ou código SAP. */
export async function resolveUserCostCenter(
  admin: SupabaseClient,
  keys: Array<string | null | undefined>,
): Promise<string | null> {
  const vals = Array.from(new Set(
    keys.map((k) => norm(k).toLowerCase()).filter(Boolean)
      .flatMap((k) => (k.includes("@") ? [k, k.split("@")[0]] : [k])),
  ));
  if (!vals.length) return null;
  const list = vals.map((v) => `"${v.replace(/"/g, "")}"`).join(",");
  const { data, error } = await admin
    .from("idp_user_mapping")
    .select("cost_center_code, attributes_synced_at")
    .not("cost_center_code", "is", null)
    .or(`sap_email.in.(${list}),idp_email.in.(${list}),sap_user_code.in.(${list})`)
    .order("attributes_synced_at", { ascending: false, nullsFirst: false })
    .limit(1);
  if (error) throw new Error(`Falha ao verificar o centro de custo do usuário: ${error.message}`);
  const cc = norm(data?.[0]?.cost_center_code);
  return cc || null;
}

export interface PolicyItem { item_code?: unknown; project?: unknown }

/** Retorna a mensagem de bloqueio, ou null quando o pedido é permitido. */
export async function checkItemProjectPolicy(
  admin: SupabaseClient,
  opts: {
    privileged: boolean;
    email: string | null | undefined;
    identity: string | null | undefined;
    items: PolicyItem[];
    headerProject?: unknown;
  },
): Promise<string | null> {
  if (opts.privileged) return null;
  const email = norm(opts.email) || (norm(opts.identity).includes("@") ? norm(opts.identity) : "");

  if (isLotusUser(email)) {
    const projects = [opts.headerProject, ...opts.items.map((i) => i.project)]
      .map(norm).filter(Boolean);
    const bad = Array.from(new Set(projects.filter((p) => !isLotusProject(p))));
    if (bad.length) {
      return `Usuários da BU Lotus só podem usar os projetos ${LOTUS_PROJECTS.join(" e ")}. Projeto não permitido: ${bad.join(", ")}.`;
    }
  }

  const taxItems = Array.from(new Set(opts.items.filter((i) => isTaxItem(i.item_code)).map((i) => norm(i.item_code))));
  if (taxItems.length) {
    const cc = await resolveUserCostCenter(admin, [email, opts.identity]);
    if (!isTaxCostCenter(cc)) {
      return `Itens de imposto (IMP) só podem ser usados pelo centro de custo FISCAL/TRIBUTÁRIO — ${TAX_COST_CENTER}. Itens: ${taxItems.join(", ")}.`;
    }
  }
  return null;
}
