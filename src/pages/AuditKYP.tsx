import { useMemo, useState } from "react";
import { Loader2, RefreshCw, ShieldCheck, Search, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useCompanies } from "@/hooks/useCompanies";
import {
  ACAO_LABEL, maskDocumento, reprocessarKyp, useKypAvaliacoes, useKypConfig,
  type KypFiltros,
} from "@/hooks/useKyp";

const today = new Date();
const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);

function AcaoBadge({ acao, sucesso }: { acao: string; sucesso: boolean }) {
  if (!sucesso || acao === "ERRO") return <Badge variant="destructive">{ACAO_LABEL[acao] ?? acao}</Badge>;
  if (acao === "DEACTIVATE") return <Badge variant="destructive">{ACAO_LABEL[acao]}</Badge>;
  if (acao === "CREATE") return <Badge variant="default">{ACAO_LABEL[acao]}</Badge>;
  return <Badge variant="secondary">{ACAO_LABEL[acao] ?? acao}</Badge>;
}

export default function AuditKYP() {
  const { toast } = useToast();
  const { companies } = useCompanies();
  const [filtros, setFiltros] = useState<KypFiltros>({
    companyDb: "todas",
    acao: "todas",
    status: "todos",
    from: firstOfMonth,
    to: today.toISOString().slice(0, 10),
    busca: "",
  });
  const [reprocessando, setReprocessando] = useState<string | null>(null);

  const { rows, loading, error, reload } = useKypAvaliacoes(filtros);
  const { providers, configs, loading: loadingCfg, salvar } = useKypConfig();

  const resumo = useMemo(() => {
    const acc = { NOOP: 0, CREATE: 0, DEACTIVATE: 0, ERRO: 0 } as Record<string, number>;
    for (const r of rows) acc[r.acao] = (acc[r.acao] ?? 0) + 1;
    return acc;
  }, [rows]);

  const set = (patch: Partial<KypFiltros>) => setFiltros((f) => ({ ...f, ...patch }));

  const handleReprocessar = async (documento: string | null) => {
    if (!documento) return;
    setReprocessando(documento);
    try {
      await reprocessarKyp(documento);
      toast({ title: "Reavaliação concluída", description: "A diligência foi reprocessada." });
      await reload();
    } catch (e) {
      toast({
        title: "Não foi possível reavaliar",
        description: "Tente novamente em instantes ou contate o time de compliance.",
        variant: "destructive",
      });
    } finally {
      setReprocessando(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-5 w-5 text-primary" aria-hidden />
        <div>
          <h1 className="text-xl font-semibold">KYP — Diligência de fornecedores</h1>
          <p className="text-sm text-muted-foreground">
            Varredura horária dos fornecedores de todos os ERPs conectados, com criação de diligência
            e bloqueio automático de reprovados.
          </p>
        </div>
      </div>

      <Tabs defaultValue="atividade">
        <TabsList>
          <TabsTrigger value="atividade">Atividade</TabsTrigger>
          <TabsTrigger value="config">
            <Settings2 className="mr-2 h-4 w-4" aria-hidden />Configuração por empresa
          </TabsTrigger>
        </TabsList>

        <TabsContent value="atividade" className="space-y-4">
          <div className="grid gap-3 md:grid-cols-6">
            <div className="space-y-1">
              <Label htmlFor="kyp-empresa">Empresa</Label>
              <Select value={filtros.companyDb} onValueChange={(v) => set({ companyDb: v })}>
                <SelectTrigger id="kyp-empresa"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {(companies ?? []).map((c: any) => (
                    <SelectItem key={c.id} value={c.company_db}>{c.display_name || c.company_db}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="kyp-acao">Ação</Label>
              <Select value={filtros.acao} onValueChange={(v) => set({ acao: v })}>
                <SelectTrigger id="kyp-acao"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {Object.entries(ACAO_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="kyp-status">Resultado</Label>
              <Select value={filtros.status} onValueChange={(v) => set({ status: v })}>
                <SelectTrigger id="kyp-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="sucesso">Sucesso</SelectItem>
                  <SelectItem value="falha">Falha</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="kyp-from">De</Label>
              <Input id="kyp-from" type="date" value={filtros.from} onChange={(e) => set({ from: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="kyp-to">Até</Label>
              <Input id="kyp-to" type="date" value={filtros.to} onChange={(e) => set({ to: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="kyp-busca">Buscar</Label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
                <Input
                  id="kyp-busca"
                  className="pl-8"
                  placeholder="Nome ou documento"
                  value={filtros.busca}
                  onChange={(e) => set({ busca: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {Object.entries(ACAO_LABEL).map(([k, v]) => (
              <Badge key={k} variant="outline">{v}: {resumo[k] ?? 0}</Badge>
            ))}
            <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
              Atualizar
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center gap-2 p-10 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Carregando atividade…
                </div>
              ) : error ? (
                <div className="p-10 text-center text-sm text-muted-foreground">
                  Não foi possível carregar a atividade de KYP agora.
                </div>
              ) : rows.length === 0 ? (
                <div className="p-10 text-center text-sm text-muted-foreground">
                  Nenhuma avaliação de KYP no período selecionado.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Fornecedor</TableHead>
                      <TableHead>Documento</TableHead>
                      <TableHead>Ação</TableHead>
                      <TableHead>Motivo</TableHead>
                      <TableHead>Empresas</TableHead>
                      <TableHead>Origem</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap text-sm">
                          {new Date(r.executado_em).toLocaleString("pt-BR")}
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate">{r.nome ?? "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{maskDocumento(r.documento)}</TableCell>
                        <TableCell><AcaoBadge acao={r.acao} sucesso={r.sucesso} /></TableCell>
                        <TableCell className="max-w-[280px] truncate text-sm text-muted-foreground">
                          {r.motivo ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {(r.empresas_afetadas ?? []).join(", ") || "—"}
                        </TableCell>
                        <TableCell className="text-xs">{r.disparado_por}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleReprocessar(r.documento)}
                            disabled={reprocessando === r.documento}
                          >
                            {reprocessando === r.documento
                              ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                              : "Reavaliar"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="config">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Provedor de KYP por empresa</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingCfg ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Carregando configuração…
                </div>
              ) : (companies ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma empresa cadastrada.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Empresa</TableHead>
                      <TableHead>ERP</TableHead>
                      <TableHead>Provedor</TableHead>
                      <TableHead>KYP ativo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(companies ?? []).map((c: any) => {
                      const cfg = configs.find((x) => x.company_id === c.id);
                      return (
                        <TableRow key={c.id}>
                          <TableCell>{c.display_name || c.company_db}</TableCell>
                          <TableCell className="uppercase text-xs">{c.erp_type || "sap"}</TableCell>
                          <TableCell>
                            <Select
                              value={cfg?.kyp_provider_id ?? providers.find((p) => p.code === "BECOMPLIANCE")?.id ?? ""}
                              onValueChange={(v) => {
                                salvar(c.id, { kyp_provider_id: v }).catch(() =>
                                  toast({ title: "Não foi possível salvar", variant: "destructive" }));
                              }}
                            >
                              <SelectTrigger className="w-[220px]">
                                <SelectValue placeholder="Selecionar" />
                              </SelectTrigger>
                              <SelectContent>
                                {providers.map((p) => (
                                  <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Switch
                              aria-label={`KYP ativo para ${c.display_name || c.company_db}`}
                              checked={cfg?.ativo ?? true}
                              onCheckedChange={(v) => {
                                salvar(c.id, { ativo: v }).catch(() =>
                                  toast({ title: "Não foi possível salvar", variant: "destructive" }));
                              }}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
