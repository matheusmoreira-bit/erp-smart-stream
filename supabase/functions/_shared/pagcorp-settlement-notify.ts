// Notificação de NF de entrada pronta para baixa manual (cartão PagCorp).
//
// A baixa automática foi desativada (ago/2026): quando o watcher identifica
// que a NF de entrada de um pedido de compra do cartão foi lançada no ERP,
// avisamos a responsável pela baixa em vez de emitir o pagamento.

const WHATSAPP_URL = Deno.env.get("WHATSAPP_URL") || "http://63.177.171.140/sender_wpp";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || Deno.env.get("WHATSAPP_API_TOKEN") || "";

/** Responsável pela baixa manual dos cartões corporativos. */
export const PAGCORP_SETTLEMENT_OWNER = {
  identifier: "blenda.pinheiro.ext",
  phone: "5531996749771",
};

export async function sendWhatsApp(to: string, message: string) {
  if (!WHATSAPP_TOKEN) {
    console.warn("[pagcorp-settlement-notify] WHATSAPP_TOKEN não configurado; notificação ignorada.");
    return { ok: false, status: 0, error: "WHATSAPP_TOKEN ausente" };
  }
  try {
    const body = new URLSearchParams({ to, message });
    const resp = await fetch(WHATSAPP_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    return { ok: resp.ok, status: resp.status };
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message };
  }
}

interface NotifyArgs {
  companyDb: string;
  poDocNum: number | string | null;
  invoiceDocNum: number | string | null;
  vendorName?: string | null;
  amount?: number | null;
  currency?: string | null;
}

function fmt(v: number | null | undefined, currency?: string | null) {
  const n = Number(v || 0);
  const cur = (currency || "BRL").trim().toUpperCase();
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: cur }).format(n);
  } catch {
    return `${cur} ${n.toFixed(2)}`;
  }
}

/**
 * Avisa a responsável (WhatsApp + notificação in-app) que existe uma nova NF
 * de cartão aguardando baixa manual. Nunca lança — notificação não pode
 * quebrar o watcher.
 */
export async function notifyPagcorpSettlementPending(
  sb: { from: (t: string) => any },
  args: NotifyArgs,
): Promise<boolean> {
  const valor = args.amount != null ? ` no valor de ${fmt(args.amount, args.currency)}` : "";
  const msg =
    `*ERP Flow — Baixa de cartão pendente*\n` +
    `Empresa: ${args.companyDb}\n` +
    `Pedido de compra: ${args.poDocNum ?? "-"}\n` +
    `NF de entrada (Contas a Pagar): ${args.invoiceDocNum ?? "-"}\n` +
    (args.vendorName ? `Fornecedor: ${args.vendorName}\n` : "") +
    `Nova nota${valor} aguardando baixa manual em Cartões → Baixas PagCorp.`;

  const wpp = await sendWhatsApp(PAGCORP_SETTLEMENT_OWNER.phone, msg);

  try {
    await sb.from("notifications").insert({
      user_identifier: PAGCORP_SETTLEMENT_OWNER.identifier,
      title: "Nova NF de cartão aguardando baixa",
      body: `PC ${args.poDocNum ?? "-"} · NF ${args.invoiceDocNum ?? "-"}${valor} (${args.companyDb})`,
      category: "integration",
      company_db: args.companyDb,
      link: "/cartoes/baixas",
      metadata: {
        po_doc_num: args.poDocNum,
        invoice_doc_num: args.invoiceDocNum,
        amount: args.amount ?? null,
        currency: args.currency ?? null,
      },
    });
  } catch { /* silencioso */ }

  return wpp.ok;
}
