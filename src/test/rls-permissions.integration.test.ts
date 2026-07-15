/**
 * Testes de regressão de RLS / permissões.
 *
 * Objetivo: garantir que mudanças de segurança futuras não removam,
 * novamente, o acesso `anon` que a UI depende (o app usa sessão SAP,
 * não Supabase Auth, então grande parte das leituras acontece com a
 * chave `anon`). Também valida que dados sensíveis continuam protegidos.
 *
 * Estes testes são READ-ONLY contra o banco real. Rodam apenas quando
 * VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY estão presentes.
 * Não fazem INSERT/UPDATE/DELETE em tabelas de produção — as tentativas
 * de escrita são feitas apenas contra dados fake que devem ser rejeitados
 * pela RLS e nunca chegar a persistir.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

const enabled = Boolean(url && anonKey);
const d = enabled ? describe : describe.skip;

let anon: SupabaseClient;

beforeAll(() => {
  if (!enabled) return;
  anon = createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
});

/**
 * Tabelas que a UI precisa ler com a chave anon (usuário logado via SAP,
 * sem sessão Supabase Auth). Uma consulta HEAD/COUNT deve responder OK
 * — mesmo que retorne 0 linhas. Um erro de permissão é regressão.
 */
const ANON_READABLE_TABLES = [
  "companies",
  "enabled_erp_types",
  "expenses",
  "expense_items",
  "expense_attachments",
  "expense_approval_log",
  "approval_rules",
  "approval_rule_levels",
  "approver_cost_centers",
  "approver_substitutes",
  "sap_cache",
  "sap_purchase_order_cache",
  "sap_nf_entrada_cache",
  "sap_vendor_payment_cache",
  "sap_fluxo_analise_cache",
  "pagcorp_cards",
  "pagcorp_card_mapping",
  "pagcorp_integration_log",
  "pagcorp_nondeductible_cards",
  "pagcorp_nondeductible_expenses",
  "pagcorp_settlement_accounts",
  "pagcorp_supplier_links",
  "pagcorp_item_mapping",
  "pagcorp_account_mapping",
  "nf_entrada_logs",
  "nf_entrada_imports",
  "nf_entrada_settings",
  "nf_entrada_contas_pagar",
  "suppliers",
  "fornecedores",
  "item_base",
  "item_variante",
  "permission_groups",
  "permission_group_modules",
  "user_group_assignments",
  "user_profiles",
  "notification_preferences",
  "notifications",
  "audit_log",
  "synapse_integrations",
  "synapse_execution_log",
  "synapse_global_settings",
  "advance_payments",
  "advance_payment_items",
  "advance_payment_attachments",
] as const;

/**
 * Tabelas de segredos/roles que NUNCA devem ser modificáveis por anon.
 * Leitura pode ser permitida (ex.: user_roles é lida para admin check),
 * mas escrita anônima é escalonamento de privilégio.
 */
const ANON_WRITE_FORBIDDEN = [
  "user_roles",
  "system_credentials",
  "companies",
  "external_api_allowlist",
] as const;

d("RLS: acesso anon (chave publishable) — leituras necessárias à UI", () => {
  it.each(ANON_READABLE_TABLES)(
    "%s: SELECT count deve responder sem erro de permissão",
    async (table) => {
      const { error } = await anon
        .from(table)
        .select("*", { count: "exact", head: true });
      if (error) {
        // Mensagem clara de regressão
        throw new Error(
          `Tabela "${table}" perdeu acesso anon (${error.code}): ${error.message}. ` +
            `Se a intenção foi restringir, mova a leitura para uma Edge Function ` +
            `e atualize a UI antes de derrubar a policy.`,
        );
      }
      expect(error).toBeNull();
    },
  );
});

d("RLS: anon NÃO pode escrever em tabelas de identidade/segredo", () => {
  it.each(ANON_WRITE_FORBIDDEN)(
    "%s: INSERT anônimo deve ser rejeitado pela RLS",
    async (table) => {
      // Payload propositalmente inválido — se a RLS falhar, ainda assim
      // o insert deve ser barrado. Nunca deve persistir.
      const { error } = await anon.from(table).insert({}).select();
      expect(error).not.toBeNull();
      // 42501 = insufficient_privilege, 42P01 raro, 23xxx = violação
      // O ponto é: NÃO pode retornar sucesso.
    },
  );

  it("user_roles: anon não consegue se auto-promover a admin", async () => {
    const fakeUserId = "00000000-0000-0000-0000-000000000000";
    const { data, error } = await anon
      .from("user_roles")
      .insert({ user_id: fakeUserId, role: "admin" })
      .select();
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });
});

d("RLS: tabelas com credenciais não vazam segredos para anon", () => {
  it("system_credentials: SELECT anônimo não retorna linhas", async () => {
    const { data, error } = await anon
      .from("system_credentials")
      .select("company_db")
      .limit(1);
    // Ou a policy nega (error) ou retorna vazio. Nunca deve devolver linhas.
    if (!error) {
      expect(data ?? []).toEqual([]);
    }
  });

  it("external_api_allowlist: SELECT anônimo não retorna linhas", async () => {
    const { data, error } = await anon
      .from("external_api_allowlist")
      .select("user_code")
      .limit(1);
    if (!error) {
      expect(data ?? []).toEqual([]);
    }
  });
});

d("RLS: função has_role está callable e é conservadora", () => {
  it("has_role retorna false para uuid vazio (não escala privilégio)", async () => {
    const { data, error } = await anon.rpc("has_role", {
      _user_id: "00000000-0000-0000-0000-000000000000",
      _role: "admin",
    });
    expect(error).toBeNull();
    expect(data).toBe(false);
  });
});

if (!enabled) {
  // eslint-disable-next-line no-console
  console.warn(
    "[rls-permissions] pulando testes: VITE_SUPABASE_URL/VITE_SUPABASE_PUBLISHABLE_KEY ausentes",
  );
}
