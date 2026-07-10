import { useNavigate } from "react-router-dom";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  BarChart3,
  ShoppingCart,
  ClipboardCheck,
  Shield,
  CreditCard,
  Users,
  Plug,
  Building2,
  Box,
  Wallet,
  Bell,
  FileInput,
  Radar,
  UserCog,
  LogOut,
  KeyRound,
  Sun,
  Moon,
  type LucideIcon,
} from "lucide-react";
import { useSap } from "@/contexts/SapContext";
import { useModuleAccess } from "@/hooks/usePermissions";
import { useCompanies } from "@/hooks/useCompanies";
import { useTheme } from "next-themes";
import { useState } from "react";
import { ChangePasswordDialog } from "@/components/ChangePasswordDialog";
import { cn } from "@/lib/utils";

interface Entry {
  label: string;
  icon: LucideIcon;
  path: string;
  color: string;
  moduleKey?: string;
  subModuleKeys?: string[];
}

const groups: { title: string; items: Entry[] }[] = [
  {
    title: "Operação",
    items: [
      { label: "Compras", icon: ShoppingCart, path: "/compras", color: "text-emerald-400", moduleKey: "expenses" },
      { label: "Vendas", icon: Wallet, path: "/vendas", color: "text-emerald-400", moduleKey: "sales" },
      { label: "Aprovações", icon: ClipboardCheck, path: "/aprovacoes", color: "text-emerald-400", subModuleKeys: ["approvals", "approval_history"] },
      { label: "Cartões", icon: CreditCard, path: "/cartoes/transacoes", color: "text-cyan-400", moduleKey: "pagcorp" },
    ],
  },
  {
    title: "Cadastros",
    items: [
      { label: "Fornecedores", icon: Building2, path: "/cadastros/fornecedores", color: "text-indigo-400", moduleKey: "suppliers" },
      { label: "Itens", icon: Box, path: "/cadastros/itens", color: "text-indigo-400", moduleKey: "items" },
      { label: "Plano de Contas & CC", icon: Building2, path: "/cadastros/intercompany", color: "text-indigo-400", moduleKey: "intercompany" },
    ],
  },
  {
    title: "Financeiro & Fiscal",
    items: [
      { label: "Adiantamentos", icon: Wallet, path: "/financeiro/adiantamentos", color: "text-amber-400", moduleKey: "expenses" },
      { label: "Reconciliação", icon: Wallet, path: "/financeiro/reconciliacao", color: "text-cyan-400", moduleKey: "financial_review" },
      { label: "NF de Entrada", icon: FileInput, path: "/financeiro/nf-entrada", color: "text-orange-400", moduleKey: "nf_entrada" },
    ],
  },
  {
    title: "Análise",
    items: [
      { label: "Analytics", icon: BarChart3, path: "/analytics", color: "text-sky-400", moduleKey: "analytics" },
      { label: "Auditoria", icon: Radar, path: "/auditoria", color: "text-sky-400", subModuleKeys: ["audit_console", "fiscal_audit", "audit_log"] },
    ],
  },
  {
    title: "Administração",
    items: [
      { label: "Usuários", icon: Users, path: "/usuarios/lista", color: "text-violet-400", moduleKey: "users" },
      { label: "Regras de Aprovação", icon: Shield, path: "/aprovacoes/regras", color: "text-violet-400", moduleKey: "approval_rules" },
      { label: "Integrações", icon: Plug, path: "/integracoes", color: "text-violet-400", subModuleKeys: ["synapse", "integration_history", "credentials"] },
      { label: "Notificações", icon: Bell, path: "/notificacoes", color: "text-violet-400", moduleKey: "notifications" },
    ],
  },
];

function hasAccess(entry: Entry, mods: string[]): boolean {
  if (entry.subModuleKeys?.length) return entry.subModuleKeys.some((k) => mods.includes(k));
  if (!entry.moduleKey) return true;
  return mods.includes(entry.moduleKey);
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function MobileMenuSheet({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const { session, logout } = useSap();
  const { userModules, loading } = useModuleAccess();
  const { getLabel } = useCompanies(true);
  const { theme, setTheme } = useTheme();
  const [changePwdOpen, setChangePwdOpen] = useState(false);

  const companyLabel = getLabel(session?.companyDB || "");

  function go(path: string) {
    onOpenChange(false);
    setTimeout(() => navigate(path), 50);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-sm p-0 flex flex-col">
        <SheetHeader className="px-4 pt-4 pb-3 border-b border-border text-left">
          <SheetTitle className="text-base">Menu</SheetTitle>
          <div className="mt-2">
            <p className="text-sm font-medium text-foreground truncate">{companyLabel}</p>
            <p className="text-xs text-muted-foreground truncate">{session?.userName}</p>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-5">
          {groups.map((g) => {
            const visible = g.items.filter((it) => loading || hasAccess(it, userModules));
            if (!visible.length) return null;
            return (
              <div key={g.title}>
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-3 mb-2">
                  {g.title}
                </h4>
                <ul className="space-y-0.5">
                  {visible.map((it) => {
                    const Icon = it.icon;
                    return (
                      <li key={it.path}>
                        <button
                          onClick={() => go(it.path)}
                          className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left hover:bg-muted active:bg-muted transition-colors min-h-11"
                        >
                          <span className={cn("p-2 rounded-md bg-card border border-border", it.color)}>
                            <Icon className="w-4 h-4" />
                          </span>
                          <span className="text-sm font-medium text-foreground">{it.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>

        <div className="border-t border-border p-2 space-y-0.5 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
          <button
            onClick={() => go("/perfil")}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-muted min-h-11 text-left"
          >
            <UserCog className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm">Meu perfil</span>
          </button>
          <button
            onClick={() => setChangePwdOpen(true)}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-muted min-h-11 text-left"
          >
            <KeyRound className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm">Alterar senha</span>
          </button>
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-muted min-h-11 text-left"
          >
            {theme === "dark" ? (
              <Sun className="w-4 h-4 text-muted-foreground" />
            ) : (
              <Moon className="w-4 h-4 text-muted-foreground" />
            )}
            <span className="text-sm">
              Tema: {theme === "dark" ? "escuro" : "claro"}
            </span>
          </button>
          <button
            onClick={() => {
              onOpenChange(false);
              logout();
            }}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-destructive/10 text-destructive min-h-11 text-left"
          >
            <LogOut className="w-4 h-4" />
            <span className="text-sm font-medium">Sair</span>
          </button>
        </div>
        {/* Hidden trigger: open password dialog imperatively */}
        {changePwdOpen && (
          <ChangePasswordDialog
            controlledOpen={changePwdOpen}
            onOpenChange={setChangePwdOpen}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
