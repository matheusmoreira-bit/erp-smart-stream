export interface NavItem {
  label: string;
  path: string;
  moduleKey?: string;
}

export interface NavModule {
  key: string;
  label: string;
  /** Prefixos de rota que pertencem a este módulo. */
  match: string[];
  items: NavItem[];
}

/**
 * Mapa central de navegação: módulo → submódulos.
 * Usado tanto no painel (cards com submenu) quanto na barra de submenu das telas.
 */
export const NAV_MODULES: NavModule[] = [
  {
    key: "expenses",
    label: "Compras",
    match: ["/compras", "/financeiro/adiantamentos", "/financeiro/nf-entrada"],
    items: [
      { label: "Pedidos de Compra", path: "/compras", moduleKey: "expenses" },
      { label: "Adiantamentos", path: "/financeiro/adiantamentos", moduleKey: "expenses" },
      { label: "NF de Entrada", path: "/financeiro/nf-entrada", moduleKey: "nf_entrada" },
    ],
  },
  {
    key: "sales",
    label: "Vendas",
    match: ["/vendas"],
    items: [
      { label: "Pedidos de Venda", path: "/vendas/pedidos", moduleKey: "sales" },
      { label: "NFS-e", path: "/vendas/nfse", moduleKey: "sales" },
      { label: "Contas a Receber", path: "/vendas/recebimentos", moduleKey: "sales" },
      { label: "Destinatários", path: "/vendas/destinatarios", moduleKey: "sales" },
      { label: "Histórico de Baixas", path: "/vendas/historico", moduleKey: "sales" },
    ],
  },
  {
    key: "approvals",
    label: "Aprovações",
    match: ["/aprovacoes"],
    items: [
      { label: "Pendentes", path: "/aprovacoes?tab=pending", moduleKey: "approvals" },
      { label: "Histórico", path: "/aprovacoes?tab=history", moduleKey: "approval_history" },
      { label: "Regras de Aprovação", path: "/aprovacoes/regras", moduleKey: "approval_rules" },
      { label: "Matriz de Alçadas", path: "/aprovacoes/matriz", moduleKey: "approval_rules" },

    ],
  },
  {
    key: "pagcorp",
    label: "Cartões Corporativos",
    match: ["/cartoes"],
    items: [
      { label: "Transações", path: "/cartoes/transacoes", moduleKey: "pagcorp" },
      { label: "Mapeamento de Cartões", path: "/cartoes/mapeamento", moduleKey: "pagcorp" },
      { label: "Indedutíveis", path: "/cartoes/indedutiveis", moduleKey: "pagcorp" },
      { label: "Histórico de Integrações", path: "/cartoes/historico", moduleKey: "pagcorp" },
    ],
  },
  {
    key: "cadastros",
    label: "Cadastros",
    match: ["/cadastros", "/solicitacoes"],
    items: [
      { label: "Fornecedores", path: "/cadastros/fornecedores", moduleKey: "suppliers" },
      { label: "Itens", path: "/cadastros/itens", moduleKey: "items" },
      { label: "Plano de Contas & CC", path: "/cadastros/intercompany", moduleKey: "intercompany" },
      { label: "Solicitações de cadastro", path: "/solicitacoes" },
    ],
  },
  {
    key: "financeiro",
    label: "Financeiro",
    match: ["/financeiro/reconciliacao"],
    items: [
      { label: "Reconciliação de Adiantamentos", path: "/financeiro/reconciliacao", moduleKey: "financial_review" },
      { label: "Adiantamentos", path: "/financeiro/adiantamentos", moduleKey: "expenses" },
      { label: "NF de Entrada", path: "/financeiro/nf-entrada", moduleKey: "nf_entrada" },
    ],
  },
  {
    key: "auditoria",
    label: "Auditoria",
    match: ["/auditoria"],
    items: [
      { label: "Auditoria SAP", path: "/auditoria/sap", moduleKey: "audit_console" },
      { label: "Auditoria Fiscal", path: "/auditoria/fiscal", moduleKey: "fiscal_audit" },
      { label: "Cruzamento Fiscal × Pagamentos", path: "/auditoria/cruzamento", moduleKey: "fiscal_audit" },
      { label: "KYP — Fornecedores", path: "/auditoria/kyp", moduleKey: "kyp" },
      { label: "Logs do Sistema", path: "/auditoria/logs", moduleKey: "audit_log" },
    ],
  },
  {
    key: "integracoes",
    label: "Integrações",
    match: ["/integracoes"],
    items: [
      { label: "Automações", path: "/integracoes/automacoes", moduleKey: "synapse" },
      { label: "Monitor de Integrações", path: "/integracoes/monitor", moduleKey: "integration_history" },
      { label: "Colaboradores", path: "/integracoes/colaboradores", moduleKey: "employee_integration" },
      { label: "Credenciais", path: "/integracoes/credenciais", moduleKey: "credentials" },
    ],
  },
  {
    key: "users",
    label: "Usuários",
    match: ["/usuarios"],
    items: [
      { label: "Usuários", path: "/usuarios/lista", moduleKey: "users" },
      { label: "Atividade", path: "/usuarios/atividade", moduleKey: "users" },
      { label: "Produtividade", path: "/usuarios/produtividade", moduleKey: "users_productivity" },
      { label: "Licenças", path: "/usuarios/licencas", moduleKey: "users" },
      { label: "Importar Licenças", path: "/usuarios/importar-licencas", moduleKey: "users" },
      { label: "Sincronização IdP", path: "/usuarios/sincronizacao-idp", moduleKey: "users" },
    ],
  },
  {
    key: "analytics",
    label: "Analytics",
    match: ["/analytics"],
    items: [{ label: "Visão geral", path: "/analytics", moduleKey: "analytics" }],
  },
  {
    key: "notifications",
    label: "Notificações",
    match: ["/notificacoes"],
    items: [{ label: "Central de Notificações", path: "/notificacoes", moduleKey: "notifications" }],
  },
  {
    key: "profile",
    label: "Meu perfil",
    match: ["/perfil"],
    items: [{ label: "Meu perfil", path: "/perfil" }],
  },
];

/** Encontra o módulo cujo prefixo de rota casa com o pathname atual. */
export function findNavModule(pathname: string): NavModule | undefined {
  return NAV_MODULES.filter((m) =>
    m.match.some((p) => pathname === p || pathname.startsWith(`${p}/`)),
  ).sort(
    (a, b) =>
      Math.max(...b.match.map((p) => (pathname.startsWith(p) ? p.length : 0))) -
      Math.max(...a.match.map((p) => (pathname.startsWith(p) ? p.length : 0))),
  )[0];
}
