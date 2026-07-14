import { useEffect, useMemo, useState } from "react";
import { Loader2, PlayCircle, ExternalLink, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useCompanies } from "@/hooks/useCompanies";
import { useSap } from "@/contexts/SapContext";
import { useAuditCrossFiscal, type CenarioCruzamento, type CruzamentoRow } from "@/hooks/useAuditCrossFiscal";

const CENARIO_LABEL: Record<CenarioCruzamento, string> = {
  pago_sem_nota: "Pago sem nota",
  nota_sem_pagamento: "Nota sem pagamento",
  conciliado: "Conciliado",
};

const CENARIO_VARIANT: Record<CenarioCruzamento, "destructive" | "secondary" | "default"> = {
  pago_sem_nota: "destructive",
  nota_sem_pagamento: "secondary",
  conciliado: "default",
};

const ERP_LABEL: Record<string, string> = { omie: "Omie", sap_b1: "SAP B1", sap: "SAP B1" };

function money(v: number | null | undefined) {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("pt-BR");
}

function toCsv(rows: CruzamentoRow[]): string {
  const head = [
    "Cenário", "ERP", "CNPJ", "Fornecedor", "NF Número", "NF Valor", "NF Emissão",
    "Conta ID", "Conta Valor", "Data Baixa", "Diferença R$", "Diferença dias",
    "Status", "Observação",
  ];
  const body = rows.map((r) => [
    CENARIO_LABEL[r.cenario], ERP_LABEL[r.erp_origem || ""] || r.erp_origem || "",
    r.cnpj_fornecedor, r.razao_social_fornecedor ?? "",
    r.nota_numero ?? "", r.nota_valor ?? "", r.nota_data_emissao ?? "",
    r.conta_paga_id_externo ?? "", r.conta_paga_valor ?? "", r.conta_paga_data_baixa ?? "",
    r.diferenca_valor ?? "", r.diferenca_dias ?? "",
    r.status_match, r.observacao_usuario ?? "",
  ]);
  return [head, ...body]
    .map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

export default function AuditCrossFiscal() {
  const { toast } = useToast();
  const { companies } = useCompanies();
  const activeCompanies = useMemo(() => (companies || []).filter((c: any) => c.is_active), [companies]);

  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const lastOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);

  const [empresaId, setEmpresaId] = useState<string>("");
  const [inicio, setInicio] = useState<string>(firstOfMonth);
  const [fim, setFim] = useState<string>(lastOfMonth);
  const [erp, setErp] = useState<string>("all");
  const [aba, setAba] = useState<CenarioCruzamento>("conciliado");
  const [running, setRunning] = useState(false);

  const { rows, loading, error, refresh, runCross, updateRow } = useAuditCrossFiscal({
    empresa_id: empresaId || undefined,
    erp_origem: erp !== "all" ? erp : undefined,
    periodo_inicio: inicio || undefined,
    periodo_fim: fim || undefined,
  });

  const stats = useMemo(() => {
    const s = { conciliado: { n: 0, total: 0 }, pago_sem_nota: { n: 0, total: 0 }, nota_sem_pagamento: { n: 0, total: 0 } };
    for (const r of rows) {
      s[r.cenario].n += 1;
      s[r.cenario].total += Number(r.conta_paga_valor ?? r.nota_valor ?? 0);
    }
    return s;
  }, [rows]);

  const rowsAba = useMemo(() => rows.filter((r) => r.cenario === aba), [rows, aba]);

  async function handleRun() {
    if (!empresaId) return toast({ title: "Selecione uma empresa", variant: "destructive" });
    setRunning(true);
    try {
      const res = await runCross(empresaId, inicio, fim);
      toast({
        title: "Cruzamento executado",
        description: `${res.notas_analisadas} notas · ${res.contas_analisadas} contas · ${res.linhas_geradas} linhas`,
      });
    } catch (e) {
      toast({ title: "Falha no cruzamento", description: (e as Error).message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  }

  function handleExport() {
    const csv = toCsv(rowsAba);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cruzamento_${aba}_${inicio}_${fim}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-xl font-bold">Cruzamento Fiscal × Pagamentos</h2>
        <p className="text-sm text-muted-foreground">
          Compara notas capturadas pelo MasterTax com contas pagas no ERP da empresa. Funciona para qualquer ERP registrado.
        </p>
      </div>

      {/* Filtros */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
        <div>
          <Label>Empresa</Label>
          <Select value={empresaId} onValueChange={setEmpresaId}>
            <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
            <SelectContent>
              {activeCompanies.map((c: any) => (
                <SelectItem key={c.id} value={c.id}>{c.display_name} ({(c.erp_type || "").toUpperCase()})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Início</Label>
          <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
        </div>
        <div>
          <Label>Fim</Label>
          <Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
        </div>
        <div>
          <Label>ERP</Label>
          <Select value={erp} onValueChange={setErp}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="omie">Omie</SelectItem>
              <SelectItem value="sap_b1">SAP B1</SelectItem>
              <SelectItem value="sap">SAP</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleRun} disabled={running || !empresaId}>
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
            Executar cruzamento
          </Button>
          <Button variant="outline" onClick={refresh}>Atualizar</Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-sm px-3 py-2">
          {error}
        </div>
      )}

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {(Object.keys(CENARIO_LABEL) as CenarioCruzamento[]).map((k) => (
          <button
            key={k}
            onClick={() => setAba(k)}
            className={`text-left rounded-md border p-4 hover:bg-muted/40 ${aba === k ? "border-primary" : "border-border"}`}
          >
            <div className="text-xs uppercase text-muted-foreground">{CENARIO_LABEL[k]}</div>
            <div className="text-2xl font-bold tabular-nums">{stats[k].n}</div>
            <div className="text-xs text-muted-foreground tabular-nums">{money(stats[k].total)}</div>
          </button>
        ))}
      </div>

      <Tabs value={aba} onValueChange={(v) => setAba(v as CenarioCruzamento)}>
        <div className="flex items-center justify-between">
          <TabsList>
            {(Object.keys(CENARIO_LABEL) as CenarioCruzamento[]).map((k) => (
              <TabsTrigger key={k} value={k}>{CENARIO_LABEL[k]}</TabsTrigger>
            ))}
          </TabsList>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={rowsAba.length === 0}>
            <Download className="w-4 h-4" /> Exportar CSV
          </Button>
        </div>

        {(Object.keys(CENARIO_LABEL) as CenarioCruzamento[]).map((k) => (
          <TabsContent key={k} value={k} className="mt-4">
            <div className="rounded-md border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead>CNPJ</TableHead>
                    <TableHead>NF</TableHead>
                    <TableHead className="text-right">Valor NF</TableHead>
                    <TableHead className="text-right">Valor pago</TableHead>
                    <TableHead className="text-right">Δ R$</TableHead>
                    <TableHead className="text-right">Δ dias</TableHead>
                    <TableHead>ERP</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && (
                    <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">Carregando…</TableCell></TableRow>
                  )}
                  {!loading && rowsAba.length === 0 && (
                    <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                      Nenhum registro. Execute o cruzamento para gerar dados.
                    </TableCell></TableRow>
                  )}
                  {rowsAba.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="max-w-[260px] truncate">{r.razao_social_fornecedor || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{r.cnpj_fornecedor}</TableCell>
                      <TableCell className="font-mono text-xs">{r.nota_numero || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(r.nota_valor)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(r.conta_paga_valor)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.diferenca_valor != null ? money(r.diferenca_valor) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.diferenca_dias ?? "—"}</TableCell>
                      <TableCell>
                        {r.erp_origem
                          ? <Badge variant="outline">{ERP_LABEL[r.erp_origem] || r.erp_origem}</Badge>
                          : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.status_match === "ambiguo" ? "destructive" : "secondary"}>
                          {r.status_match}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {r.conta_paga_link_origem && (
                          <a href={r.conta_paga_link_origem} target="_blank" rel="noreferrer"
                             className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                            <ExternalLink className="w-3 h-3" /> ERP
                          </a>
                        )}
                        {r.status_match === "ambiguo" && (
                          <Button
                            variant="ghost" size="sm"
                            onClick={() => updateRow(r.id, { status_match: "confirmado_manual" })}
                          >
                            Confirmar
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
