/**
 * Catálogo único de CAPACIDADES (flags transversais) dos grupos de permissão.
 *
 * Regra de arquitetura: toda segregação de função do sistema (visibilidade de
 * dados, filtros, ações especiais) é uma opção DO GRUPO — nunca uma regra
 * escondida no código por nome de grupo ou por usuário.
 *
 * As capacidades são persistidas em `permission_group_modules` usando
 * `can_view` como liga/desliga.
 */

export type CapabilityCategory =
  | "data_scope"
  | "approvals"
  | "registrations"
  | "purchasing"
  | "admin";

export interface CapabilityDef {
  key: string;
  label: string;
  hint: string;
  category: CapabilityCategory;
}

export const CAPABILITY_CATEGORIES: { key: CapabilityCategory; label: string; hint: string }[] = [
  {
    key: "data_scope",
    label: "Visibilidade de dados",
    hint: "Define o recorte de documentos e cadastros que o grupo enxerga.",
  },
  {
    key: "approvals",
    label: "Aprovações",
    hint: "Ações especiais dentro do fluxo de aprovação.",
  },
  {
    key: "registrations",
    label: "Cadastros",
    hint: "O que o grupo pode cadastrar direto no ERP.",
  },
  {
    key: "purchasing",
    label: "Compras e itens",
    hint: "Regras aplicadas ao formulário de pedido.",
  },
  { key: "admin", label: "Administração", hint: "Recursos administrativos e de ambiente." },
];

export const CAPABILITY_CATALOG: CapabilityDef[] = [
  // ── Visibilidade de dados ─────────────────────────────────
  {
    key: "expenses_view_all",
    label: "Ver todas as Compras/Vendas",
    hint: "Sem esta opção o grupo enxerga apenas os documentos que criou.",
    category: "data_scope",
  },
  {
    key: "approvals_view_all",
    label: "Ver todas as Aprovações",
    hint: "Enxerga pendências e histórico de todos, em modo leitura.",
    category: "data_scope",
  },
  {
    key: "documents_view_directorate",
    label: "Ver documentos da própria diretoria",
    hint: "Recorte por centro de custo de 2º nível vindo do IdP (1.6.1.2 → 1.6.%). Sem CC no IdP, vê apenas os próprios.",
    category: "data_scope",
  },
  {
    key: "cost_centers_view_all",
    label: "Selecionar todos os centros de custo",
    hint: "Permite lançar em qualquer CC, mesmo com visibilidade de documentos restrita.",
    category: "data_scope",
  },
  {
    key: "drafts_view_all",
    label: "Ver rascunhos de terceiros",
    hint: "Rascunhos deixam de ser privados do autor para este grupo.",
    category: "data_scope",
  },
  {
    key: "view_all_default_on",
    label: 'Filtro "Ver todos" já ligado',
    hint: 'Abre as telas com o filtro "Ver todos" marcado (depende das opções acima).',
    category: "data_scope",
  },
  {
    key: "projects_scope_by_segment",
    label: "Restringir projetos pelo segmento de gestão",
    hint: "ANA Gaming enxerga ANA GAMING e 7K; Lótus enxerga VERA e CASSINO; CSC enxerga todos (bases ANA Gaming).",
    category: "data_scope",
  },


  // ── Aprovações ────────────────────────────────────────────
  {
    key: "approvals_delegate",
    label: "Delegar aprovações",
    hint: "Pode delegar uma aprovação a outro usuário.",
    category: "approvals",
  },
  {
    key: "approvals_transfer",
    label: "Transferir aprovações em massa",
    hint: "Ferramenta administrativa de transferência entre aprovadores.",
    category: "approvals",
  },
  {
    key: "approvals_override",
    label: "Aprovar fora do fluxo",
    hint: "Aprova documentos mesmo sem ser o aprovador designado.",
    category: "approvals",
  },

  // ── Cadastros ─────────────────────────────────────────────
  {
    key: "suppliers_register_direct",
    label: "Cadastrar fornecedor direto no ERP",
    hint: "Sem esta opção o usuário abre uma solicitação de cadastro para o time responsável.",
    category: "registrations",
  },
  {
    key: "suppliers_reactivate",
    label: "Reativar fornecedores inativos",
    hint: "Permite reativar fornecedor bloqueado no ERP.",
    category: "registrations",
  },

  // ── Compras e itens ───────────────────────────────────────
  {
    key: "items_restricted_all",
    label: "Liberar itens restritos por centro de custo",
    hint: "Ignora as travas de itens por prefixo (IMP%, FOL%) aplicadas por CC.",
    category: "purchasing",
  },
  {
    key: "expenses_cancel",
    label: "Cancelar documentos",
    hint: "Cancela pedidos/lançamentos próprios ou de terceiros.",
    category: "purchasing",
  },

  // ── Administração ─────────────────────────────────────────
  {
    key: "test_companies_view",
    label: "Ver empresas de teste",
    hint: "Exibe bases TST%/SBO_TESTE% na seleção de empresa. Admins já enxergam.",
    category: "admin",
  },
];

export const CAPABILITY_KEYS = CAPABILITY_CATALOG.map((c) => c.key);

export function isCapabilityKey(key: string): boolean {
  return CAPABILITY_KEYS.includes(key);
}
