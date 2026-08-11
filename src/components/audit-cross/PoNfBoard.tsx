import { useMemo, useState } from "react";
import { Download, Loader2, PlayCircle, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { KanbanColumn } from "@/components/audit-cross/KanbanColumn";
import { useAuditPoNf, type PoNfRow } from "@/hooks/useAuditPoNf";

const fmtMoney = (v?: number | null) =>
  typeof v === "number" ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";

const fmtDate = (v?: string | null) => (v ? new Date(`${v}T00:00:00`).toLocaleDateString("pt-BR") : "—");

function RowCard({ r }: { r: PoNfRow }) {
  return (
    <div className="rounded-md border bg-card p-3 text-xs space-y-1">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium truncate">{r.card_name || r.card_code || r.cnpj_fornecedor || "—"}</span>
        <span className="font-semibold whitespace-nowrap">
          {fmtMoney(r.po_total ?? r.mastertax_valor ?? r.nf_total)}
        </span>
      </div>
      <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
        {r.po_doc_num != null && <span>PC #{r.po_doc_num} · {fmtDate(r.po_date)}</span>}
        {r.nf_doc_num != null && <span>NF SAP #{r.nf_doc_num} · {fmtDate(r.nf_date)}</span>}
        {r.mastertax_numero && <span>MasterTax {r.mastertax_numero}</span>}
        {r.data_emissao && <span>Emissão {fmtDate(r.data_emissao)}</span>}
      </div>
      {r.motivo && <div className="text-[11px] text-muted-foreground italic">{r.motivo}</div>}
    </div>
  );
}

function toCsv(rows: Array<PoNfRow & { coluna: string }>): string {
  const head = [
    "Coluna", "Fornecedor", "CNPJ", "PC DocNum", "PC Data", "PC Valor",
    "NF SAP DocNum", "NF SAP Data", "NF SAP Valor",
    "MasterTax Nº", "MasterTax Chave", "MasterTax Valor", "MasterTax Status", "Emissão", "Motivo",
  ];
  const body = rows.map((r) => [
    r.coluna, r.card_name ?? r.card_code ?? "", r.cnpj_fornecedor ?? "",
    r.po_doc_num ?? "", r.po_date ?? "", r.po_total ?? "",
    r.nf_doc_num ?? "", r.nf_date ?? "", r.nf_total ?? "",
    r.mastertax_numero ?? "", r.mastertax_chave ?? "", r.mastertax_valor ?? "", r.mastertax_status ?? "",
    r.data_emissao ?? "", r.motivo ?? "",
  ]);
  return [head, ...body]
    .map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

interface Props {
  companyDb: string;
  inicio: string;
  fim: string;
}

export function PoNfBoard({ companyDb, inicio, fim }: Props) {
  const { toast } = useToast();
  const { data, loading, run } = useAuditPoNf();
  const [search, setSearch] = useState("");

  const filterRows = (rows: PoNfRow[]) => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.card_name, r.card_code, r.cnpj_fornecedor, r.mastertax_numero, r.mastertax_chave, String(r.po_doc_num ?? ""), String(r.nf_doc_num ?? "")]
        .some((v) => (v || "").toLowerCase().includes(q)),
    );
  };

  const cols = useMemo(() => ({
    erp: filterRows(data?.erp || []),
    ambos: filterRows(data?.ambos || []),
    mastertax: filterRows(data?.mastertax || []),
  }), [data, search]);

  const sum = (rows: PoNfRow[]) =>
    rows.reduce((acc, r) => acc + Number(r.po_total ?? r.mastertax_valor ?? r.nf_total ?? 0), 0);

  async function handleRun() {
    if (!companyDb) return toast({ title: "Empresa não identificada", variant: "destructive" });
    try {
      const res = await run(companyDb, inicio, fim);
      toast({
        title: "Cruzamento PC × NF × MasterTax",
        description: `${res.totais.pedidos} pedidos · ${res.totais.nf_sap} NF no SAP · ${res.totais.mastertax} MasterTax → A ${res.totais.a} | B ${res.totais.b} | C ${res.totais.c}`,
      });
    } catch (e) {
      toast({ title: "Falha no cruzamento", description: (e as Error).message, variant: "destructive" });
    }
  }

  function handleExport() {
    const rows = [
      ...cols.erp.map((r) => ({ ...r, coluna: "A - ERP" })),
      ...cols.ambos.map((r) => ({ ...r, coluna: "B - Ambos" })),
      ...cols.mastertax.map((r) => ({ ...r, coluna: "C - MasterTax" })),
    ];
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pc_nf_mastertax_${inicio}_${fim}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por fornecedor, CNPJ, nº do PC, NF ou chave..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleRun} disabled={loading || !companyDb}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
            <span className="ml-1">Executar cruzamento</span>
          </Button>
          <Button size="sm" variant="outline" onClick={handleExport} disabled={!data}>
            <Download className="w-3 h-3 mr-1" /> CSV
          </Button>
        </div>
      </div>

      {data && (
        <div className="text-xs text-muted-foreground">
          Período {fmtDate(data.periodo.inicio)} — {fmtDate(data.periodo.fim)} ·{" "}
          {data.totais.pedidos} pedidos de compra · {data.totais.nf_sap} NF de Entrada no SAP ·{" "}
          {data.totais.mastertax} notas capturadas pelo MasterTax
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <KanbanColumn
          title="A · ERP"
          subtitle="PC sem NF de Entrada e/ou sem nota no MasterTax"
          accent="destructive"
          count={cols.erp.length}
          total={sum(cols.erp)}
          emptyLabel={loading ? "Carregando…" : data ? "Nenhum pedido pendente no período." : "Execute o cruzamento."}
        >
          {cols.erp.map((r, i) => <RowCard key={`a-${r.po_doc_entry}-${i}`} r={r} />)}
        </KanbanColumn>

        <KanbanColumn
          title="B · Ambos"
          subtitle="PC com NF de Entrada vinculada e nota capturada"
          accent="success"
          count={cols.ambos.length}
          total={sum(cols.ambos)}
          emptyLabel={loading ? "Carregando…" : data ? "Nenhum caso conciliado no período." : "Execute o cruzamento."}
        >
          {cols.ambos.map((r, i) => <RowCard key={`b-${r.po_doc_entry}-${i}`} r={r} />)}
        </KanbanColumn>

        <KanbanColumn
          title="C · MasterTax"
          subtitle="Nota capturada sem lançamento no SAP e/ou sem PC"
          accent="warning"
          count={cols.mastertax.length}
          total={sum(cols.mastertax)}
          emptyLabel={loading ? "Carregando…" : data ? "Nenhuma nota órfã no período." : "Execute o cruzamento."}
        >
          {cols.mastertax.map((r, i) => <RowCard key={`c-${r.mastertax_id}-${i}`} r={r} />)}
        </KanbanColumn>
      </div>
    </div>
  );
}
