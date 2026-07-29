import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Mail, Save, Upload, Plus, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { authFetch } from "@/lib/auth-fetch";
import { useCompanies } from "@/hooks/useCompanies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Settings {
  id?: string;
  company_db: string;
  from_name: string;
  from_email: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_password_secret: string;
  reply_to: string | null;
  is_active: boolean;
}

interface RecipientRule {
  id: string;
  company_db: string;
  project_code: string;
  brand: string | null;
  to_emails: string[];
  cc_emails: string[];
  is_active: boolean;
  source: string;
}

const emptySettings = (companyDb: string): Settings => ({
  company_db: companyDb,
  from_name: "",
  from_email: "",
  smtp_host: "smtp.gmail.com",
  smtp_port: 465,
  smtp_user: "",
  smtp_password_secret: "",
  reply_to: "",
  is_active: true,
});

export default function NfseEmailSettingsTab() {
  const { companies, getLabel } = useCompanies();
  const companyOptions = useMemo(
    () => (companies || []).map((c) => ({ db: c.company_db, label: getLabel(c.company_db) })),
    [companies, getLabel],
  );

  const [companyDb, setCompanyDb] = useState<string>("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rules, setRules] = useState<RecipientRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [xml, setXml] = useState("");
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!companyDb && companyOptions.length > 0) setCompanyDb(companyOptions[0].db);
  }, [companyOptions, companyDb]);

  const load = useCallback(async () => {
    if (!companyDb) return;
    setLoading(true);
    try {
      const [{ data: s }, { data: r }] = await Promise.all([
        supabase.from("nfse_email_settings").select("*").eq("company_db", companyDb).maybeSingle(),
        supabase
          .from("nfse_email_recipients")
          .select("*")
          .eq("company_db", companyDb)
          .order("project_code"),
      ]);
      setSettings((s as Settings) || emptySettings(companyDb));
      setRules((r || []) as RecipientRule[]);
    } finally {
      setLoading(false);
    }
  }, [companyDb]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    if (!settings) return;
    if (!settings.from_email || !settings.smtp_user || !settings.smtp_password_secret) {
      toast.error("Preencha remetente, usuário SMTP e o nome do segredo da senha.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        company_db: companyDb,
        from_name: settings.from_name || settings.from_email,
        from_email: settings.from_email.trim().toLowerCase(),
        smtp_host: settings.smtp_host.trim(),
        smtp_port: Number(settings.smtp_port) || 465,
        smtp_user: settings.smtp_user.trim(),
        smtp_password_secret: settings.smtp_password_secret.trim(),
        reply_to: settings.reply_to?.trim() || null,
        is_active: settings.is_active,
      };
      const { error } = await supabase
        .from("nfse_email_settings")
        .upsert(payload, { onConflict: "company_db" });
      if (error) throw error;
      toast.success("Remetente salvo.");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [settings, companyDb, load]);

  const importXml = useCallback(async () => {
    if (!xml.trim()) {
      toast.error("Cole o conteúdo do XML.");
      return;
    }
    setImporting(true);
    try {
      const res = await authFetch("nfse-send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import-recipients", company_db: companyDb, xml }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.error) throw new Error(body?.error || `Falha na importação (${res.status})`);
      toast.success(`${body.imported} regra(s) de destinatário importada(s).`);
      setXml("");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setImporting(false);
    }
  }, [xml, companyDb, load]);

  const addRule = useCallback(async () => {
    const { error } = await supabase.from("nfse_email_recipients").insert({
      company_db: companyDb,
      project_code: "",
      to_emails: [],
      cc_emails: [],
      source: "manual",
    });
    if (error) toast.error(error.message);
    else await load();
  }, [companyDb, load]);

  const updateRule = useCallback(
    async (id: string, patch: Partial<RecipientRule>) => {
      const { error } = await supabase.from("nfse_email_recipients").update(patch).eq("id", id);
      if (error) toast.error(error.message);
    },
    [],
  );

  const removeRule = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("nfse_email_recipients").delete().eq("id", id);
      if (error) toast.error(error.message);
      else await load();
    },
    [load],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[260px]">
          <Label className="text-xs text-muted-foreground">Empresa</Label>
          <Select value={companyDb} onValueChange={setCompanyDb}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Selecione a empresa" />
            </SelectTrigger>
            <SelectContent>
              {companyOptions.map((c) => (
                <SelectItem key={c.db} value={c.db}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Atualizar
        </Button>
      </div>

      {loading && !settings ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        settings && (
          <div className="rounded-lg border border-border bg-card p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-primary" />
              <h3 className="font-medium">Remetente da NFS-e</h3>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs text-muted-foreground">Nome exibido</Label>
                <Input
                  value={settings.from_name}
                  onChange={(e) => setSettings({ ...settings, from_name: e.target.value })}
                  placeholder="Financeiro Cactus"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">E-mail do remetente</Label>
                <Input
                  value={settings.from_email}
                  onChange={(e) => setSettings({ ...settings, from_email: e.target.value })}
                  placeholder="financeiro@cactusgaming.net"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Servidor SMTP</Label>
                <Input
                  value={settings.smtp_host}
                  onChange={(e) => setSettings({ ...settings, smtp_host: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Porta</Label>
                <Input
                  type="number"
                  value={settings.smtp_port}
                  onChange={(e) => setSettings({ ...settings, smtp_port: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Usuário SMTP</Label>
                <Input
                  value={settings.smtp_user}
                  onChange={(e) => setSettings({ ...settings, smtp_user: e.target.value })}
                  placeholder="financeiro@cactusgaming.net"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Nome do segredo com a senha de app</Label>
                <Input
                  value={settings.smtp_password_secret}
                  onChange={(e) => setSettings({ ...settings, smtp_password_secret: e.target.value })}
                  placeholder="NFSE_SMTP_CACTUS"
                />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs text-muted-foreground">Responder para (opcional)</Label>
                <Input
                  value={settings.reply_to || ""}
                  onChange={(e) => setSettings({ ...settings, reply_to: e.target.value })}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              A senha de app nunca fica no banco: cadastre-a como segredo do backend e informe aqui apenas o nome dele.
            </p>
            <Button onClick={() => void save()} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Salvar remetente
            </Button>
          </div>
        )
      )}

      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="font-medium">Destinatários por projeto / marca</h3>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => void addRule()}>
            <Plus className="w-4 h-4" />
            Nova regra
          </Button>
        </div>

        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma regra cadastrada. Deixe o projeto em branco para criar o destinatário padrão da empresa.
          </p>
        ) : (
          <div className="space-y-2">
            {rules.map((r) => (
              <div key={r.id} className="grid gap-2 sm:grid-cols-[160px_140px_1fr_1fr_auto] items-end rounded-md border border-border/60 p-2">
                <div>
                  <Label className="text-[11px] text-muted-foreground">Projeto</Label>
                  <Input
                    defaultValue={r.project_code}
                    placeholder="(padrão)"
                    onBlur={(e) => void updateRule(r.id, { project_code: e.target.value.trim() })}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">Marca</Label>
                  <Input
                    defaultValue={r.brand || ""}
                    onBlur={(e) => void updateRule(r.id, { brand: e.target.value.trim() || null })}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">Para</Label>
                  <Input
                    defaultValue={(r.to_emails || []).join(", ")}
                    onBlur={(e) =>
                      void updateRule(r.id, {
                        to_emails: e.target.value.split(/[;,\s]+/).map((v) => v.trim().toLowerCase()).filter(Boolean),
                      })
                    }
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">Cópia</Label>
                  <Input
                    defaultValue={(r.cc_emails || []).join(", ")}
                    onBlur={(e) =>
                      void updateRule(r.id, {
                        cc_emails: e.target.value.split(/[;,\s]+/).map((v) => v.trim().toLowerCase()).filter(Boolean),
                      })
                    }
                    className="h-8 text-sm"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant="outline" className="text-[10px]">{r.source}</Badge>
                  <Button variant="ghost" size="icon" onClick={() => void removeRule(r.id)}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="pt-2 border-t border-border/60 space-y-2">
          <Label className="text-xs text-muted-foreground">Importar XML de destinatários</Label>
          <Textarea
            value={xml}
            onChange={(e) => setXml(e.target.value)}
            rows={6}
            placeholder={`<destinatarios>\n  <empresa db="${companyDb || "SBO_EMPRESA"}">\n    <projeto codigo="DONALD BET" marca="Donald">\n      <para>cliente@dominio.com</para>\n      <copia>financeiro@dominio.com</copia>\n    </projeto>\n  </empresa>\n</destinatarios>`}
            className="font-mono text-xs"
          />
          <Button variant="outline" size="sm" className="gap-2" onClick={() => void importXml()} disabled={importing}>
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Importar XML
          </Button>
        </div>
      </div>
    </div>
  );
}
