import { useEffect, useState } from "react";
import { KeyRound, ShieldCheck, Building2, ChevronRight, ChevronLeft, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSap } from "@/contexts/SapContext";
import { hasSeenTour, markTourSeen } from "@/lib/tour-state";

/** Versão do tour. Incremente para exibir novamente a todos os usuários. */
const TOUR_VERSION = "2026-08-07-novo-login";
/** Chave do tour — persistida no perfil do usuário (vale em qualquer dispositivo). */
export const whatsNewTourKey = `whatsnew:${TOUR_VERSION}`;

const steps = [
  {
    icon: Sparkles,
    title: "Novo fluxo de login",
    description:
      "Agora você entra no ERP Flow apenas com a sua conta Google corporativa. Não é mais necessário informar usuário e senha do ERP para abrir o sistema.",
  },
  {
    icon: Building2,
    title: "Escolha da empresa",
    description:
      "Depois de entrar, selecione a empresa que deseja acessar. Você pode trocar de empresa a qualquer momento pelo menu da sua conta, no canto superior direito.",
  },
  {
    icon: KeyRound,
    title: "Senha do ERP só quando necessário",
    description:
      "A conexão com o ERP acontece somente quando a ação exige (aprovar documentos do SAP, integrar pedidos, dar baixas). Se a sua senha já estiver provisionada, isso ocorre de forma invisível; caso contrário, aparece um modal rápido pedindo o acesso daquela empresa.",
  },
  {
    icon: ShieldCheck,
    title: "Sessão sempre ativa",
    description:
      "No menu da sua conta há o botão “Manter sessão do Google ativa”, que evita que você seja desconectado. Com ele ligado, você também recebe avisos em tempo real das suas aprovações.",
  },
];

/** Evento global para reabrir o tour a partir das configurações do usuário. */
export const WHATSNEW_REPLAY_EVENT = "erp:whatsnew-replay";

export function WhatsNewWizard() {
  const { session } = useSap();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  const user = session?.userName || "";

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const seen = await hasSeenTour(whatsNewTourKey);
      if (cancelled || seen) return;
      setStep(0);
      setOpen(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  /* Reinício manual pelo menu da conta. */
  useEffect(() => {
    const handler = () => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener(WHATSNEW_REPLAY_EVENT, handler);
    return () => window.removeEventListener(WHATSNEW_REPLAY_EVENT, handler);
  }, []);


  const close = () => {
    void markTourSeen(whatsNewTourKey);
    setOpen(false);
  };

  if (!user) return null;

  const current = steps[step];
  const Icon = current.icon;
  const isLast = step === steps.length - 1;

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
          <div className="flex items-center gap-1.5" role="tablist" aria-label="Progresso do tour">
            {steps.map((s, i) => (
              <span
                key={s.title}
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
                Pular tour
              </Button>
            )}

            <Button size="sm" onClick={() => (isLast ? close() : setStep((s) => s + 1))}>
              {isLast ? "Entendi" : "Próximo"}
              {!isLast && <ChevronRight className="w-4 h-4 ml-1" />}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
