/**
 * Guarda o destino original quando o usuário cai na tela de login sem sessão
 * (ex.: abriu um link direto de documento vindo de e-mail/WhatsApp) e o
 * restaura após o login, preservando a query string (`?doc=...`).
 */
const KEY = "erpflow:post_login_path";

/** Salva a rota atual (path + query) para retomar após o login. */
export function savePostLoginPath(path?: string) {
  try {
    const target = path ?? window.location.pathname + window.location.search;
    if (!target || target === "/" || target.startsWith("/?")) return;
    sessionStorage.setItem(KEY, target);
  } catch {
    /* storage indisponível — segue sem deep link */
  }
}

/** Lê e limpa a rota salva. Retorna null quando não há destino pendente. */
export function consumePostLoginPath(): string | null {
  try {
    const value = sessionStorage.getItem(KEY);
    if (value) sessionStorage.removeItem(KEY);
    return value && value.startsWith("/") ? value : null;
  } catch {
    return null;
  }
}
