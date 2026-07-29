// Validação da política de senha do SAP B1 (OUSR.PASSWORD) no cliente.
// Regras baseadas na configuração padrão de "Password Administration" das bases:
// - Mínimo 12 caracteres (endurecido após pentest 2026-07)
// - Ao menos 1 letra maiúscula
// - Ao menos 1 letra minúscula
// - Ao menos 1 dígito
// - Ao menos 1 caractere especial
// - Não pode conter o UserCode (case-insensitive)
// - Não pode ser igual a padrões triviais conhecidos
//
// Estas regras cobrem o erro "Password does not comply with the password policy
// [OUSR.PASSWORD]" antes de disparar o request, evitando lockout e chamadas em
// vão. Se uma base tiver política mais estrita, o SAP ainda pode recusar — a
// validação server-side segue autoritativa.

export interface PasswordRule {
  id: string;
  label: string;
  test: (password: string, userCode?: string) => boolean;
}

const TRIVIAL = new Set([
  "sap@2025", "sap@2024", "sap@2023",
  "password", "senha123", "12345678", "manager", "administrator",
]);

export const PASSWORD_RULES: PasswordRule[] = [
  { id: "length", label: "Mínimo de 12 caracteres", test: (p) => p.length >= 12 },
  { id: "upper", label: "Ao menos 1 letra maiúscula (A-Z)", test: (p) => /[A-Z]/.test(p) },
  { id: "lower", label: "Ao menos 1 letra minúscula (a-z)", test: (p) => /[a-z]/.test(p) },
  { id: "digit", label: "Ao menos 1 número (0-9)", test: (p) => /\d/.test(p) },
  { id: "special", label: "Ao menos 1 caractere especial (!@#$…)", test: (p) => /[^A-Za-z0-9]/.test(p) },
  {
    id: "no-usercode",
    label: "Não pode conter o código de usuário",
    test: (p, userCode) => {
      const u = (userCode || "").trim().toLowerCase();
      if (!u || u.length < 3) return true;
      return !p.toLowerCase().includes(u);
    },
  },
  {
    id: "not-trivial",
    label: "Não pode ser uma senha trivial/padrão",
    test: (p) => !TRIVIAL.has(p.trim().toLowerCase()),
  },
];

export interface PasswordCheck {
  valid: boolean;
  failed: PasswordRule[];
  results: Array<{ rule: PasswordRule; ok: boolean }>;
}

export function checkPasswordPolicy(password: string, userCode?: string): PasswordCheck {
  const results = PASSWORD_RULES.map((rule) => ({ rule, ok: rule.test(password, userCode) }));
  const failed = results.filter((r) => !r.ok).map((r) => r.rule);
  return { valid: failed.length === 0, failed, results };
}

export function firstPasswordError(password: string, userCode?: string): string | null {
  const { failed } = checkPasswordPolicy(password, userCode);
  return failed.length ? failed[0].label : null;
}
