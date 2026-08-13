/**
 * Classificação de erros de autenticação no ERP (SAP B1 Service Layer e afins).
 *
 * Objetivo: transformar a mensagem crua do ERP em uma orientação acionável,
 * evitando que o usuário fique tentando "às cegas" e acabe bloqueando a conta
 * (a política padrão do SAP B1 bloqueia após 3 tentativas incorretas).
 */

export type ErpLoginErrorKind =
  | "invalid_credentials"
  | "locked"
  | "password_expired"
  | "no_license"
  | "company_unavailable"
  | "network"
  | "unknown";

export interface ErpLoginErrorInfo {
  kind: ErpLoginErrorKind;
  title: string;
  description: string;
  /** true quando novas tentativas com os mesmos dados não vão resolver. */
  blocking: boolean;
  /** Campo que o usuário deve corrigir, quando aplicável. */
  field?: "userName" | "password" | "companyDB";
}

export function classifyErpLoginError(raw: unknown): ErpLoginErrorInfo {
  const message = raw instanceof Error ? raw.message : String(raw ?? "");
  const lower = message.toLowerCase();

  const has = (...needles: string[]) => needles.some((n) => lower.includes(n));

  if (has("locked", "bloquead", "-131", "user is locked", "account is locked")) {
    return {
      kind: "locked",
      title: "Usuário bloqueado no ERP",
      description:
        "A conta foi bloqueada por tentativas incorretas. Novas tentativas não vão funcionar — peça ao administrador do ERP para desbloquear e redefinir sua senha.",
      blocking: true,
    };
  }

  if (has("password has expired", "senha expirada", "password expired", "-2028")) {
    return {
      kind: "password_expired",
      title: "Senha do ERP expirada",
      description:
        "Sua senha do ERP venceu. Atualize a senha diretamente no SAP (ou peça a redefinição ao administrador) antes de tentar de novo.",
      blocking: true,
      field: "password",
    };
  }

  if (has("no license", "license", "-111", "sem licen")) {
    return {
      kind: "no_license",
      title: "Sem licença disponível no ERP",
      description:
        "O ERP recusou o acesso por falta de licença para o seu usuário. Contate o administrador — repetir o login não libera a licença.",
      blocking: true,
    };
  }

  if (
    has(
      "user name or password",
      "invalid username or password",
      "invalid credentials",
      "senha incorreta",
      "usuário ou senha",
      "usuario ou senha",
      "-304",
      " 401",
    )
  ) {
    return {
      kind: "invalid_credentials",
      title: "Usuário ou senha incorretos",
      description:
        "Confira o usuário do ERP (normalmente sem o domínio do e-mail) e digite a senha novamente com atenção ao Caps Lock.",
      blocking: false,
      field: "password",
    };
  }

  if (has("company", "database", "-1116", "empresa não", "companydb")) {
    return {
      kind: "company_unavailable",
      title: "Empresa indisponível no ERP",
      description:
        "O ERP não aceitou a base da empresa selecionada. Selecione outra empresa ou contate o administrador.",
      blocking: true,
      field: "companyDB",
    };
  }

  if (has("failed to fetch", "networkerror", "timeout", "econn", "getaddrinfo", "503", "502")) {
    return {
      kind: "network",
      title: "Não foi possível conectar ao ERP",
      description:
        "O servidor do ERP não respondeu. Verifique sua conexão e tente novamente em alguns instantes — suas credenciais não foram testadas.",
      blocking: false,
    };
  }

  return {
    kind: "unknown",
    title: "Não foi possível entrar",
    description: message || "Tente novamente em instantes.",
    blocking: false,
  };
}

/** Aviso progressivo antes do bloqueio automático do SAP (3 tentativas). */
export function attemptWarning(attempts: number): string | null {
  if (attempts >= 2) {
    return "Atenção: mais uma tentativa incorreta irá bloquear seu usuário no ERP. Se não lembrar a senha, peça a redefinição ao administrador.";
  }
  if (attempts === 1) {
    return "Restam 2 tentativas antes do bloqueio automático do usuário no ERP.";
  }
  return null;
}
