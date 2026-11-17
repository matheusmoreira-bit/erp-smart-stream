import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { LockKeyhole, UnlockKeyhole, Loader2, RefreshCw, UserPlus, Trash2, ShieldCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BackofficePageHeader } from '@/components/BackofficePageHeader';
import { AdminMfaGate } from '@/components/AdminMfaGate';
import { accessStatusSchema, type ErpAccessStatus } from '@/lib/erp-access-control';

export default function ErpAccessControl() {
  return <AdminMfaGate><AccessManagement /></AdminMfaGate>;
}

function AccessManagement() {
  const [status, setStatus] = useState<ErpAccessStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [confirmation, setConfirmation] = useState<'enable' | 'disable' | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const result = await supabase.rpc('erp_access_status');
      if (result.error) throw result.error;
      setStatus(accessStatusSchema.parse(result.data));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a configuração.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const change = async (action: 'enable' | 'disable' | 'allow' | 'remove', target?: string) => {
    if (!status || busy || loading || error) return;
    setBusy(true); setError(null);
    try {
      const result = await supabase.rpc('manage_erp_access', { _action: action, _expected_version: status.version, _email: target ?? null });
      if (result.error) throw result.error;
      setStatus(accessStatusSchema.parse(result.data)); setEmail(''); setConfirmation(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar. Atualize a configuração.'); }
    finally { setBusy(false); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void change('allow', email.trim()); };
  return <div className="min-h-screen bg-background text-foreground">
    <BackofficePageHeader title="Controle de acesso" icon={<LockKeyhole className="h-5 w-5" />} actions={<Button variant="outline" size="icon" title="Atualizar configuração" aria-label="Atualizar configuração" disabled={busy || loading} onClick={() => { void load(); }}><RefreshCw className={loading ? 'animate-spin' : ''} /></Button>} />
    <main className="max-w-4xl mx-auto p-4 md:p-8 space-y-8">
      {error && <div role="alert" className="border border-destructive rounded-md p-4 text-destructive">{error}<Button variant="outline" className="ml-3" disabled={busy} onClick={() => { void load(); }}>Atualizar</Button></div>}
      {loading ? <div role="status" aria-label="Carregando configuração"><Loader2 className="h-6 w-6 animate-spin" /></div> : status && !status.manager ? <p role="alert">Acesso negado — somente administradores autorizados com MFA.</p> : status && <>
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">{status.enabled ? 'Acesso restrito ativo' : 'Acesso geral — permissões atuais'}</h2>
            <Button variant={status.enabled ? 'outline' : 'default'} disabled={busy || !!error || (!status.enabled && !status.ready)} onClick={() => setConfirmation(status.enabled ? 'disable' : 'enable')}>
              {status.enabled ? <UnlockKeyhole /> : <LockKeyhole />}{status.enabled ? 'Restaurar acesso geral' : 'Ativar restrição'}
            </Button>
          </div>
          {!status.ready && <p role="status" className="text-sm text-muted-foreground">Ativação indisponível: {status.coverage_note}</p>}
          {confirmation && <div role="alertdialog" aria-labelledby="access-confirm" className="border border-border rounded-md p-4 space-y-3">
            <h3 id="access-confirm" className="font-medium">{confirmation === 'enable' ? 'Bloquear todos, exceto a lista abaixo?' : 'Restaurar as permissões anteriores de todos?'}</h3>
            <div className="flex gap-3"><Button disabled={busy} onClick={() => { void change(confirmation); }}>{busy && <Loader2 className="animate-spin" />}Confirmar</Button><Button variant="ghost" disabled={busy} onClick={() => setConfirmation(null)}>Cancelar</Button></div>
          </div>}
        </section>
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Pessoas permitidas no modo restrito</h2>
          {(status.users ?? []).length === 0 ? <p className="text-muted-foreground">Nenhuma pessoa cadastrada.</p> : <ul className="divide-y divide-border border-y border-border">
            {(status.users ?? []).map(person => <li key={person.id} className="flex items-center justify-between gap-3 py-4">
              <div className="min-w-0"><p className="text-sm break-all">{person.email}</p>{person.manager && <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1"><ShieldCheck className="h-3 w-3" />Administrador · recuperação de acesso</p>}</div>
              {!person.manager && <Button variant="ghost" size="icon" title={`Remover ${person.email} da lista`} aria-label={`Remover ${person.email} da lista`} disabled={busy || !!error} onClick={() => { void change('remove', person.email); }}><Trash2 className="text-destructive" /></Button>}
            </li>)}
          </ul>}
          <form onSubmit={submit} className="space-y-2">
            <Label htmlFor="access-email">Liberar pessoa</Label>
            <div className="flex flex-col sm:flex-row gap-3"><Input id="access-email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={event => setEmail(event.target.value)} placeholder="E-mail corporativo completo" disabled={busy} className="min-w-0" /><Button type="submit" disabled={busy || !!error || !email.trim()}><UserPlus />Liberar</Button></div>
          </form>
        </section>
      </>}
    </main>
  </div>;
}