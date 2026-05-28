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
  Key,
  Users,
  Zap,
  Radio,
  ScrollText,
  Lock,
  Building2,
  Wallet,
  Bell,
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
  moduleKey: string;
}

const modules: Record<string, ModuleCard> = {
  analytics: {
    title: "Analytics",
    description: "Visão geral de métricas, tempos por etapa e insights de performance do fluxo de compras.",
    icon: BarChart3,
    path: "/analytics",
    color: "text-primary",
    bgGlow: "from-primary/20 to-primary/5",
    moduleKey: "analytics",
  },
  expenses: {
    title: "Compras",
    description: "Crie e acompanhe solicitações de compras com fluxo de aprovação e integração SAP.",
    icon: ShoppingCart,
    path: "/expenses",
    color: "text-success",
    bgGlow: "from-success/20 to-success/5",
    moduleKey: "expenses",
  },
  sales: {
    title: "Vendas",
    description: "Crie e acompanhe pedidos de venda com fluxo de aprovação e integração SAP.",
    icon: Wallet,
    path: "/sales",
    color: "text-primary",
    bgGlow: "from-primary/20 to-primary/5",
    moduleKey: "sales",
  },
  approvals: {
    title: "Aprovações",
    description: "Documentos pendentes de aprovação com detalhes de valor, fornecedor, aprovador e vencimento.",
    icon: ClipboardCheck,
    path: "/approvals",
    color: "text-warning",
    bgGlow: "from-warning/20 to-warning/5",
    moduleKey: "approvals",
  },
  approval_rules: {
    title: "Regras de Aprovação",
    description: "Configure regras de aprovação em N níveis com critérios de valor, centro de custo e tipo de documento.",
    icon: Shield,
    path: "/approval-rules",
    color: "text-destructive",
    bgGlow: "from-destructive/20 to-destructive/5",
    moduleKey: "approval_rules",
  },
  pagcorp: {
    title: "PagCorp",
    description: "Transações de cartões corporativos com filtro de prestação de conta e lançamento no SAP.",
    icon: CreditCard,
    path: "/pagcorp",
    color: "text-primary",
    bgGlow: "from-primary/20 to-primary/5",
    moduleKey: "pagcorp",
  },
  users: {
    title: "Usuários",
    description: "Gerencie usuários SAP: bloqueio, desbloqueio e redefinição de senhas.",
    icon: Users,
    path: "/users",
    color: "text-warning",
    bgGlow: "from-warning/20 to-warning/5",
    moduleKey: "users",
  },
  suppliers: {
    title: "Fornecedores",
    description: "Cadastro de fornecedores com sincronização SAP e extração via IA a partir de notas fiscais.",
    icon: Building2,
    path: "/suppliers",
    color: "text-success",
    bgGlow: "from-success/20 to-success/5",
    moduleKey: "suppliers",
  },
  synapse: {
    title: "Synapse",
    description: "Central de automações e integrações entre sistemas (JumpCloud, SAP, IdP).",
    icon: Zap,
    path: "/synapse",
    color: "text-primary",
    bgGlow: "from-primary/20 to-primary/5",
    moduleKey: "synapse",
  },
  integration_history: {
    title: "Monitor de Integrações",
    description: "Acompanhamento unificado de todas as integrações com o SAP (despesas manuais e PagCorp), com status detalhado por estágio.",
    icon: Radio,
    path: "/integrations/monitor",
    color: "text-success",
    bgGlow: "from-success/20 to-success/5",
    moduleKey: "integration_history",
  },
  intercompany: {
    title: "Intercompany",
    description: "Plano de contas e centros de custo consolidados entre empresas, com criação simultânea em todas.",
    icon: Building2,
    path: "/intercompany",
    color: "text-primary",
    bgGlow: "from-primary/20 to-primary/5",
    moduleKey: "intercompany",
  },
  financial_review: {
    title: "Avaliação Financeira",
    description: "Adiantamentos em aberto (clientes/fornecedores) sem vínculo a notas, com passo a passo de reconciliação.",
    icon: Wallet,
    path: "/financial-review",
    color: "text-success",
    bgGlow: "from-success/20 to-success/5",
    moduleKey: "financial_review",
  },
  credentials: {
    title: "Credenciais",
    description: "Gerencie conexões com sistemas externos (PagCorp, SAP) de forma segura.",
    icon: Key,
    path: "/credentials",
    color: "text-muted-foreground",
    bgGlow: "from-muted/20 to-muted/5",
    moduleKey: "credentials",
  },
  audit_log: {
    title: "Logs de Auditoria",
    description: "Registro completo de todas as ações realizadas no sistema para análise e auditoria.",
    icon: ScrollText,
    path: "/audit-log",
    color: "text-violet-400",
    bgGlow: "from-violet-500/20 to-violet-500/5",
    moduleKey: "audit_log",
  },
  notifications: {
    title: "Notificações",
    description: "Central de notificações, preferências, auditoria e histórico de envios (WhatsApp, e-mail).",
    icon: Bell,
    path: "/notifications",
    color: "text-primary",
    bgGlow: "from-primary/20 to-primary/5",
    moduleKey: "notifications",
  },
};

const moduleGroups: { title: string; keys: string[] }[] = (
  [
    {
      title: "Geral",
      keys: ["analytics", "expenses", "sales", "approvals", "suppliers"],
    },
    {
      title: "Financeiro / Contábil",
      keys: ["pagcorp", "integration_history", "financial_review", "intercompany"],
    },
    {
      title: "Admin",
      keys: ["approval_rules", "users", "synapse", "integration_history", "credentials", "audit_log"],
    },
  ] as { title: string; keys: string[] }[]
).map((g) => ({
  ...g,
  keys: [...g.keys].sort((a, b) =>
    (modules[a]?.title ?? a).localeCompare(modules[b]?.title ?? b, "pt-BR"),
  ),
}));


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
                (m) => permLoading || userModules.includes(m.moduleKey),
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
                        hasAccess={permLoading || userModules.includes(mod.moduleKey)}
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
