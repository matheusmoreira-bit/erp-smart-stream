import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ShieldCheck,
  Plus,
  Loader2,
  Download,
  CheckCircle2,
  PencilLine,
  Ban,
  Lock,
  RefreshCw,
} from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Decision = "pendente" | "manter" | "alterar" | "revogar";

interface Campaign {
  id: string;
  name: string;
  period_label: string;
  status: string;
  due_at: string | null;
  opened_by: string | null;
  opened_at: string;
  closed_by: string | null;
  closed_at: string | null;
  notes: string | null;
}

interface ReviewItem {
  id: string;
  campaign_id: string;
  user_key: string;
  display_name: string | null;
  sap_email: string | null;
  access_type: string;
  company_db: string | null;
  access_ref_id: string | null;
  access_label: string;
  decision: string;
  justification: string | null;
  decided_by: string | null;
  decided_at: string | null;
  evidence: unknown;
}

const DECISION_META: Record<Decision, { label: string; className: string }> = {
  pendente: { label: "Pendente", className: "border-border text-muted-foreground" },
  manter: { label: "Manter", className: "border-primary/40 text-primary" },
  alterar: { label: "Alterar", className: "border-[hsl(var(--cactus-amber))]/50 text-[hsl(var(--cactus-amber))]" },
  revogar: { label: "Revogar", className: "border-destructive/40 text-destructive" },
};

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleString("pt-BR") : "—");

/** Trimestre corrente, ex.: "2026-Q3". */
function currentQuarter(d = new Date()) {
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}

function personLabel(item: ReviewItem) {
  return item.display_name?.trim() || item.user_key;
}

export default function AccessReview() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [openNew, setOpenNew] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", period: currentQuarter(), due: "", notes: "" });

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "grupo" | "alcada">("all");
  const [decisionFilter, setDecisionFilter] = useState<"all" | Decision>("all");

  const [decisionTarget, setDecisionTarget] = useState<{ item: ReviewItem; decision: Decision } | null>(null);
  const [justification, setJustification] = useState("");
  const [saving, setSaving] = useState(false);

  const selected = campaigns.find((c) => c.id === selectedId) ?? null;

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("access_review_campaigns")
      .select("*")
      .order("opened_at", { ascending: false });
    if (err) setError(err.message);
    else {
      setError(null);
      const rows = (data ?? []) as Campaign[];
      setCampaigns(rows);
      setSelectedId((prev) => prev ?? rows[0]?.id ?? null);
    }
    setLoading(false);
  }, []);

  const loadItems = useCallback(async (campaignId: string) => {
    setLoadingItems(true);
    const { data, error: err } = await supabase
      .from("access_review_items")
      .select("*")
      .eq("campaign_id", campaignId)
      .order("display_name", { ascending: true })
      .limit(5000);
    if (err) toast.error(`Erro ao carregar itens: ${err.message}`);
    setItems((data ?? []) as ReviewItem[]);
    setLoadingItems(false);
  }, []);

  useEffect(() => {
    void loadCampaigns();
  }, [loadCampaigns]);

  useEffect(() => {
    if (selectedId) void loadItems(selectedId);
    else setItems([]);
  }, [selectedId, loadItems]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((it) => {
      if (typeFilter !== "all" && it.access_type !== typeFilter) return false;
      if (decisionFilter !== "all" && it.decision !== decisionFilter) return false;
      if (!term) return true;
      return (
        personLabel(it).toLowerCase().includes(term) ||
        (it.sap_email ?? "").toLowerCase().includes(term) ||
        it.access_label.toLowerCase().includes(term) ||
        (it.company_db ?? "").toLowerCase().includes(term)
      );
    });
  }, [items, search, typeFilter, decisionFilter]);

  const stats = useMemo(() => {
    const base = { total: items.length, pendente: 0, manter: 0, alterar: 0, revogar: 0 };
    for (const it of items) {
      if (it.decision in base) base[it.decision as Decision] += 1;
    }
    return base;
  }, [items]);

  const progress = stats.total ? Math.round(((stats.total - stats.pendente) / stats.total) * 100) : 0;

  async function createCampaign() {
    if (!form.name.trim() || !form.period.trim()) {
      toast.error("Informe nome e período da campanha.");
      return;
    }
    setCreating(true);
    const { data, error: err } = await supabase.rpc("open_access_review_campaign", {
      _name: form.name.trim(),
      _period_label: form.period.trim(),
      _due_at: form.due ? new Date(form.due).toISOString() : null,
      _notes: form.notes.trim() || null,
    });
    setCreating(false);
    if (err) {
      toast.error(`Não foi possível abrir a campanha: ${err.message}`);
      return;
    }
    toast.success("Campanha aberta com o retrato dos acessos atuais.");
    setOpenNew(false);
    setForm({ name: "", period: currentQuarter(), due: "", notes: "" });
    await loadCampaigns();
    if (typeof data === "string") setSelectedId(data);
  }

  async function confirmDecision() {
    if (!decisionTarget) return;
    const { item, decision } = decisionTarget;
    if (decision !== "manter" && !justification.trim()) {
      toast.error("Justificativa obrigatória para alterar ou revogar.");
      return;
    }
    setSaving(true);

    let revokeError: string | null = null;
    if (decision === "revogar" && item.access_ref_id) {
      const table = item.access_type === "grupo" ? "user_group_assignments" : "approver_cost_centers";
      const { error: delErr } = await supabase.from(table).delete().eq("id", item.access_ref_id);
      if (delErr) revokeError = delErr.message;
    }

    const { data: userData } = await supabase.auth.getUser();
    const actor = userData?.user?.email ?? null;

    const { error: upErr } = await supabase
      .from("access_review_items")
      .update({
        decision,
        justification: justification.trim() || null,
        decided_by: actor,
        decided_at: new Date().toISOString(),
        evidence: {
          ...(typeof item.evidence === "object" && item.evidence ? item.evidence : {}),
          decision_applied: decision === "revogar" ? !revokeError : null,
          decision_error: revokeError,
        },
      })
      .eq("id", item.id);

    setSaving(false);
    if (upErr) {
      toast.error(`Erro ao registrar decisão: ${upErr.message}`);
      return;
    }
    if (revokeError) toast.warning(`Decisão registrada, mas a revogação falhou: ${revokeError}`);
    else toast.success("Decisão registrada.");
    setDecisionTarget(null);
    setJustification("");
    if (selectedId) void loadItems(selectedId);
  }

  async function closeCampaign() {
    if (!selected) return;
    const { error: err } = await supabase.rpc("close_access_review_campaign", {
      _campaign_id: selected.id,
    });
    if (err) {
      toast.error(err.message);
      return;
    }
    toast.success("Campanha concluída.");
    await loadCampaigns();
  }

  function exportCsv() {
    if (!selected) return;
    const header = [
      "campanha",
      "periodo",
      "pessoa",
      "usuario_sap",
      "email",
      "tipo_acesso",
      "empresa",
      "acesso",
      "decisao",
      "justificativa",
      "decidido_por",
      "decidido_em",
    ];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = filtered.map((it) =>
      [
        selected.name,
        selected.period_label,
        personLabel(it),
        it.user_key,
        it.sap_email ?? "",
        it.access_type === "grupo" ? "Grupo de permissão" : "Alçada de CC",
        it.company_db ?? "Todas",
        it.access_label,
        DECISION_META[(it.decision as Decision) ?? "pendente"]?.label ?? it.decision,
        it.justification ?? "",
        it.decided_by ?? "",
        it.decided_at ? fmtDate(it.decided_at) : "",
      ]
        .map(esc)
        .join(";"),
    );
    const blob = new Blob(["\uFEFF" + [header.join(";"), ...lines].join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `recertificacao-${selected.period_label}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const readOnly = selected?.status !== "aberta";

  return (
    <div className="min-h-screen bg-background px-6 pb-16">
      <BackofficePageHeader
        title="Revisão periódica de acessos"
        description="Campanhas de recertificação de grupos e alçadas, com evidência para auditoria"
        icon={<ShieldCheck className="h-5 w-5 text-primary" />}
      />

      <main className="mx-auto max-w-6xl py-6 space-y-6">
        {error && (
          <Card className="border-destructive/40">
            <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
          </Card>
        )}

        {/* Campanhas */}
        <section>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">Campanhas</h2>
            <Button size="sm" variant="ghost" onClick={() => void loadCampaigns()}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              Atualizar
            </Button>
            <Button size="sm" className="ml-auto" onClick={() => setOpenNew(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Nova campanha
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando campanhas…
            </div>
          ) : campaigns.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Nenhuma campanha de recertificação aberta até agora. Crie a primeira para fotografar
                os acessos atuais.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              {campaigns.map((c) => (
                <Card
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(c.id)}
                  onKeyDown={(e) => e.key === "Enter" && setSelectedId(c.id)}
                  className={`cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    selectedId === c.id ? "border-primary/60" : "border-border/70"
                  }`}
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      {c.name}
                      <Badge variant="outline" className="text-[10px]">
                        {c.period_label}
                      </Badge>
                      {c.status !== "aberta" && (
                        <Badge variant="secondary" className="text-[10px]">
                          {c.status === "concluida" ? "Concluída" : "Cancelada"}
                        </Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1 text-xs text-muted-foreground">
                    <p>Aberta em {fmtDate(c.opened_at)}</p>
                    <p>Prazo: {fmtDate(c.due_at)}</p>
                    {c.closed_at && <p>Concluída em {fmtDate(c.closed_at)}</p>}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Itens da campanha */}
        {selected && (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">
                Itens de {selected.name}
              </h2>
              <Badge variant="secondary" className="text-[10px]">
                {progress}% revisado
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {stats.pendente} pendentes
              </Badge>
              <Badge variant="outline" className="text-[10px] text-primary border-primary/40">
                {stats.manter} manter
              </Badge>
              <Badge variant="outline" className="text-[10px] text-destructive border-destructive/40">
                {stats.revogar} revogar
              </Badge>
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="outline" onClick={exportCsv}>
                  <Download className="mr-1 h-3.5 w-3.5" />
                  Evidência (CSV)
                </Button>
                {selected.status === "aberta" && (
                  <Button size="sm" onClick={() => void closeCampaign()} disabled={stats.pendente > 0}>
                    <Lock className="mr-1 h-3.5 w-3.5" />
                    Concluir campanha
                  </Button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar pessoa, acesso ou empresa…"
                className="min-w-[220px] flex-1"
              />
              <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os tipos</SelectItem>
                  <SelectItem value="grupo">Grupo de permissão</SelectItem>
                  <SelectItem value="alcada">Alçada de centro de custo</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={decisionFilter}
                onValueChange={(v) => setDecisionFilter(v as typeof decisionFilter)}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as decisões</SelectItem>
                  <SelectItem value="pendente">Pendentes</SelectItem>
                  <SelectItem value="manter">Manter</SelectItem>
                  <SelectItem value="alterar">Alterar</SelectItem>
                  <SelectItem value="revogar">Revogar</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {loadingItems ? (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando itens…
              </div>
            ) : filtered.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Nenhum item corresponde aos filtros.
              </p>
            ) : (
              <div className="space-y-2">
                {filtered.map((it) => {
                  const meta = DECISION_META[(it.decision as Decision) ?? "pendente"];
                  return (
                    <Card key={it.id} className="border-border/70">
                      <CardContent className="flex flex-wrap items-center gap-3 p-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-foreground">
                              {personLabel(it)}
                            </span>
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">
                              {it.access_type === "grupo" ? "Grupo" : "Alçada"}
                            </Badge>
                            <Badge variant="outline" className={`text-[10px] ${meta?.className ?? ""}`}>
                              {meta?.label ?? it.decision}
                            </Badge>
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {it.access_label} · {it.company_db || "Todas as empresas"}
                          </p>
                          {it.justification && (
                            <p className="mt-1 text-xs italic text-muted-foreground">
                              “{it.justification}” — {it.decided_by ?? "—"} em {fmtDate(it.decided_at)}
                            </p>
                          )}
                        </div>
                        {!readOnly && (
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label="Manter acesso"
                              onClick={() => {
                                setJustification(it.justification ?? "");
                                setDecisionTarget({ item: it, decision: "manter" });
                              }}
                            >
                              <CheckCircle2 className="h-4 w-4 text-primary" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label="Marcar para alteração"
                              onClick={() => {
                                setJustification(it.justification ?? "");
                                setDecisionTarget({ item: it, decision: "alterar" });
                              }}
                            >
                              <PencilLine className="h-4 w-4 text-[hsl(var(--cactus-amber))]" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label="Revogar acesso"
                              onClick={() => {
                                setJustification(it.justification ?? "");
                                setDecisionTarget({ item: it, decision: "revogar" });
                              }}
                            >
                              <Ban className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </main>

      {/* Nova campanha */}
      <Dialog open={openNew} onOpenChange={setOpenNew}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova campanha de recertificação</DialogTitle>
            <DialogDescription>
              Ao abrir, o sistema fotografa todos os vínculos de grupo e alçadas de centro de custo
              existentes como itens a revisar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="ar-name">Nome</Label>
              <Input
                id="ar-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={`Recertificação ${currentQuarter()}`}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="ar-period">Período</Label>
                <Input
                  id="ar-period"
                  value={form.period}
                  onChange={(e) => setForm((f) => ({ ...f, period: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="ar-due">Prazo</Label>
                <Input
                  id="ar-due"
                  type="date"
                  value={form.due}
                  onChange={(e) => setForm((f) => ({ ...f, due: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="ar-notes">Observações</Label>
              <Textarea
                id="ar-notes"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenNew(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void createCampaign()} disabled={creating}>
              {creating && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Abrir campanha
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Decisão */}
      <Dialog
        open={!!decisionTarget}
        onOpenChange={(o) => {
          if (!o) {
            setDecisionTarget(null);
            setJustification("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decisionTarget ? DECISION_META[decisionTarget.decision].label : ""} acesso
            </DialogTitle>
            <DialogDescription>
              {decisionTarget && (
                <>
                  {personLabel(decisionTarget.item)} · {decisionTarget.item.access_label} ·{" "}
                  {decisionTarget.item.company_db || "Todas as empresas"}
                  {decisionTarget.decision === "revogar" &&
                    " — o vínculo será removido imediatamente."}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="ar-just">
              Justificativa {decisionTarget?.decision === "manter" ? "(opcional)" : "(obrigatória)"}
            </Label>
            <Textarea
              id="ar-just"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDecisionTarget(null)}>
              Cancelar
            </Button>
            <Button onClick={() => void confirmDecision()} disabled={saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
