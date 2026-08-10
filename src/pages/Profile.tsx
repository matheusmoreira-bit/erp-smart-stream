import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useUserProfile } from "@/hooks/useUserProfile";
import { useSap } from "@/contexts/SapContext";
import { useCompanies } from "@/hooks/useCompanies";
import { PageTitle } from "@/components/PageTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChangePasswordDialog } from "@/components/ChangePasswordDialog";
import { toast } from "sonner";
import { ArrowLeft, KeyRound, RefreshCw, Save, User } from "lucide-react";


export default function Profile() {
  const navigate = useNavigate();
  const { session } = useSap();
  const { getLabel } = useCompanies(true);
  const { profile, loading, save, syncFromSap, refresh } = useUserProfile();
  const [form, setForm] = useState({
    display_name: "",
    email: "",
    phone: "",
    avatar_url: "",
    notify_whatsapp_overdue: true,
    notify_whatsapp_approvals: true,
    notify_email_overdue: true,
    notify_email_approvals: true,
  });
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncedOnce, setSyncedOnce] = useState(false);
  const [params, setParams] = useSearchParams();
  const [passwordOpen, setPasswordOpen] = useState(params.get("senha") === "1");
  const securityRef = useRef<HTMLDivElement | null>(null);
  const [highlightSecurity, setHighlightSecurity] = useState(false);

  // Deep link /perfil?senha=1: rola até o card de segurança e abre a troca de senha.
  useEffect(() => {
    if (params.get("senha") !== "1") return;
    setPasswordOpen(true);
    setHighlightSecurity(true);
    const scroll = window.setTimeout(() => {
      securityRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    const unhighlight = window.setTimeout(() => setHighlightSecurity(false), 2600);
    return () => {
      window.clearTimeout(scroll);
      window.clearTimeout(unhighlight);
    };
  }, [params]);




  useEffect(() => {
    if (!profile) return;
    setForm({
      display_name: profile.display_name || "",
      email: profile.email || "",
      phone: profile.phone || "",
      avatar_url: profile.avatar_url || "",
      notify_whatsapp_overdue: profile.notify_whatsapp_overdue,
      notify_whatsapp_approvals: profile.notify_whatsapp_approvals,
      notify_email_overdue: profile.notify_email_overdue,
      notify_email_approvals: profile.notify_email_approvals,
    });
  }, [profile]);

  // Auto-sync SAP na 1ª abertura, quando o perfil ainda não tem dados.
  useEffect(() => {
    if (loading || !profile || syncedOnce) return;
    if (profile.sap_synced_at) { setSyncedOnce(true); return; }
    if (profile.email && profile.display_name) { setSyncedOnce(true); return; }
    setSyncedOnce(true);
    runSync(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, profile, syncedOnce]);

  const runSync = async (silent = false) => {
    setSyncing(true);
    try {
      const r = await syncFromSap();
      const patch: Partial<typeof form> = {};
      if (!form.display_name && r.aggregate.display_name) patch.display_name = r.aggregate.display_name;
      if (!form.email && r.aggregate.email) patch.email = r.aggregate.email;
      if (Object.keys(patch).length > 0) setForm((f) => ({ ...f, ...patch }));
      await save({ sap_synced_at: new Date().toISOString() });
      if (!silent) {
        toast.success(`SAP consultado em ${r.hits.length} empresa(s)`, {
          description: r.hits.length ? r.hits.map((h) => h.display_name).join(", ") : "Nenhum registro encontrado",
        });
      }
    } catch (e) {
      if (!silent) toast.error("Falha ao consultar SAP", { description: (e as Error).message });
    } finally {
      setSyncing(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await save(form);
      toast.success("Perfil atualizado");
      await refresh();
    } catch (e) {
      toast.error("Erro ao salvar", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Carregando…</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <PageTitle title="Meu Perfil" />
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Voltar
          </button>
          <div className="text-right">
            <p className="text-sm font-medium text-foreground">{getLabel(session?.companyDB || "")}</p>
            <p className="text-xs text-muted-foreground">{session?.userName}</p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-primary/10">
            <User className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Meu perfil</h1>
            <p className="text-sm text-muted-foreground">
              Cadastro único do colaborador — aplicado a todas as empresas em que você tem acesso.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">Dados de contato</CardTitle>
              <CardDescription>
                {profile?.sap_synced_at
                  ? `Última busca no SAP: ${new Date(profile.sap_synced_at).toLocaleString("pt-BR")}`
                  : "Ainda não sincronizado com o SAP."}
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => runSync(false)} disabled={syncing} className="gap-2">
              <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Consultando…" : "Buscar no SAP"}
            </Button>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Label htmlFor="name" className="text-xs text-muted-foreground">Nome de exibição</Label>
              <Input id="name" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="email" className="text-xs text-muted-foreground">E-mail</Label>
              <Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="phone" className="text-xs text-muted-foreground">Telefone (WhatsApp)</Label>
              <Input
                id="phone"
                placeholder="+55 11 99999-9999"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="avatar" className="text-xs text-muted-foreground">URL do avatar (opcional)</Label>
              <Input id="avatar" value={form.avatar_url} onChange={(e) => setForm({ ...form, avatar_url: e.target.value })} />
            </div>
          </CardContent>
        </Card>

        <Card
          ref={securityRef}
          id="seguranca"
          className={
            highlightSecurity
              ? "scroll-mt-24 ring-2 ring-primary transition-shadow"
              : "scroll-mt-24 transition-shadow"
          }
        >
          <CardHeader>
            <CardTitle className="text-base">Segurança e senha do ERP</CardTitle>
            <CardDescription>
              A entrada no sistema é feita pela conta Google. A senha abaixo é a do ERP, usada apenas
              nas ações que dependem do SAP (aprovar, integrar, dar baixa) e pode ser alterada em
              todas as empresas de uma vez.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => setPasswordOpen(true)}
            >
              <KeyRound className="w-4 h-4" /> Alterar senha do ERP
            </Button>
            <span className="text-xs text-muted-foreground">
              Usuário ERP: {session?.userName || "—"}
            </span>
          </CardContent>
        </Card>

        <ChangePasswordDialog
          hideTrigger
          open={passwordOpen}
          onOpenChange={(v) => {
            setPasswordOpen(v);
            if (!v && params.get("senha")) {
              params.delete("senha");
              setParams(params, { replace: true });
            }
          }}
        />


        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notificações que aceito receber</CardTitle>
            <CardDescription>Por padrão, todas as notificações estão ativas.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { k: "notify_whatsapp_approvals", label: "WhatsApp — aprovações pendentes" },
              { k: "notify_whatsapp_overdue", label: "WhatsApp — documentos vencidos" },
              { k: "notify_email_approvals", label: "E-mail — aprovações pendentes" },
              { k: "notify_email_overdue", label: "E-mail — documentos vencidos" },
            ].map((it) => (
              <div key={it.k} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
                <span className="text-sm">{it.label}</span>
                <Switch
                  checked={form[it.k as keyof typeof form] as boolean}
                  onCheckedChange={(v) => setForm({ ...form, [it.k]: v })}
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => navigate("/")}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            <Save className="w-4 h-4" /> {saving ? "Salvando…" : "Salvar perfil"}
          </Button>
        </div>
      </main>
    </div>
  );
}
