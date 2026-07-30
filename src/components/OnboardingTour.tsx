import { useEffect, useMemo, useState } from "react";
import {
  Compass,
  ShoppingCart,
  CheckCircle2,
  Receipt,
  CreditCard,
  BarChart3,
  Bell,
  Settings2,
  LifeBuoy,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSap } from "@/contexts/SapContext";
import { useModuleAccess } from "@/hooks/usePermissions";
import { supabase } from "@/integrations/supabase/client";
import { whatsNewStorageKey } from "@/components/WhatsNewWizard";

/**
 * Onboarding guiado por perfil.
 *
 * Tour curto (3–5 passos) exibido no primeiro acesso, montado a partir dos
 * módulos que o grupo de permissão do usuário realmente enxerga. Sem passos
 * para telas que a pessoa não pode abrir.
 *
 * Persistência: localStorage por usuário + versão. Pode ser reaberto via
 * evento global `erp:onboarding-replay` (item do menu da conta).
 */

const ONBOARDING_VERSION = "v1";
const onboardingKey = (user: string) =>
  `erp-onboarding:${ONBOARDING_VERSION}:${user.toLowerCase()}`;

export const ONBOARDING_REPLAY_EVENT = "erp:onboarding-replay";

interface TourStep {
  key: string;
  icon: LucideIcon;
  title: string;
  description: string;
  /** Rota sugerida — abre a tela ao finalizar, se o usuário quiser. */
  route?: string;
}

/** Catálogo de passos por módulo. Ordem = ordem de exibição. */
const MODULE_STEPS: Array<{ module: string; step: TourStep }> = [
  {
    module: "expenses",
    step: {
      key: "expenses",
      icon: ShoppingCart,
      title: "Lance seus pedidos de compra",
      description:
        "Em “Compras” você cria pedidos, anexa a nota e acompanha o status até a integração com o ERP. Dá para salvar rascunho e duplicar um pedido já lançado.",
      route: "/compras",
    },
  },
  {
    module: "approvals",
    step: {
      key: "approvals",
      icon: CheckCircle2,
      title: "Aprovações na sua alçada",
      description:
        "A tela “Aprovações” lista o que depende de você, ordenado por vencimento. Você também pode aprovar direto pelo e-mail, no celular.",
      route: "/aprovacoes",
    },
  },
  {
    module: "sales",
    step: {
      key: "sales",
      icon: Receipt,
      title: "Ciclo de vendas e NFSe",
      description:
        "Em “Vendas” você acompanha pedidos, emissão de NFSe, envio ao cliente e a baixa dos títulos, com o mapa de relações de cada documento.",
      route: "/vendas",
    },
  },
  {
    module: "nf_entrada",
    step: {
      key: "nf_entrada",
      icon: Receipt,
      title: "NF de Entrada",
      description:
        "Concilie as notas capturadas com os pedidos de compra e lance o esboço da NF de entrada no ERP em um clique.",
      route: "/financeiro/nf-entrada",
    },
  },
  {
    module: "pagcorp",
    step: {
      key: "pagcorp",
      icon: CreditCard,
      title: "Cartões corporativos",
      description:
        "As transações do cartão chegam automaticamente. Você complementa o rateio, anexa o comprovante e envia para prestação de contas.",
      route: "/cartoes",
    },
  },
  {
    module: "analytics",
    step: {
      key: "analytics",
      icon: BarChart3,
      title: "Indicadores do fluxo",
      description:
        "Analytics mostra volume, tempo médio de aprovação e gargalos por centro de custo e projeto.",
      route: "/analytics",
    },
  },
  {
    module: "users",
    step: {
      key: "users",
      icon: Settings2,
      title: "Usuários e grupos",
      description:
        "Na tela de usuários da empresa você define o grupo de permissão de cada pessoa — a mudança vale para todas as empresas.",
      route: "/usuarios",
    },
  },
];

const CLOSING_STEP: TourStep = {
  key: "help",
  icon: LifeBuoy,
  title: "Precisa de ajuda?",
  description:
    "O sino no topo reúne as notificações dos seus documentos e o menu da conta permite trocar de empresa. Você pode rever este tour a qualquer momento no menu da conta.",
};

const NOTIFICATIONS_STEP: TourStep = {
  key: "notifications",
  icon: Bell,
  title: "Acompanhe cada etapa",
  description:
    "Você recebe aviso por e-mail e no sino de notificações a cada marco do documento: aprovação pendente, aprovada, integrada e baixada.",
};

export function OnboardingTour() {
  const { session } = useSap();
  const { userModules, loading } = useModuleAccess();
  const [groupName, setGroupName] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  const user = session?.userName || "";

  /* Nome do grupo — apenas para personalizar a saudação. */
  useEffect(() => {
    if (!user) {
      setGroupName(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("user_group_assignments")
        .select("sap_email, permission_groups(name)");
      if (cancelled) return;
      const id = user.toLowerCase();
      const mine = (data || []).find((a: any) => {
        const email = String(a.sap_email || "").toLowerCase();
        return email === id || email.startsWith(id + "@");
      }) as any;
      setGroupName(mine?.permission_groups?.name ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const steps = useMemo<TourStep[]>(() => {
    const allowed = new Set(userModules || []);
    const picked = MODULE_STEPS.filter((m) => allowed.has(m.module)).map((m) => m.step);
    const trimmed = picked.slice(0, 4);
    const intro: TourStep = {
      key: "intro",
      icon: Compass,
      title: session?.userName
        ? `Boas-vindas, ${session.userName.split(/[.@]/)[0]}!`
        : "Boas-vindas!",
      description: groupName
        ? `Seu acesso é do perfil “${groupName}”. Este tour rápido mostra apenas as telas liberadas para você.`
        : "Este tour rápido mostra as telas liberadas para o seu perfil de acesso.",
    };
    return [intro, ...trimmed, NOTIFICATIONS_STEP, CLOSING_STEP];
  }, [userModules, groupName, session?.userName]);

  /* Primeiro acesso — só depois que o "novidades" já foi visto. */
  useEffect(() => {
    if (!user || loading) return;
    try {
      if (localStorage.getItem(onboardingKey(user))) return;
      if (!localStorage.getItem(whatsNewStorageKey(user))) return;
    } catch {
      return;
    }
    setStep(0);
    setOpen(true);
  }, [user, loading]);

  /* Replay pelo menu da conta. */
  useEffect(() => {
    const handler = () => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener(ONBOARDING_REPLAY_EVENT, handler);
    return () => window.removeEventListener(ONBOARDING_REPLAY_EVENT, handler);
  }, []);

  const close = () => {
    try {
      if (user) localStorage.setItem(onboardingKey(user), new Date().toISOString());
    } catch {
      /* ignore */
    }
    setOpen(false);
  };

  if (!user) return null;

  const current = steps[Math.min(step, steps.length - 1)];
  const Icon = current.icon;
  const isLast = step >= steps.length - 1;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
              <Icon className="w-5 h-5" aria-hidden="true" />
            </div>
            <DialogTitle className="text-left">{current.title}</DialogTitle>
          </div>
          <DialogDescription className="text-left pt-2 leading-relaxed">
            {current.description}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-1.5" role="tablist" aria-label="Progresso do onboarding">
            {steps.map((s, i) => (
              <span
                key={s.key}
                aria-current={i === step}
                className={`h-1.5 rounded-full transition-all ${
                  i === step ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/30"
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {step > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setStep((s) => s - 1)}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Voltar
              </Button>
            )}
            {!isLast && (
              <Button variant="ghost" size="sm" onClick={close}>
                Pular
              </Button>
            )}
            {current.route && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  close();
                  window.location.assign(current.route!);
                }}
              >
                Abrir tela
              </Button>
            )}
            <Button size="sm" onClick={() => (isLast ? close() : setStep((s) => s + 1))}>
              {isLast ? "Começar" : "Próximo"}
              {!isLast && <ChevronRight className="w-4 h-4 ml-1" />}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
