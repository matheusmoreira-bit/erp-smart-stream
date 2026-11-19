import { useEffect, useState, type ReactNode } from 'react';
import { Loader2, LockKeyhole, LogOut, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { accessStatusSchema } from '@/lib/erp-access-control';
import { useLocation } from 'react-router-dom';

/** Web presentation restriction is independent of authoritative resource guards. */
export function ErpAccessGate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [state, setState] = useState<'loading' | 'allowed' | 'blocked' | 'error'>('loading');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let sequence = 0;
    const evaluate = async () => {
      const run = ++sequence;
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        // Auth and signed-token routes have their own server-side verification.
        if (!session || pathname === '/login' || pathname.startsWith('/aprovar/')) {
          if (!cancelled && run === sequence) setState('allowed');
          return;
        }
        const { data, error } = await supabase.rpc('erp_access_status');
        if (error) throw error;
        const status = accessStatusSchema.parse(data);
        const web = await supabase.rpc('erp_web_access_status');
        if (web.error) throw web.error;
        const webStatus = accessStatusSchema.parse(web.data);
        if (!cancelled && run === sequence) setState(status.admitted && webStatus.admitted ? 'allowed' : 'blocked');
      } catch {
        if (!cancelled && run === sequence) setState('error');
      }
    };
    void evaluate();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      setState('loading');
      setTimeout(() => { if (!cancelled) void evaluate(); }, 0);
    });
    const interval = window.setInterval(() => { void evaluate(); }, 15000);
    const focus = () => { void evaluate(); };
    window.addEventListener('focus', focus);
    return () => { cancelled = true; sequence++; subscription.unsubscribe(); window.clearInterval(interval); window.removeEventListener('focus', focus); };
  }, [reload, pathname]);

  if (state === 'allowed') return <>{children}</>;
  if (state === 'loading') return <div className="min-h-screen bg-background flex items-center justify-center" role="status" aria-label="Verificando acesso"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  return <main className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center gap-5 p-6 text-center">
    <LockKeyhole className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
    <h1 className="text-xl font-semibold">{state === 'blocked' ? 'Acesso temporariamente bloqueado' : 'Não foi possível verificar seu acesso'}</h1>
    <div className="flex flex-wrap justify-center gap-3">
      <Button variant="outline" onClick={() => { setState('loading'); setReload(value => value + 1); }}><RefreshCw />Tentar novamente</Button>
      <Button variant="ghost" onClick={() => { void supabase.auth.signOut(); }}><LogOut />Sair</Button>
    </div>
  </main>;
}