import { useMemo, useState } from "react";
import { Loader2, PlayCircle, Download, Search, RefreshCw, Sparkles } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useCompanies } from "@/hooks/useCompanies";
import { useSap } from "@/contexts/SapContext";
import { useAuditCrossFiscal, type CenarioCruzamento, type CruzamentoRow, type StatusMatch } from "@/hooks/useAuditCrossFiscal";
import { KanbanColumn } from "@/components/audit-cross/KanbanColumn";
import { CruzamentoCard } from "@/components/audit-cross/CruzamentoCard";
import { CruzamentoDetailDrawer } from "@/components/audit-cross/CruzamentoDetailDrawer";
import { AutoReconcileSettings } from "@/components/audit-cross/AutoReconcileSettings";

const CENARIO_LABEL: Record<CenarioCruzamento, string> = {
  pago_sem_nota: "Pago sem nota",
  nota_sem_pagamento: "Nota sem pagamento",
  conciliado: "Conciliado",
};

const STATUS_LABEL: Record<StatusMatch, string> = {
  automatico: "Automático",
  ambiguo: "Ambíguo",
  confirmado_manual: "Confirmado",
  ignorado: "Ignorado",
};

function toCsv(rows: CruzamentoRow[]): string {
  const head = [
    "Cenário", "ERP", "CNPJ", "Fornecedor", "NF Número", "NF Valor", "NF Emissão",
    "Conta ID", "Conta Valor", "Data Baixa", "Diferença R$", "Diferença dias",
    "Status", "Auto-conciliado", "Regra automática", "Lançamento ERP", "Observação",
  ];
  const body = rows.map((r) => [
    CENARIO_LABEL[r.cenario], r.erp_origem || "",
    r.cnpj_fornecedor, r.razao_social_fornecedor ?? "",
    r.nota_numero ?? "", r.nota_valor ?? "", r.nota_data_emissao ?? "",
    r.conta_paga_id_externo ?? "", r.conta_paga_valor ?? "", r.conta_paga_data_baixa ?? "",
    r.diferenca_valor ?? "", r.diferenca_dias ?? "",
    r.status_match, r.auto_conciliado ? "Sim" : "Não", r.auto_regra ?? "",
    r.lancamento_erp_status ?? "", r.observacao_usuario ?? "",
  ]);
  return [head, ...body]
    .map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

export default function AuditCrossFiscal() {
  const { toast } = useToast();
  const { companies } = useCompanies();
  const { session } = useSap();
  const loggedCompanyDb = session?.companyDB || "";

  const loggedCompany = useMemo(
    () => (companies || []).find((c: any) => c.company_db === loggedCompanyDb),
    [companies, loggedCompanyDb],
  );
  const empresaId = loggedCompany?.id || "";
  const erp = (loggedCompany?.erp_type || session?.erpType || "").toLowerCase();

  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const lastOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);

  const [inicio, setInicio] = useState<string>(firstOfMonth);
  const [fim, setFim] = useState<string>(lastOfMonth);
  const [running, setRunning] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusMatch | "all">("all");
  const [detailRow, setDetailRow] = useState<CruzamentoRow | null>(null);
  const [onlyExceptions, setOnlyExceptions] = useState(true);

  const { rows, loading, refresh, runCross, updateRow } = useAuditCrossFiscal({
    empresa_id: empresaId || undefined,
    // erp_origem intencionalmente omitido: linhas "nota_sem_pagamento" têm erp_origem=NULL
    periodo_inicio: inicio || undefined,
    periodo_fim: fim || undefined,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyExceptions && r.auto_conciliado && r.status_match === "automatico") return false;
      if (statusFilter !== "all" && r.status_match !== statusFilter) return false;
      if (!q) return true;
      return (
        (r.cnpj_fornecedor || "").toLowerCase().includes(q) ||
        (r.razao_social_fornecedor || "").toLowerCase().includes(q) ||
        (r.nota_numero || "").toLowerCase().includes(q) ||
        (r.conta_paga_id_externo || "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, statusFilter, onlyExceptions]);

  const autoCount = useMemo(
    () => rows.filter((r) => r.auto_conciliado && r.status_match === "automatico").length,
    [rows],
  );

  const grouped = useMemo(() => {
    const g: Record<CenarioCruzamento, CruzamentoRow[]> = {
      pago_sem_nota: [], conciliado: [], nota_sem_pagamento: [],
    };
    for (const r of filtered) g[r.cenario].push(r);
    return g;
  }, [filtered]);

  const totals = useMemo(() => {
    const t = { pago_sem_nota: 0, conciliado: 0, nota_sem_pagamento: 0 } as Record<CenarioCruzamento, number>;
    for (const r of filtered) {
      t[r.cenario] += Number(r.conta_paga_valor ?? r.nota_valor ?? 0);
    }
    return t;
  }, [filtered]);

  async function handleRun() {
    if (!empresaId) return toast({ title: "Empresa logada não identificada", variant: "destructive" });
    setRunning(true);
    try {
      const res = await runCross(empresaId, inicio, fim);
      toast({
        title: "Cruzamento executado",
        description: `${res.notas_analisadas} notas · ${res.contas_analisadas} contas · ${res.auto_conciliados ?? 0} conciliadas automaticamente · ${res.excecoes ?? res.linhas_geradas} exceções`,
      });
    } catch (e) {
      toast({ title: "Falha no cruzamento", description: (e as Error).message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  }

  function handleExport() {
    const csv = toCsv(filtered);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cruzamento_${inicio}_${fim}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleConfirm(row: CruzamentoRow) {
    try {
      await updateRow(row.id, { status_match: "confirmado_manual" });
      toast({ title: "Match confirmado" });
    } catch (e) {
      toast({ title: "Falha ao confirmar", description: (e as Error).message, variant: "destructive" });
    }
  }
  async function handleIgnore(row: CruzamentoRow) {
    try {
      await updateRow(row.id, { status_match: "ignorado" });
      toast({ title: "Registro ignorado" });
    } catch (e) {
      toast({ title: "Falha ao ignorar", description: (e as Error).message, variant: "destructive" });
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div>
        <h2 className="text-xl font-bold">Cruzamento Fiscal</h2>
        <p className="text-sm text-muted-foreground">
          Duas visões: <strong>Nota × Pagamento</strong> (conciliação de baixas) e{" "}
          <strong>Pedido × NF de Entrada × MasterTax</strong> (cobertura documental no ERP).
        </p>
      </div>

      <Tabs value={view} onValueChange={(v) => setView(v as "pagamentos" | "documentos")}>
        <TabsList>
          <TabsTrigger value="documentos">PC × NF de Entrada × MasterTax</TabsTrigger>
          <TabsTrigger value="pagamentos">Nota × Pagamento</TabsTrigger>
        </TabsList>
      </Tabs>


      {/* Filtros de período */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
        <div className="col-span-2">
          <Label className="text-xs">Empresa</Label>
          <Input value={loggedCompany?.display_name || loggedCompanyDb || "—"} readOnly disabled />
        </div>
        <div>
          <Label className="text-xs">ERP</Label>
          <Input value={erp ? erp.toUpperCase() : "—"} readOnly disabled />
        </div>
        <div>
          <Label className="text-xs">Início</Label>
          <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Fim</Label>
          <Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button onClick={handleRun} disabled={running || !empresaId} className="flex-1">
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
            <span className="ml-1 hidden sm:inline">Executar</span>
          </Button>
          <Button variant="outline" size="icon" onClick={refresh} aria-label="Atualizar">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {!empresaId && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-600 text-sm px-3 py-2">
          Não foi possível identificar a empresa da sessão atual ({loggedCompanyDb || "sem companyDB"}).
        </div>
      )}

      {view === "documentos" && (
        <PoNfBoard companyDb={loggedCompanyDb} inicio={inicio} fim={fim} />
      )}

      {view === "pagamentos" && (<>
      {/* Busca e filtros de status */}

      <div className="flex flex-col sm:flex-row gap-2 sm:items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por CNPJ, fornecedor, NF ou ID no ERP..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <label className="flex items-center gap-2 text-xs mr-2 cursor-pointer">
            <Switch checked={onlyExceptions} onCheckedChange={setOnlyExceptions} aria-label="Somente exceções" />
            <span className="flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-emerald-600" />
              Somente exceções
              {autoCount > 0 && (
                <span className="text-muted-foreground">({autoCount} auto-conciliadas)</span>
              )}
            </span>
          </label>
          {(["all", "automatico", "ambiguo", "confirmado_manual", "ignorado"] as const).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={statusFilter === s ? "default" : "outline"}
              onClick={() => setStatusFilter(s)}
              className="h-7 text-xs"
            >
              {s === "all" ? "Todos" : STATUS_LABEL[s]}
            </Button>
          ))}
          <AutoReconcileSettings empresaId={empresaId} onSaved={refresh} />
          <Button variant="outline" size="sm" onClick={handleExport} disabled={filtered.length === 0} className="h-7">
            <Download className="w-3 h-3 mr-1" /> CSV
          </Button>
        </div>
      </div>


      {/* Kanban */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <KanbanColumn
          title="ERP"
          subtitle="Pagamentos sem nota localizada"
          accent="destructive"
          count={grouped.pago_sem_nota.length}
          total={totals.pago_sem_nota}
          emptyLabel={loading ? "Carregando…" : "Nenhum pagamento órfão no período."}
        >
          {grouped.pago_sem_nota.map((r) => (
            <CruzamentoCard key={r.id} row={r} onOpen={setDetailRow} onConfirm={handleConfirm} onIgnore={handleIgnore} />
          ))}
        </KanbanColumn>

        <KanbanColumn
          title="AMBOS"
          subtitle="Nota conciliada com pagamento"
          accent="success"
          count={grouped.conciliado.length}
          total={totals.conciliado}
          emptyLabel={loading ? "Carregando…" : "Nenhuma conciliação neste período. Execute o cruzamento."}
        >
          {grouped.conciliado.map((r) => (
            <CruzamentoCard key={r.id} row={r} onOpen={setDetailRow} onConfirm={handleConfirm} onIgnore={handleIgnore} />
          ))}
        </KanbanColumn>

        <KanbanColumn
          title="MasterTax"
          subtitle="Notas sem pagamento localizado"
          accent="warning"
          count={grouped.nota_sem_pagamento.length}
          total={totals.nota_sem_pagamento}
          emptyLabel={loading ? "Carregando…" : "Nenhuma nota órfã no período."}
        >
          {grouped.nota_sem_pagamento.map((r) => (
            <CruzamentoCard key={r.id} row={r} onOpen={setDetailRow} onConfirm={handleConfirm} onIgnore={handleIgnore} />
          ))}
        </KanbanColumn>
      </div>

      <CruzamentoDetailDrawer
        row={detailRow}
        open={!!detailRow}
        onOpenChange={(v) => !v && setDetailRow(null)}
        onConfirm={handleConfirm}
        onIgnore={handleIgnore}
      />
      </>)}

    </div>
  );
}
