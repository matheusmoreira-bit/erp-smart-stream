import { useCompanies } from "@/hooks/useCompanies";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  BarChart3,
  ShoppingCart,
  ClipboardCheck,
  Activity,
  ArrowRight,
  Shield,
  CreditCard,
  Users,
  Plug,
  Lock,
  Building2,
  Box,
  Wallet,
  Bell,
  FileInput,
  Radar,
  type LucideIcon,
} from "lucide-react";
import { useSap } from "@/contexts/SapContext";
import { useModuleAccess } from "@/hooks/usePermissions";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ChangePasswordDialog } from "@/components/ChangePasswordDialog";
import { NotificationBell } from "@/components/NotificationBell";

interface ModuleCard {
  title: string;
  description: string;
  icon: LucideIcon;
  path: string;
  color: string;
  bgGlow: string;
  /** Primary module key. Empty string for hubs gated by subModuleKeys. */
  moduleKey: string;
  /** If set, the card is visible when the user has access to ANY of these modules. */
  subModuleKeys?: string[];
}

const modules: Record<string, ModuleCard> = {
  analytics: {
    title: "Analytics",
    description: "Visão geral de métricas, tempos por etapa e insights de performance do fluxo de compras.",
    icon: BarChart3,
    path: "/analytics",
    color: "text-sky-400",
    bgGlow: "from-sky-500/20 to-sky-500/5",
    moduleKey: "analytics",
  },
  expenses: {
    title: "Compras",
    description: "Crie e acompanhe solicitações de compras com fluxo de aprovação e integração SAP.",
    icon: ShoppingCart,
    path: "/expenses",
    color: "text-emerald-400",
    bgGlow: "from-emerald-500/20 to-emerald-500/5",
    moduleKey: "expenses",
  },
  sales: {
    title: "Vendas",
    description: "Crie e acompanhe pedidos de venda com fluxo de aprovação e integração SAP.",
    icon: Wallet,
    path: "/sales",
    color: "text-emerald-400",
    bgGlow: "from-emerald-500/20 to-emerald-500/5",
    moduleKey: "sales",
  },
  approvals: {
    title: "Aprovações",
    description: "Pendentes e histórico em um só lugar — valor, fornecedor, aprovador e vencimento.",
    icon: ClipboardCheck,
    path: "/approvals",
    color: "text-emerald-400",
    bgGlow: "from-emerald-500/20 to-emerald-500/5",
    moduleKey: "",
    subModuleKeys: ["approvals", "approval_history"],
  },
  approval_rules: {
    title: "Regras de Aprovação",
    description: "Configure regras de aprovação em N níveis com critérios de valor, centro de custo e tipo de documento.",
    icon: Shield,
    path: "/approval-rules",
    color: "text-violet-400",
    bgGlow: "from-violet-500/20 to-violet-500/5",
    moduleKey: "approval_rules",
  },
  pagcorp: {
    title: "Cartões Corporativos",
    description: "Transações de cartões corporativos com filtro de prestação de conta e lançamento no SAP.",
    icon: CreditCard,
    path: "/pagcorp",
    color: "text-cyan-400",
    bgGlow: "from-cyan-500/20 to-cyan-500/5",
    moduleKey: "pagcorp",
  },
  users: {
    title: "Usuários",
    description: "Lista, atividade, produtividade, licenças e sincronização IdP — tudo em um só hub.",
    icon: Users,
    path: "/users",
    color: "text-violet-400",
    bgGlow: "from-violet-500/20 to-violet-500/5",
    moduleKey: "users",
  },
  suppliers: {
    title: "Fornecedores",
    description: "Cadastro de fornecedores com sincronização SAP e extração via IA a partir de notas fiscais.",
    icon: Building2,
    path: "/suppliers",
    color: "text-indigo-400",
    bgGlow: "from-indigo-500/20 to-indigo-500/5",
    moduleKey: "suppliers",
  },
  items: {
    title: "Itens",
    description: "Cadastro de itens (OITM) com sincronização direta no SAP — criar, editar e ativar/inativar.",
    icon: Box,
    path: "/items",
    color: "text-indigo-400",
    bgGlow: "from-indigo-500/20 to-indigo-500/5",
    moduleKey: "items",
  },
  integracoes: {
    title: "Integrações",
    description: "Automações, monitor de sincronização e credenciais de sistemas externos em um só hub.",
    icon: Plug,
    path: "/integracoes",
    color: "text-violet-400",
    bgGlow: "from-violet-500/20 to-violet-500/5",
    moduleKey: "",
    subModuleKeys: ["synapse", "integration_history", "credentials"],
  },
  intercompany: {
    title: "Plano de Contas & CC",
    description: "Plano de contas e centros de custo consolidados entre empresas, com criação simultânea em todas.",
    icon: Building2,
    path: "/intercompany",
    color: "text-indigo-400",
    bgGlow: "from-indigo-500/20 to-indigo-500/5",
    moduleKey: "intercompany",
  },
  financial_review: {
    title: "Adiantamentos",
    description: "Adiantamentos em aberto (clientes/fornecedores) sem vínculo a notas, com passo a passo de reconciliação.",
    icon: Wallet,
    path: "/financial-review",
    color: "text-cyan-400",
    bgGlow: "from-cyan-500/20 to-cyan-500/5",
    moduleKey: "financial_review",
  },
  notifications: {
    title: "Notificações",
    description: "Central de notificações, preferências, auditoria e histórico de envios (WhatsApp, e-mail).",
    icon: Bell,
    path: "/notifications",
    color: "text-violet-400",
    bgGlow: "from-violet-500/20 to-violet-500/5",
    moduleKey: "notifications",
  },
  nf_entrada: {
    title: "NF de Entrada",
    description: "Importa NFs da Master Tax, gera despesa no ERP Flow e cria esboços de PO e NF de Entrada no SAP B1.",
    icon: FileInput,
    path: "/nf-entrada",
    color: "text-orange-400",
    bgGlow: "from-orange-500/20 to-orange-500/5",
    moduleKey: "nf_entrada",
  },
  auditoria: {
    title: "Auditoria",
    description: "Auditoria SAP, auditoria fiscal e logs do sistema unificados em um único hub.",
    icon: Radar,
    path: "/auditoria",
    color: "text-sky-400",
    bgGlow: "from-sky-500/20 to-sky-500/5",
    moduleKey: "",
    subModuleKeys: ["audit_console", "fiscal_audit", "audit_log"],
  },
};

const moduleGroups: { title: string; keys: string[] }[] = (
  [
    {
      title: "Operação",
      keys: ["expenses", "sales", "approvals", "pagcorp"],
    },
    {
      title: "Cadastros",
      keys: ["suppliers", "items", "intercompany"],
    },
    {
      title: "Financeiro & Fiscal",
      keys: ["financial_review", "nf_entrada"],
    },
    {
      title: "Análise",
      keys: ["analytics", "auditoria"],
    },
    {
      title: "Administração",
      keys: ["users", "approval_rules", "integracoes", "notifications"],
    },
  ] as { title: string; keys: string[] }[]
).map((g) => ({
  ...g,
  keys: [...g.keys].sort((a, b) =>
    (modules[a]?.title ?? a).localeCompare(modules[b]?.title ?? b, "pt-BR"),
  ),
}));

function moduleHasAccess(mod: ModuleCard, userModules: string[]): boolean {
  if (mod.subModuleKeys && mod.subModuleKeys.length > 0) {
    return mod.subModuleKeys.some((k) => userModules.includes(k));
  }
  if (!mod.moduleKey) return true;
  return userModules.includes(mod.moduleKey);
}

function ModuleCardItem({ mod, index, hasAccess }: { mod: ModuleCard; index: number; hasAccess: boolean }) {
  const navigate = useNavigate();
  const Icon = mod.icon;

  return (
    <motion.button
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
      onClick={() => hasAccess && navigate(mod.path)}
      disabled={!hasAccess}
      className={`glass-card p-6 text-left transition-all group relative overflow-hidden ${
        hasAccess
          ? "hover:border-primary/40 cursor-pointer hover:scale-[1.02]"
          : "opacity-50 cursor-not-allowed"
      }`}
    >
      {/* Glow background */}
      <div className={`absolute inset-0 bg-gradient-to-br ${mod.bgGlow} opacity-0 group-hover:opacity-100 transition-opacity`} />

      <div className="relative z-10">
        <div className="flex items-start justify-between mb-4">
          <div className={`p-3 rounded-xl bg-card border border-border ${mod.color}`}>
            <Icon className="w-6 h-6" />
          </div>
          {hasAccess ? (
            <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
          ) : (
            <Lock className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
        <h3 className="text-lg font-bold text-foreground mb-2">{mod.title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{mod.description}</p>
      </div>
    </motion.button>
  );
}

export function MainMenu() {
  const { session, logout } = useSap();
  const { userModules, loading: permLoading } = useModuleAccess();

  const { getLabel } = useCompanies(true);
  const companyLabel = getLabel(session?.companyDB || "");

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 glow-primary">
              <Activity className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">ERP <span className="text-gradient">Analytics</span></h1>
              <p className="text-xs text-muted-foreground">Painel de gestão</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-foreground">{companyLabel}</p>
              <p className="text-xs text-muted-foreground">{session?.userName}</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-success animate-pulse-glow" />
              Conectado
            </div>
            <NotificationBell />
            <ChangePasswordDialog />
            <ThemeToggle />
            <button onClick={logout} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Sair
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 px-6 py-12">
        <div className="max-w-5xl mx-auto w-full">
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-10">
            <h2 className="text-3xl font-bold text-foreground">Módulos</h2>
            <p className="text-muted-foreground mt-2">Selecione um módulo para começar</p>
          </motion.div>

          <div className="space-y-12">
            {moduleGroups.map((group) => {
              const groupModules = group.keys
                .map((k) => modules[k])
                .filter((m): m is ModuleCard => Boolean(m));
              const visible = groupModules.filter(
                (m) => permLoading || moduleHasAccess(m, userModules),
              );
              if (visible.length === 0) return null;
              return (
                <section key={group.title}>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4 px-1">
                    {group.title}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {groupModules.map((mod, i) => (
                      <ModuleCardItem
                        key={`${group.title}-${mod.title}`}
                        mod={mod}
                        index={i}
                        hasAccess={permLoading || moduleHasAccess(mod, userModules)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </main>

    </div>
  );
}
