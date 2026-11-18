// Never send the PagCorp bearer outside its configured API origin/path, including redirects.
export function pagcorpReceiptUrl(raw: string, base: string): string {
  const trusted = new URL(base);
  const target = new URL(raw, trusted);
  const prefix = trusted.pathname.endsWith("/") ? trusted.pathname : `${trusted.pathname}/`;
  if (trusted.protocol !== "https:" || target.protocol !== "https:" ||
      target.origin !== trusted.origin || target.username || target.password || target.hash ||
      !target.pathname.startsWith(prefix)) {
    throw new Error("Destino do recibo não autorizado");
  }
  return target.href;
}