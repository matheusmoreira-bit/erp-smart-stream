import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  BarChart3,
  Bell,
  BookOpenCheck,
  Box,
  Building2,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  FileCheck2,
  FileInput,
  History,
  LayoutGrid,
  ListChecks,
  Plug,
  Radar,
  ReceiptText,
  Search,
  Shield,
  ShoppingCart,
  TrendingUp,
  UserCog,
  Users,
  Wallet,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { NotificationBell } from "@/components/NotificationBell";
import { OfflineQueueIndicator } from "@/components/OfflineQueueIndicator";
import { useCompanies } from "@/hooks/useCompanies";
import { useModuleAccess } from "@/hooks/usePermissions";
import { useSap } from "@/contexts/SapContext";
import { cn } from "@/lib/utils";

interface MenuItem {
  label: string;
  path: string;
  moduleKey?: string;
  icon?: LucideIcon;
}

interface MenuModule {
  title: string;
  icon: LucideIcon;
  path: string;
  moduleKey: string;
  subModuleKeys?: string[];
  items?: MenuItem[];
}

interface UseCase {
  id: string;
  label: string;
  title: string;
  icon: LucideIcon;
  moduleKeys: string[];
  accent: string;
  iconSurface: string;
}

interface VisibleMenuItem extends MenuItem {
  id: string;
  moduleTitle: string;
  icon: LucideIcon;
}

const modules: Record<string, MenuModule> = {
  expenses: {
    title: "Compras",
    icon: ShoppingCart,
    path: "/compras",
    moduleKey: "expenses",
    items: [{ label: "Pedidos de compra", path: "/compras", icon: ShoppingCart }],
  },
  approvals: {
    title: "Aprovações",
    icon: ClipboardCheck,
    path: "/aprovacoes?tab=pending",
    moduleKey: "",
    subModuleKeys: ["approvals", "approval_history"],
    items: [
      { label: "Aprovações pendentes", path: "/aprovacoes?tab=pending", moduleKey: "approvals", icon: ListChecks },
      { label: "Histórico de aprovações", path: "/aprovacoes?tab=history", moduleKey: "approval_history", icon: History },
    ],
  },
  advance_payments: {
    title: "Adiantamentos",
    icon: Wallet,
    path: "/financeiro/adiantamentos",
    moduleKey: "financial_review",
    items: [{ label: "Adiantamentos a fornecedor", path: "/financeiro/adiantamentos", icon: Wallet }],
  },
  nf_entrada: {
    title: "Documentos fiscais",
    icon: FileInput,
    path: "/financeiro/nf-entrada",
    moduleKey: "nf_entrada",
    items: [{ label: "Notas fiscais de entrada", path: "/financeiro/nf-entrada", icon: FileInput }],
  },
  sales: {
    title: "Vendas",
    icon: ReceiptText,
    path: "/vendas/pedidos",
    moduleKey: "sales",
    items: [
      { label: "Pedidos de venda", path: "/vendas/pedidos", icon: ReceiptText },
      { label: "Emissão de NFS-e", path: "/vendas/nfse", icon: FileCheck2 },
      { label: "Adiantamentos de clientes", path: "/vendas/adiantamentos", icon: Wallet },
      { label: "Contas a receber", path: "/vendas/recebimentos", icon: TrendingUp },
      { label: "Destinatários", path: "/vendas/destinatarios", icon: Users },
      { label: "Histórico de baixas", path: "/vendas/historico", icon: History },
    ],
  },
  pagcorp: {
    title: "Cartões corporativos",
    icon: CreditCard,
    path: "/cartoes/transacoes",
    moduleKey: "pagcorp",
    items: [
      { label: "Transações", path: "/cartoes/transacoes", icon: CreditCard },
      { label: "Mapeamento de cartões", path: "/cartoes/mapeamento", icon: Workflow },
      { label: "Despesas indedutíveis", path: "/cartoes/indedutiveis", icon: Shield },
      { label: "Baixas PagCorp", path: "/cartoes/baixas", icon: FileCheck2 },
      { label: "Histórico de integrações", path: "/cartoes/historico", icon: History },
    ],
  },
  suppliers: {
    title: "Parceiros de negócios",
    icon: Building2,
    path: "/cadastros/fornecedores",
    moduleKey: "suppliers",
    items: [{ label: "Fornecedores", path: "/cadastros/fornecedores", icon: Building2 }],
  },
  items: {
    title: "Administração de itens",
    icon: Box,
    path: "/cadastros/itens",
    moduleKey: "items",
    items: [{ label: "Itens", path: "/cadastros/itens", icon: Box }],
  },
  registration_requests: {
    title: "Solicitações de cadastro",
    icon: ClipboardList,
    path: "/solicitacoes",
    moduleKey: "suppliers",
    items: [{ label: "Solicitações de fornecedores e itens", path: "/solicitacoes", icon: ClipboardList }],
  },
  intercompany: {
    title: "Estrutura contábil",
    icon: BookOpenCheck,
    path: "/cadastros/intercompany",
    moduleKey: "intercompany",
    items: [{ label: "Plano de contas e centros de custo", path: "/cadastros/intercompany", icon: BookOpenCheck }],
  },
  financial_review: {
    title: "Conciliação",
    icon: Wallet,
    path: "/financeiro/reconciliacao",
    moduleKey: "financial_review",
    items: [{ label: "Reconciliação de adiantamentos", path: "/financeiro/reconciliacao", icon: Wallet }],
  },
  cashflow_forecast: {
    title: "Planejamento financeiro",
    icon: TrendingUp,
    path: "/financeiro/previsao-caixa",
    moduleKey: "financial_review",
    items: [{ label: "Previsão de caixa", path: "/financeiro/previsao-caixa", icon: TrendingUp }],
  },
  analytics: {
    title: "Análise",
    icon: BarChart3,
    path: "/analytics",
    moduleKey: "analytics",
    items: [{ label: "Indicadores do fluxo", path: "/analytics", icon: BarChart3 }],
  },
  auditoria: {
    title: "Auditoria",
    icon: Radar,
    path: "/auditoria/geral",
    moduleKey: "",
    subModuleKeys: ["audit_console", "fiscal_audit", "audit_log", "kyp"],
    items: [
      { label: "Auditoria SAP e pagamentos", path: "/auditoria/geral", moduleKey: "audit_console", icon: Radar },
      { label: "Cruzamento fiscal e pagamentos", path: "/auditoria/cruzamento", moduleKey: "audit_console", icon: Workflow },
      { label: "KYP de fornecedores", path: "/auditoria/kyp", moduleKey: "audit_console", icon: Shield },
      { label: "Logs do sistema", path: "/auditoria/logs", moduleKey: "audit_console", icon: History },
    ],
  },
  users: {
    title: "Usuários",
    icon: Users,
    path: "/usuarios/lista",
    moduleKey: "",
    subModuleKeys: ["users", "users_productivity"],
    items: [
      { label: "Usuários", path: "/usuarios/lista", moduleKey: "users", icon: Users },
      { label: "Grupos e permissões", path: "/usuarios/permissoes", moduleKey: "users", icon: Shield },
      { label: "Atividade de usuários", path: "/usuarios/atividade", moduleKey: "users", icon: Activity },
      { label: "Produtividade", path: "/analytics/produtividade", moduleKey: "users_productivity", icon: BarChart3 },
      { label: "Licenças", path: "/usuarios/licencas", moduleKey: "users", icon: FileCheck2 },
      { label: "Importação de licenças", path: "/usuarios/importar-licencas", moduleKey: "users", icon: FileInput },
      { label: "Sincronização IdP", path: "/usuarios/sincronizacao-idp", moduleKey: "users", icon: Workflow },
    ],
  },
  approval_rules: {
    title: "Governança de aprovação",
    icon: Shield,
    path: "/aprovacoes/regras",
    moduleKey: "approval_rules",
    items: [
      { label: "Regras de aprovação", path: "/aprovacoes/regras", icon: Shield },
      { label: "Matriz de aprovação", path: "/aprovacoes/matriz", icon: Workflow },
    ],
  },
  integrations: {
    title: "Integrações",
    icon: Plug,
    path: "/integracoes/automacoes",
    moduleKey: "",
    subModuleKeys: ["synapse", "integration_history", "employee_integration", "credentials"],
    items: [
      { label: "Automações", path: "/integracoes/automacoes", moduleKey: "synapse", icon: Workflow },
      { label: "Monitor de integrações", path: "/integracoes/monitor", moduleKey: "integration_history", icon: Activity },
      { label: "Integração de colaboradores", path: "/integracoes/colaboradores", moduleKey: "employee_integration", icon: Users },
      { label: "Credenciais", path: "/integracoes/credenciais", moduleKey: "credentials", icon: Shield },
    ],
  },
  notifications: {
    title: "Comunicação",
    icon: Bell,
    path: "/notificacoes",
    moduleKey: "notifications",
    items: [
      { label: "Central de notificações", path: "/notificacoes", icon: Bell },
      { label: "Governança de notificações", path: "/notificacoes/regras", icon: Shield },
    ],
  },
};

const useCases: UseCase[] = [
  {
    id: "purchases",
    label: "Compras",
    title: "Compras e aprovações",
    icon: ShoppingCart,
    moduleKeys: ["expenses", "approvals", "advance_payments", "nf_entrada"],
    accent: "text-emerald-500",
    iconSurface: "bg-emerald-500/10",
  },
  {
    id: "sales",
    label: "Vendas",
    title: "Vendas e recebimentos",
    icon: ReceiptText,
    moduleKeys: ["sales"],
    accent: "text-sky-500",
    iconSurface: "bg-sky-500/10",
  },
  {
    id: "cards",
    label: "Cartões",
    title: "Cartões corporativos",
    icon: CreditCard,
    moduleKeys: ["pagcorp"],
    accent: "text-cyan-500",
    iconSurface: "bg-cyan-500/10",
  },
  {
    id: "records",
    label: "Cadastros",
    title: "Cadastros e estrutura",
    icon: Building2,
    moduleKeys: ["suppliers", "items", "registration_requests", "intercompany"],
    accent: "text-amber-500",
    iconSurface: "bg-amber-500/10",
  },
  {
    id: "management",
    label: "Financeiro e análise",
    title: "Financeiro, análise e auditoria",
    icon: TrendingUp,
    moduleKeys: ["financial_review", "cashflow_forecast", "analytics", "auditoria"],
    accent: "text-rose-500",
    iconSurface: "bg-rose-500/10",
  },
  {
    id: "administration",
    label: "Administração",
    title: "Administração e governança",
    icon: UserCog,
    moduleKeys: ["users", "approval_rules", "integrations", "notifications"],
    accent: "text-violet-500",
    iconSurface: "bg-violet-500/10",
  },
];

function moduleHasAccess(mod: MenuModule, userModules: string[]) {
  if (mod.subModuleKeys?.length) {
    return mod.subModuleKeys.some((key) => userModules.includes(key));
  }
  return !mod.moduleKey || userModules.includes(mod.moduleKey);
}

function moduleItems(mod: MenuModule, userModules: string[]): VisibleMenuItem[] {
  const items = mod.items ?? [{ label: mod.title, path: mod.path }];
  return items
    .filter((item) => {
      const requiredModule = item.moduleKey ?? mod.moduleKey;
      return !requiredModule || userModules.includes(requiredModule);
    })
    .map((item) => ({
      ...item,
      id: `${mod.title}:${item.path}`,
      moduleTitle: mod.title,
      icon: item.icon ?? mod.icon,
    }));
}

function MenuTile({ item, useCase }: { item: VisibleMenuItem; useCase: UseCase }) {
  const navigate = useNavigate();
  const Icon = item.icon;

  return (
    <button
      type="button"
      onClick={() => navigate(item.path)}
      className="group flex min-h-36 w-full flex-col justify-between rounded-lg border border-border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/45 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{item.moduleTitle}</p>
        <h3 className="mt-1 text-sm font-semibold leading-5 text-foreground">{item.label}</h3>
      </div>
      <div className="mt-5 flex items-end justify-between gap-3">
        <span className={cn("flex h-10 w-10 items-center justify-center rounded-md", useCase.iconSurface, useCase.accent)}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden="true" />
      </div>
    </button>
  );
}

export function MainMenu() {
  const navigate = useNavigate();
  const { session } = useSap();
  const { userModules, loading: permissionsLoading } = useModuleAccess();
  const { getLabel } = useCompanies(true);
  const [activeUseCase, setActiveUseCase] = useState("all");
  const [search, setSearch] = useState("");

  const companyLabel = getLabel(session?.companyDB || "");
  const accessibleUseCases = useMemo(() => {
    return useCases.map((useCase) => {
      const items = useCase.moduleKeys.flatMap((key) => {
        const mod = modules[key];
        if (!mod || !moduleHasAccess(mod, userModules)) return [];
        return moduleItems(mod, userModules);
      });

      return { ...useCase, items };
    }).filter((useCase) => useCase.items.length > 0);
  }, [userModules]);

  const visibleUseCases = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");
    if (!normalizedSearch) return accessibleUseCases;

    return accessibleUseCases.map((useCase) => ({
      ...useCase,
      items: useCase.items.filter((item) => {
        if (!normalizedSearch) return true;
        return `${item.label} ${item.moduleTitle} ${useCase.title}`
          .toLocaleLowerCase("pt-BR")
          .includes(normalizedSearch);
      }),
    })).filter((useCase) => useCase.items.length > 0);
  }, [accessibleUseCases, search]);

  const displayedUseCases = search || activeUseCase === "all"
    ? visibleUseCases
    : visibleUseCases.filter((useCase) => useCase.id === activeUseCase);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PageHeader
        icon={<LayoutGrid className="h-4 w-4 text-primary" />}
        title="Página inicial"
        subtitle={companyLabel || "ERP Flow"}
        showBack={false}
        actions={
          <>
            <OfflineQueueIndicator />
            <NotificationBell />
            <button
              type="button"
              onClick={() => navigate("/perfil")}
              title="Meu perfil"
              className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              <UserCog className="h-4 w-4" />
            </button>
          </>
        }
      />

      <div className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <nav className="-mx-1 flex min-w-0 gap-1 overflow-x-auto px-1" aria-label="Casos de uso">
            <button
              type="button"
              onClick={() => setActiveUseCase("all")}
              className={cn(
                "shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                activeUseCase === "all" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              Página inicial
            </button>
            {accessibleUseCases.map((useCase) => (
              <button
                key={useCase.id}
                type="button"
                onClick={() => setActiveUseCase(useCase.id)}
                className={cn(
                  "shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  activeUseCase === useCase.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {useCase.label}
              </button>
            ))}
          </nav>

          <div className="relative w-full lg:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar na página inicial"
              className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-9 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                title="Limpar busca"
                className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <main className="flex-1 px-4 py-6 pb-24 sm:px-6 md:pb-10">
        <div className="mx-auto max-w-[1600px] space-y-8">
          {permissionsLoading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7">
              {Array.from({ length: 7 }).map((_, index) => (
                <div key={index} className="min-h-36 animate-pulse rounded-lg border border-border bg-card" />
              ))}
            </div>
          ) : displayedUseCases.length > 0 ? (
            displayedUseCases.map((useCase) => {
              const CaseIcon = useCase.icon;
              return (
                <section key={useCase.id} aria-labelledby={`home-${useCase.id}`}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", useCase.iconSurface, useCase.accent)}>
                        <CaseIcon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <h2 id={`home-${useCase.id}`} className="truncate text-base font-semibold text-foreground sm:text-lg">
                        {useCase.title}
                      </h2>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{useCase.items.length} opções</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7">
                    {useCase.items.map((item) => (
                      <MenuTile key={item.id} item={item} useCase={useCase} />
                    ))}
                  </div>
                </section>
              );
            })
          ) : (
            <div className="flex min-h-56 flex-col items-center justify-center border-y border-border text-center">
              <Search className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium text-foreground">Nenhuma opção encontrada</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
