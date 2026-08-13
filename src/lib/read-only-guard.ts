/**
 * Modo somente leitura durante a impersonação.
 *
 * Regra de produto: ao "atuar como" outro usuário, o admin enxerga o sistema
 * exatamente como ele — mas NÃO pode executar ações em nome dele.
 *
 * A trava é aplicada em camada de transporte (não só na UI):
 *  - mutações no banco (insert/update/upsert/delete e storage) via patch no
 *    client do Cloud (`installReadOnlyGuards`);
 *  - gravações no ERP (`sapAction`, cache de aprovações) no `sap-client`;
 *  - Edge Functions: só as funções de leitura conhecidas são liberadas.
 */
import { toast } from "sonner";
import { isImpersonating } from "@/lib/impersonation";

export class ReadOnlyImpersonationError extends Error {
  constructor(action?: string) {
    super(
      action
        ? `Modo somente leitura: não é possível executar "${action}" enquanto você está atuando como outro usuário.`
        : "Modo somente leitura: ações não são permitidas enquanto você está atuando como outro usuário.",
    );
    this.name = "ReadOnlyImpersonationError";
  }
}

/** true quando a sessão atual é uma impersonação (somente leitura). */
export function isReadOnlyMode(): boolean {
  return isImpersonating();
}

let lastToastAt = 0;
function warnOnce(message: string) {
  const now = Date.now();
  if (now - lastToastAt < 2500) return;
  lastToastAt = now;
  try {
    toast.warning("Modo somente leitura", { description: message });
  } catch {
    /* ignore */
  }
}

/** Lança (e avisa) se a ação for uma escrita durante impersonação. */
export function assertWriteAllowed(action?: string): void {
  if (!isReadOnlyMode()) return;
  const err = new ReadOnlyImpersonationError(action);
  warnOnce(err.message);
  throw err;
}

/**
 * Edge Functions liberadas em modo somente leitura (consultas, diagnósticos e
 * a própria auditoria da impersonação). Qualquer função fora desta lista é
 * bloqueada — falhar fechado é preferível a executar uma escrita indevida.
 */
const READ_ONLY_FUNCTIONS = new Set<string>([
  "sap-b1-proxy", // granularidade tratada no sap-client
  "impersonation-audit",
  "security-csrf-token",
  "expense-read",
  "approvals-feed",
  "approval-rule-manage-read",
  "sap-approvals-hana",
  "sap-purchase-orders-hana",
  "sap-suppliers-hana",
  "sap-list-service",
  "sap-nfse-lookup",
  "sap-user-credentials",
  "sap-user-profile-sync",
  "nfse-xml-fetch",
  "nf-entrada-fetch-file",
  "pagcorp-integration-status",
  "pagcorp-status-api",
  "pagcorp-relations-resolver",
  "hana-health-probe",
  "cnpj-lookup",
  "supplier-ai-extract",
  "license-analysis",
  "cashflow-forecast",
  "audit-console-monthly",
  "expense-sap-reconcile",
  "report-ai-chat",
  "copilot-chat",
  "ai-assistant",
  "credentials",
  "admin-users",
]);

/** Bloqueia Edge Functions de escrita durante a impersonação. */
export function assertFunctionAllowed(name: string): void {
  if (!isReadOnlyMode()) return;
  const fn = (name || "").split("?")[0].replace(/^\/+/, "");
  if (READ_ONLY_FUNCTIONS.has(fn)) return;
  assertWriteAllowed(fn);
}

const MUTATING_METHODS = ["insert", "update", "upsert", "delete"] as const;

let installed = false;

/**
 * Instala os guards globais. Idempotente; chamar uma vez no bootstrap do app.
 */
export function installReadOnlyGuards(client: {
  from: (table: string) => unknown;
  storage: { from: (bucket: string) => unknown };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (...args: any[]) => any;
}): void {
  if (installed) return;
  installed = true;

  const originalFrom = client.from.bind(client);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).from = (table: string) => {
    const builder = originalFrom(table) as Record<string, unknown>;
    if (!isReadOnlyMode()) return builder;
    return new Proxy(builder, {
      get(target, prop, receiver) {
        if (typeof prop === "string" && (MUTATING_METHODS as readonly string[]).includes(prop)) {
          return () => {
            assertWriteAllowed(`${prop} em ${table}`);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  };

  const originalStorageFrom = client.storage.from.bind(client.storage);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client.storage as any).from = (bucket: string) => {
    const api = originalStorageFrom(bucket) as Record<string, unknown>;
    if (!isReadOnlyMode()) return api;
    return new Proxy(api, {
      get(target, prop, receiver) {
        if (
          typeof prop === "string" &&
          ["upload", "uploadToSignedUrl", "update", "remove", "move", "copy"].includes(prop)
        ) {
          return async () => {
            assertWriteAllowed(`${prop} em arquivos (${bucket})`);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  };

  const originalRpc = client.rpc.bind(client);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).rpc = (fn: string, ...rest: any[]) => {
    // Auditoria continua gravando (é o registro da própria sessão impersonada).
    const allowed = /^(has_role|get_|list_|is_)/.test(fn) || fn === "insert_audit_log";
    if (isReadOnlyMode() && !allowed) {
      assertWriteAllowed(`função ${fn}`);
    }
    return originalRpc(fn, ...rest);
  };
}
