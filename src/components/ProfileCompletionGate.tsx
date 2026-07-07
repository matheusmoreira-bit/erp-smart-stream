import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUserProfile } from "@/hooks/useUserProfile";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { UserCog } from "lucide-react";

/**
 * Modal exibido no login quando o perfil intercompany está incompleto
 * (falta telefone OU e-mail). Dispensável por 7 dias.
 */
export function ProfileCompletionGate() {
  const { profile, isPending, dismissForWeek, loading } = useUserProfile();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (loading || !profile) return;
    if (!isPending) { setOpen(false); return; }
    const dismissed = profile.dismissed_until && new Date(profile.dismissed_until).getTime() > Date.now();
    if (dismissed) { setOpen(false); return; }
    const today = new Date().toISOString().slice(0, 10);
    const shownKey = `profile-gate-shown:${profile.user_id || profile.email || "anon"}`;
    const lastShown = typeof window !== "undefined" ? localStorage.getItem(shownKey) : null;
    if (lastShown === today) { setOpen(false); return; }
    setOpen(true);
    try { localStorage.setItem(shownKey, today); } catch { /* ignore */ }
  }, [loading, profile, isPending]);

  const goToProfile = () => {
    setOpen(false);
    navigate("/perfil");
  };

  const remindLater = async () => {
    try { await dismissForWeek(); } finally { setOpen(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) remindLater(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <UserCog className="w-5 h-5 text-primary" />
            </div>
            <div>
              <DialogTitle>Finalize seu cadastro</DialogTitle>
              <DialogDescription>
                Para receber lembretes de aprovação e vencimento, precisamos do seu telefone e e-mail.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="text-sm text-muted-foreground space-y-1 py-2">
          <p>Faltam <strong>{[!profile?.phone && "telefone", !profile?.email && "e-mail"].filter(Boolean).join(" e ")}</strong>.</p>
          <p className="text-xs">Você pode dispensar e lembraremos daqui a 7 dias.</p>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={remindLater}>Lembrar depois</Button>
          <Button onClick={goToProfile}>Preencher agora</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
