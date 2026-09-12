import { useCompanies } from "@/hooks/useCompanies";
import { motion } from "framer-motion";

import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
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
  UserCog,
  ClipboardList,
  type LucideIcon,
  TrendingUp,
  Landmark,
  LayoutGrid,
} from "lucide-react";
import { useSap } from "@/contexts/SapContext";
import { useModuleAccess } from "@/hooks/usePermissions";

import { NotificationBell } from "@/components/NotificationBell";
import { OfflineQueueIndicator } from "@/components/OfflineQueueIndicator";


import { modules, moduleGroups, moduleHasAccess, firstAccessiblePath, type ModuleCard } from "@/lib/modules-catalog";


function ModuleCardItem({
  mod,
  index,
  hasAccess,
  targetPath,
  color,
  bgGlow,
}: {
  mod: ModuleCard;
  index: number;
  hasAccess: boolean;
  targetPath: string;
  color?: string;
  bgGlow?: string;
}) {
  const navigate = useNavigate();
  const Icon = mod.icon;

  return (
    <motion.button
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.05, 0.3) }}
      onClick={() => {
        if (!hasAccess) return;
        navigate(targetPath);
      }}
      disabled={!hasAccess}
      className={`glass-card p-4 sm:p-6 text-left transition-all group relative overflow-hidden active:scale-[0.98] ${
        hasAccess
          ? "hover:border-primary/40 cursor-pointer hover:scale-[1.02]"
          : "opacity-50 cursor-not-allowed"
      }`}
    >
      {/* Glow background */}
      <div className={`absolute inset-0 bg-gradient-to-br ${bgGlow ?? mod.bgGlow} opacity-0 group-hover:opacity-100 transition-opacity`} />

      <div className="relative z-10">
        <div className="flex items-start justify-between mb-3 sm:mb-4">
          <div className={`p-2.5 sm:p-3 rounded-xl bg-card border border-border ${color ?? mod.color}`}>
            <Icon className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>

          {!hasAccess ? (
            <Lock className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
          )}
        </div>
        <h3 className="text-base sm:text-lg font-bold text-foreground mb-1 sm:mb-2">{mod.title}</h3>
        <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed line-clamp-3 sm:line-clamp-none">{mod.description}</p>
      </div>
    </motion.button>
  );
}


export function MainMenu() {
  const navigate = useNavigate();
  const { session } = useSap();
  const { userModules, loading: permLoading } = useModuleAccess();


  const { getLabel } = useCompanies(true);
  const companyLabel = getLabel(session?.companyDB || "");

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <PageHeader
        icon={<LayoutGrid className="h-4 w-4 text-primary" />}
        title="Painel"
        subtitle={companyLabel || "Painel de gestão"}
        showBack={false}
        actions={
          <>
            <OfflineQueueIndicator />
            <NotificationBell />
            <button
              onClick={() => navigate("/perfil")}
              title="Meu perfil e senha do ERP"
              className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              <UserCog className="w-4 h-4" />
            </button>
          </>
        }
      />

      {/* Content */}
      <main className="flex-1 px-4 sm:px-6 py-6 sm:py-12 pb-24 md:pb-12">
        <div className="max-w-7xl mx-auto w-full">
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-6 sm:mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground">Módulos</h2>
            <p className="text-sm sm:text-base text-muted-foreground mt-1 sm:mt-2">Selecione um módulo para começar</p>
          </motion.div>

          <div className="space-y-8 sm:space-y-12">
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
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 sm:mb-4 px-1">
                    {group.title}
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-6">
                    {visible.map((mod, i) => (
                      <ModuleCardItem
                        key={`${group.title}-${mod.title}`}
                        mod={mod}
                        index={i}
                        hasAccess={true}
                        targetPath={firstAccessiblePath(mod, userModules, permLoading)}
                        color={group.color}
                        bgGlow={group.bgGlow}

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
