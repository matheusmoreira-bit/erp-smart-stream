import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, Plus, Loader2, RefreshCw, Ban, Copy, Trash2, ShieldAlert } from "lucide-react";
import { BackofficePageHeader } from "@/components/BackofficePageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { invokeFn } from "@/lib/invoke-fn";
import { toast } from "sonner";

interface ApiKeyRow {
  id: string;
  name: string;
  service: string;
  key_prefix: string;
  notes: string | null;
  project_codes: string[];
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  use_count: number;
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
}

interface LegacyKey {
  service: string;
  secret_name: string;
}

const SERVICE_LABELS: Record<string, string> = {
  "external-approvals-api": "Aprovações pendentes (external-approvals-api)",
  "pagcorp-status-api": "Status de cartões (pagcorp-status-api)",
  "expense-tracking-api": "Acompanhamento de despesas (expense-tracking-api)",
};

const KNOWN_SERVICES = Object.keys(SERVICE_LABELS);

function mergeServices(remoteServices?: string[]): string[] {
  return Array.from(new Set([
    ...KNOWN_SERVICES,
    ...(Array.isArray(remoteServices) ? remoteServices : []),
  ]));
}

function parseProjectCodes(value: string): string[] {
  return Array.from(new Set(
    value.split(/[\n,;]+/).map((code) => code.trim()).filter(Boolean),
  ));
}

function fmt(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR");
}

export default function ApiKeys() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [legacy, setLegacy] = useState<LegacyKey[]>([]);
  const [services, setServices] = useState<string[]>(KNOWN_SERVICES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [service, setService] = useState("external-approvals-api");
  const [expiresAt, setExpiresAt] = useState("");
  const [notes, setNotes] = useState("");
  const [projectCodes, setProjectCodes] = useState("");
  const [plaintext, setPlaintext] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await invokeFn<{ keys: ApiKeyRow[]; legacy: LegacyKey[]; services: string[] }>(
      "api-keys-admin",
      { body: { op: "list" } },
    );
    setLoading(false);
    if (error || !data) {
      toast.error(error?.message || "Falha ao carregar chaves");
      return;
    }
    setKeys(data.keys || []);
    setLegacy(data.legacy || []);
    setServices(mergeServices(data.services));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = useMemo(
    () => keys.filter((k) => !k.revoked_at && (!k.expires_at || new Date(k.expires_at) > new Date())),
    [keys],
  );

  async function handleCreate() {
    if (name.trim().length < 3) {
      toast.error("Informe um nome com pelo menos 3 caracteres");
      return;
    }
    const projects = parseProjectCodes(projectCodes);
    if (service === "expense-tracking-api" && projects.length === 0) {
      toast.error("Informe ao menos um projeto permitido");
      return;
    }
    setSaving(true);
    const { data, error } = await invokeFn<{ plaintext: string }>("api-keys-admin", {
      body: {
        op: "create",
        name: name.trim(),
        service,
        expires_at: expiresAt || null,
        notes: notes.trim() || null,
        project_codes: service === "expense-tracking-api" ? projects : [],
      },
    });
    setSaving(false);
    if (error || !data?.plaintext) {
      toast.error(error?.message || "Falha ao criar chave");
      return;
    }
    setPlaintext(data.plaintext);
    setCreateOpen(false);
    setName("");
    setExpiresAt("");
    setNotes("");
    setProjectCodes("");
    void load();
  }

  async function handleRevoke(row: ApiKeyRow) {
    const reason = window.prompt(`Revogar a chave "${row.name}"? Motivo (opcional):`);
    if (reason === null) return;
    const { error } = await invokeFn("api-keys-admin", { body: { op: "revoke", id: row.id, reason } });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Chave revogada");
    void load();
  }

  async function handleDelete(row: ApiKeyRow) {
    if (!window.confirm(`Remover definitivamente o registro da chave "${row.name}"?`)) return;
    const { error } = await invokeFn("api-keys-admin", { body: { op: "delete", id: row.id } });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Registro removido");
    void load();
  }

  return (
    <div className="min-h-screen bg-background">
      <BackofficePageHeader
        title="Chaves de API"
        description="Crie, monitore e revogue as chaves usadas pelos sistemas externos"
        icon={<KeyRound className="w-5 h-5" />}
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-1.5" />
              Nova chave
            </Button>
          </div>
        }
      />

      <main className="max-w-6xl mx-auto px-3 sm:px-6 py-6 space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Chaves ativas</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{active.length}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Revogadas / expiradas</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{keys.length - active.length}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Chaves legadas em uso</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{legacy.length}</CardContent>
          </Card>
        </div>

        {legacy.length > 0 && (
          <Card className="border-amber-500/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-500" />
                Chaves legadas (continuam funcionando)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              {legacy.map((l) => (
                <div key={l.secret_name} className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{l.secret_name}</Badge>
                  <span>{SERVICE_LABELS[l.service] ?? l.service}</span>
                </div>
              ))}
              <p>
                Estas chaves ficam armazenadas nos segredos do backend e seguem válidas. Para desativá-las,
                emita uma nova chave aqui, troque no sistema externo e remova o segredo correspondente.
              </p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Chaves emitidas</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 flex justify-center text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : keys.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                Nenhuma chave emitida ainda.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-muted-foreground border-b">
                    <tr>
                      <th className="text-left font-medium px-4 py-2">Nome</th>
                      <th className="text-left font-medium px-4 py-2">Serviço</th>
                      <th className="text-left font-medium px-4 py-2">Prefixo</th>
                      <th className="text-left font-medium px-4 py-2">Projetos</th>
                      <th className="text-left font-medium px-4 py-2">Criada</th>
                      <th className="text-left font-medium px-4 py-2">Último uso</th>
                      <th className="text-left font-medium px-4 py-2">Usos</th>
                      <th className="text-left font-medium px-4 py-2">Status</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((k) => {
                      const expired = !!k.expires_at && new Date(k.expires_at) <= new Date();
                      const revoked = !!k.revoked_at;
                      return (
                        <tr key={k.id} className="border-b last:border-0">
                          <td className="px-4 py-2">
                            <div className="font-medium">{k.name}</div>
                            {k.notes && <div className="text-xs text-muted-foreground">{k.notes}</div>}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">
                            {SERVICE_LABELS[k.service] ?? k.service}
                          </td>
                          <td className="px-4 py-2 font-mono text-xs">{k.key_prefix}…</td>
                          <td className="px-4 py-2">
                            {k.project_codes?.length ? (
                              <div className="flex max-w-52 flex-wrap gap-1">
                                {k.project_codes.slice(0, 3).map((project) => (
                                  <Badge key={project} variant="outline" className="max-w-full truncate">
                                    {project}
                                  </Badge>
                                ))}
                                {k.project_codes.length > 3 && (
                                  <Badge variant="secondary">+{k.project_codes.length - 3}</Badge>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">
                            {fmt(k.created_at)}
                            {k.created_by && <div className="text-xs">por {k.created_by}</div>}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">{fmt(k.last_used_at)}</td>
                          <td className="px-4 py-2">{k.use_count}</td>
                          <td className="px-4 py-2">
                            {revoked ? (
                              <Badge variant="destructive">Revogada</Badge>
                            ) : expired ? (
                              <Badge variant="secondary">Expirada</Badge>
                            ) : (
                              <Badge>Ativa</Badge>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right whitespace-nowrap">
                            {!revoked ? (
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label={`Revogar ${k.name}`}
                                onClick={() => void handleRevoke(k)}
                              >
                                <Ban className="w-4 h-4" />
                              </Button>
                            ) : (
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label={`Remover registro de ${k.name}`}
                                onClick={() => void handleDelete(k)}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova chave de API</DialogTitle>
            <DialogDescription>
              O valor da chave é exibido uma única vez após a criação.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="api-key-name">Nome</Label>
              <Input
                id="api-key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Integração Portal RH"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Serviço</Label>
              <Select value={service} onValueChange={setService}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {services.map((s) => (
                    <SelectItem key={s} value={s}>
                      {SERVICE_LABELS[s] ?? s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {service === "expense-tracking-api" && (
              <div className="space-y-1.5">
                <Label htmlFor="api-key-projects">Projetos permitidos</Label>
                <Textarea
                  id="api-key-projects"
                  value={projectCodes}
                  onChange={(e) => setProjectCodes(e.target.value)}
                  placeholder="PROJETO A, PROJETO B"
                  rows={3}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="api-key-exp">Expira em (opcional)</Label>
              <Input
                id="api-key-exp"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="api-key-notes">Observações</Label>
              <Textarea
                id="api-key-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void handleCreate()} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Criar chave
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!plaintext} onOpenChange={(o) => !o && setPlaintext(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Chave criada</DialogTitle>
            <DialogDescription>
              Copie agora: por segurança, este valor não pode ser exibido novamente.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted p-3 font-mono text-xs break-all">{plaintext}</div>
          <DialogFooter>
            <Button
              onClick={() => {
                if (plaintext) {
                  void navigator.clipboard.writeText(plaintext);
                  toast.success("Chave copiada");
                }
              }}
            >
              <Copy className="w-4 h-4 mr-1.5" />
              Copiar
            </Button>
            <Button variant="outline" onClick={() => setPlaintext(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
