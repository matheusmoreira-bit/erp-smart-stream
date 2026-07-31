import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ClipboardList, Clock, Loader2, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageTitle } from "@/components/PageTitle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useSap } from "@/contexts/SapContext";
import { toast } from "sonner";
import {
  slaInfo,
  STATUS_LABELS,
  STATUS_ORDER,
  TYPE_LABELS,
  useRegistrationRequestEvents,
  useRegistrationRequests,
  type RegistrationRequest,
  type RegistrationStatus,
} from "@/hooks/useRegistrationRequests";
import { PAYMENT_METHOD_LABELS, REGISTRATION_MODE_LABELS } from "@/lib/supplier-request-email";
import { RegistrationAttachmentList } from "@/components/RegistrationAttachmentList";
import { RegistrationFilePicker } from "@/components/RegistrationFilePicker";

const statusVariant: Record<RegistrationStatus, string> = {
  aberto: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  em_andamento: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  pendente_solicitante: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  concluido: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  cancelado: "bg-muted text-muted-foreground border-border",
};

function fmt(dt?: string | null) {
  if (!dt) return "—";
  const d = new Date(dt);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function DetailDialog({
  request,
  isAgent,
  onClose,
  onUpdateStatus,
  onComment,
}: {
  request: RegistrationRequest | null;
  isAgent: boolean;
  onClose: () => void;
  onUpdateStatus: (
    req: RegistrationRequest,
    status: RegistrationStatus,
    extra?: { sapCardCode?: string | null; resolutionNote?: string | null },
  ) => Promise<void>;
  onComment: (id: string, message: string, files?: File[]) => Promise<void>;
}) {
  const { events, reload } = useRegistrationRequestEvents(request?.id ?? null);
  const [cardCode, setCardCode] = useState("");
  const [note, setNote] = useState("");
  const [comment, setComment] = useState("");
  const [commentFiles, setCommentFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  if (!request) return null;
  const sla = slaInfo(request);
  const bank = request.bank_details || {};

  const act = async (status: RegistrationStatus) => {
    setBusy(true);
    try {
      await onUpdateStatus(request, status, {
        sapCardCode: cardCode.trim() || request.sap_card_code,
        resolutionNote: note.trim() || null,
      });
      toast.success(`Chamado atualizado para "${STATUS_LABELS[status]}" e solicitante notificado.`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao atualizar chamado");
    } finally {
      setBusy(false);
    }
  };

  const sendComment = async () => {
    if (!comment.trim() && commentFiles.length === 0) return;
    setBusy(true);
    try {
      await onComment(request.id, comment.trim(), commentFiles);
      setComment("");
      setCommentFiles([]);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao comentar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(request)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            #{request.id.slice(0, 8).toUpperCase()} · {request.title}
          </DialogTitle>
          <DialogDescription>
            {TYPE_LABELS[request.request_type]} · aberto por {request.requester_email} em {fmt(request.created_at)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={statusVariant[request.status]}>
              {STATUS_LABELS[request.status]}
            </Badge>
            <Badge variant="outline" className={sla.overdue && !sla.closed ? "border-destructive/30 text-destructive" : ""}>
              <Clock className="w-3 h-3 mr-1" />
              SLA 48h úteis · {fmt(request.due_at)} ({sla.label})
            </Badge>
            {request.company_db && <Badge variant="outline">{request.company_db}</Badge>}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 text-sm">
            {request.federal_tax_id && (
              <div>
                <p className="text-xs text-muted-foreground">CNPJ / CPF</p>
                <p className="font-medium">{request.federal_tax_id}</p>
              </div>
            )}
            {request.contact_email && (
              <div>
                <p className="text-xs text-muted-foreground">E-mail de contato</p>
                <p className="font-medium">{request.contact_email}</p>
              </div>
            )}
            {request.phone1 && (
              <div>
                <p className="text-xs text-muted-foreground">Telefone</p>
                <p className="font-medium">{request.phone1}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground">Forma de cadastro</p>
              <p className="font-medium">{REGISTRATION_MODE_LABELS[request.registration_mode] || request.registration_mode}</p>
            </div>
            {request.payment_method && (
              <div>
                <p className="text-xs text-muted-foreground">Forma de pagamento</p>
                <p className="font-medium">{PAYMENT_METHOD_LABELS[request.payment_method] || request.payment_method}</p>
              </div>
            )}
            {bank.pixKey && (
              <div>
                <p className="text-xs text-muted-foreground">Chave PIX {bank.pixKeyType ? `(${bank.pixKeyType})` : ""}</p>
                <p className="font-medium break-all">{bank.pixKey}</p>
              </div>
            )}
            {(bank.bank || bank.agency || bank.account) && (
              <div>
                <p className="text-xs text-muted-foreground">Dados bancários</p>
                <p className="font-medium">
                  {[bank.bank, bank.agency && `Ag. ${bank.agency}`, bank.account && `Cc. ${bank.account}`, bank.accountType]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            )}
            {bank.holderName && (
              <div>
                <p className="text-xs text-muted-foreground">Titular</p>
                <p className="font-medium">
                  {bank.holderName} {bank.holderTaxId ? `· ${bank.holderTaxId}` : ""}
                </p>
              </div>
            )}
            {request.sap_card_code && (
              <div>
                <p className="text-xs text-muted-foreground">Código no ERP</p>
                <p className="font-medium">{request.sap_card_code}</p>
              </div>
            )}
          </div>

          {request.notes && (
            <div className="rounded-lg border border-border p-3 text-sm">
              <p className="text-xs text-muted-foreground mb-1">Observações do solicitante</p>
              {request.notes}
            </div>
          )}

          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Anexos</p>
            {request.attachments?.length ? (
              <RegistrationAttachmentList attachments={request.attachments} compact />
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum documento anexado.</p>
            )}
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Histórico</p>
            <div className="space-y-2">
              {events.length === 0 && <p className="text-sm text-muted-foreground">Sem movimentações ainda.</p>}
              {events.map((ev) => (
                <div
                  key={ev.id}
                  className={`rounded-md border px-3 py-2 text-sm ${ev.event_type === "audit" ? "border-dashed border-border bg-muted/30" : "border-border"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {ev.event_type === "status"
                        ? `Status: ${STATUS_LABELS[(ev.to_status as RegistrationStatus) ?? "aberto"] || ev.to_status}`
                        : ev.event_type === "attachment"
                          ? "Anexos"
                          : ev.event_type === "audit"
                            ? "Trilha de auditoria"
                            : "Comentário"}
                    </span>
                    <span className="text-xs text-muted-foreground">{fmt(ev.created_at)}</span>
                  </div>
                  {ev.message && (
                    <p className="text-muted-foreground mt-1 whitespace-pre-line">{ev.message}</p>
                  )}
                  {ev.attachments?.length > 0 && (
                    <RegistrationAttachmentList attachments={ev.attachments} compact />
                  )}
                  <p className="text-xs text-muted-foreground mt-1">{ev.author_email}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="rr-comment">Comentar</Label>
            <div className="flex gap-2">
              <Input
                id="rr-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Escreva uma atualização…"
              />
              <Button
                onClick={sendComment}
                disabled={busy || (!comment.trim() && commentFiles.length === 0)}
                className="gap-2"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Enviar
              </Button>
            </div>
            <RegistrationFilePicker
              files={commentFiles}
              onChange={setCommentFiles}
              disabled={busy}
              label="Anexar documentos ao chamado"
              hint="Ex.: comprovante bancário, ficha cadastral, cartão CNPJ (até 15MB cada)."
            />
          </div>

          {isAgent && request.status !== "concluido" && request.status !== "cancelado" && (
            <div className="rounded-lg border border-border p-4 space-y-3">
              <p className="text-sm font-medium">Atendimento</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="rr-cardcode">Código no ERP (CardCode / ItemCode)</Label>
                  <Input id="rr-cardcode" value={cardCode} onChange={(e) => setCardCode(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rr-note">Observação para o solicitante</Label>
                  <Textarea id="rr-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={busy} onClick={() => act("em_andamento")}>
                  Em andamento
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => act("pendente_solicitante")}>
                  Pendente do solicitante
                </Button>
                <Button disabled={busy} onClick={() => act("concluido")} className="gap-2">
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  Marcar como concluído
                </Button>
                <Button variant="ghost" className="text-destructive" disabled={busy} onClick={() => act("cancelado")}>
                  Cancelar chamado
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function RegistrationRequests() {
  const navigate = useNavigate();
  const { session } = useSap();
  const [allCompanies, setAllCompanies] = useState(false);
  const { requests, mine, loading, isAgent, reload, updateStatus, addComment } = useRegistrationRequests({
    companyDb: allCompanies ? null : session?.companyDB ?? null,
  });
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [scopeTouched, setScopeTouched] = useState(false);
  const [status, setStatus] = useState<"todos" | RegistrationStatus>("todos");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<RegistrationRequest | null>(null);

  // Agentes (Facilities/Admin) abrem direto na fila do time.
  useEffect(() => {
    if (isAgent && !scopeTouched) setScope("all");
  }, [isAgent, scopeTouched]);

  const base = scope === "all" && isAgent ? requests : mine;


  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return base.filter((r) => {
      if (status !== "todos" && r.status !== status) return false;
      if (!term) return true;
      return [r.title, r.federal_tax_id, r.requester_email, r.sap_card_code, r.id]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [base, status, search]);

  const openCount = base.filter((r) => r.status !== "concluido" && r.status !== "cancelado").length;
  const overdueCount = base.filter((r) => {
    const s = slaInfo(r);
    return !s.closed && s.overdue;
  }).length;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <PageTitle title="Solicitações de cadastro" />
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")} className="text-muted-foreground">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="p-2 rounded-lg bg-primary/10">
              <ClipboardList className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Solicitações de cadastro</h1>
              <p className="text-xs text-muted-foreground">
                Chamados de cadastro de fornecedores e itens · SLA de 48 horas úteis
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-foreground">{session?.companyDB}</p>
              <p className="text-xs text-muted-foreground">{session?.userName}</p>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-wrap items-end gap-3">
          {isAgent && (
            <Tabs value={scope} onValueChange={(v) => { setScopeTouched(true); setScope(v as "mine" | "all"); }}>
              <TabsList>
                <TabsTrigger value="mine">Minhas</TabsTrigger>
                <TabsTrigger value="all">Fila do time</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          <div className="flex-1 min-w-[240px]">
            <Label className="text-xs text-muted-foreground mb-1 block">Buscar</Label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome, CNPJ, chamado…" />
          </div>
          <div className="w-52">
            <Label className="text-xs text-muted-foreground mb-1 block">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {STATUS_ORDER.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isAgent && (
            <Button
              variant={allCompanies ? "default" : "outline"}
              onClick={() => setAllCompanies((v) => !v)}
              className="gap-2"
            >
              {allCompanies ? "Todas as empresas" : "Somente esta empresa"}
            </Button>
          )}
          <Button variant="outline" onClick={() => void reload()} disabled={loading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2 max-w-7xl mx-auto">
          Empresa: {allCompanies ? "todas" : session?.companyDB || "—"} · Em aberto: {openCount} · Fora do SLA:{" "}
          {overdueCount} · Exibindo: {filtered.length}
        </p>
      </div>

      <main className="flex-1 px-6 py-6">
        <div className="max-w-7xl mx-auto glass-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Chamado</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Título</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Solicitante</TableHead>
                <TableHead>Abertura</TableHead>
                <TableHead>SLA</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                    Carregando solicitações…
                  </TableCell>
                </TableRow>
              )}
              {!loading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                    Nenhuma solicitação encontrada.
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                filtered.map((r) => {
                  const sla = slaInfo(r);
                  return (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelected(r)}>
                      <TableCell className="font-mono text-xs">#{r.id.slice(0, 8).toUpperCase()}</TableCell>
                      <TableCell>{TYPE_LABELS[r.request_type]}</TableCell>
                      <TableCell className="font-medium max-w-[280px] truncate">{r.title}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.company_db || "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.requester_email}</TableCell>
                      <TableCell className="text-xs">{fmt(r.created_at)}</TableCell>
                      <TableCell className={`text-xs ${!sla.closed && sla.overdue ? "text-destructive font-medium" : ""}`}>
                        {sla.closed ? fmt(r.resolved_at) : sla.label}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusVariant[r.status]}>
                          {STATUS_LABELS[r.status]}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </div>
      </main>

      <DetailDialog
        request={selected}
        isAgent={isAgent}
        onClose={() => setSelected(null)}
        onUpdateStatus={updateStatus}
        onComment={addComment}
      />
    </div>
  );
}
