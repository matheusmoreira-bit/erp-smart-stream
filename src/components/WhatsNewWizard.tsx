import { useEffect, useState } from "react";
import { Building2, LogOut, ChevronRight, ChevronLeft, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSap } from "@/contexts/SapContext";

/** Versão do tour. Incremente para exibir novamente a todos os usuários. */
const TOUR_VERSION = "2026-07-30-company-switch";
export const whatsNewStorageKey = (user: string) =>
  `erp-whatsnew:${TOUR_VERSION}:${user.toLowerCase()}`;
const storageKey = whatsNewStorageKey;

const steps = [
  {
    icon: Sparkles,
    title: "Novidades na barra superior",
    description:
      "Padronizamos o cabeçalho de todas as telas: a logo fica sempre à esquerda e as informações da sua conta à direita.",
  },
  {
    icon: Building2,
    title: "Troca de empresa em um clique",
    description:
      "Clique no bloco com o nome da empresa e do usuário (canto superior direito) e escolha “Trocar de empresa”. A lista abre ali mesmo: empresas com escudo já têm senha provisionada e entram direto; as com chave pedem seu usuário e senha do ERP.",
  },
  {
    icon: LogOut,
    title: "O botão Sair mudou de lugar",
    description:
      "O “Sair” agora fica dentro desse mesmo menu da conta, logo abaixo da troca de empresa. Ao sair, você volta para a tela de login.",
  },
];

export function WhatsNewWizard() {
  const { session } = useSap();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  const user = session?.userName || "";

  useEffect(() => {
    if (!user) return;
    try {
      if (localStorage.getItem(storageKey(user))) return;
    } catch {
      return;
    }
    setStep(0);
    setOpen(true);
  }, [user]);

  const close = () => {
    try {
      if (user) localStorage.setItem(storageKey(user), new Date().toISOString());
    } catch {
      /* ignore */
    }
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
                Pular
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
