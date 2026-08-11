import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import {
  ArrowLeft,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  ScrollText,
  Search,
  CalendarIcon,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { BackofficePageHeader } from "@/components/BackofficePageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PageTitle } from "@/components/PageTitle";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface AuditTrailRow {
  id: number;
  ts: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  schema_name: string;
  table_name: string;
  op: "I" | "U" | "D";
  row_pk: Record<string, unknown> | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  changed_cols: string[] | null;
}

const OP_LABEL: Record<string, string> = { I: "INSERT", U: "UPDATE", D: "DELETE" };
const OP_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  I: "default",
  U: "secondary",
  D: "destructive",
};

const PAGE_SIZES = [25, 50, 100, 200];

function DateField({
  value,
  onChange,
  placeholder,
}: {
  value: Date | undefined;
  onChange: (d: Date | undefined) => void;
  placeholder: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn("w-[170px] justify-start text-left font-normal", !value && "text-muted-foreground")}
        >
          <CalendarIcon className="w-4 h-4 mr-2" />
          {value ? format(value, "dd/MM/yyyy") : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={onChange}
          initialFocus
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
    </Popover>
  );
}

export default function AuditTrailPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<AuditTrailRow[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [tables, setTables] = useState<string[]>([]);
  const [actors, setActors] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [tableFilter, setTableFilter] = useState<string>("all");
  const [opFilter, setOpFilter] = useState<string>("all");
  const [actorFilter, setActorFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [search, setSearch] = useState("");

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // Verify + detail
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; total: number; broken: number | null } | null>(null);
  const [detail, setDetail] = useState<AuditTrailRow | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const applyFilters = useCallback(
    <T,>(q: T): T => {
      let b = q as unknown as ReturnType<typeof supabase.from>["select"] extends never ? never : any;
      if (tableFilter !== "all") b = b.eq("table_name", tableFilter);
      if (opFilter !== "all") b = b.eq("op", opFilter);
      if (actorFilter !== "all") b = b.eq("actor_email", actorFilter);
      if (dateFrom) b = b.gte("ts", dateFrom.toISOString());
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        b = b.lte("ts", end.toISOString());
      }
      const s = search.trim();
      if (s) {
        b = b.or(`actor_email.ilike.%${s}%,table_name.ilike.%${s}%`);
      }
      return b as T;
    },
    [tableFilter, opFilter, actorFilter, dateFrom, dateTo, search],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // Lista leve: sem old_data/new_data (jsonb pesado) — carregados sob demanda no detalhe.
    // Contagem "planned" evita full scan em ~700k registros.
    const q = applyFilters(
      supabase
        .from("audit_trail" as never)
        .select("id, ts, actor_id, actor_email, actor_role, schema_name, table_name, op, row_pk, changed_cols", {
          count: "planned",
        })
        .order("id", { ascending: false })
        .range(from, to),
    );

    const { data, error, count } = await q;
    if (error) {
      toast({ title: "Erro ao carregar audit_trail", description: error.message, variant: "destructive" });
      setRows([]);
      setTotal(0);
    } else {
      const list = (data as unknown as AuditTrailRow[]) || [];
      setRows(list);
      setTotal(Math.max(count || 0, from + list.length));
    }
    setIsLoading(false);
  }, [applyFilters, page, pageSize]);

  useEffect(() => { load(); }, [load]);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [tableFilter, opFilter, actorFilter, dateFrom, dateTo, search, pageSize]);

  // Load distinct tables + actors once (RPC agregada — evita baixar 10k linhas)
  useEffect(() => {
    (async () => {
      const { data } = await (supabase.rpc as unknown as (fn: string) => Promise<{ data: unknown }>)(
        "audit_trail_filter_options",
      );
      const row = (Array.isArray(data) ? data[0] : data) as { tables: string[] | null; actors: string[] | null } | null;
      setTables(row?.tables ?? []);
      setActors(row?.actors ?? []);
    })();
  }, []);

  const openDetail = async (row: AuditTrailRow) => {
    setDetail(row);
    const { data } = await supabase
      .from("audit_trail" as never)
      .select("old_data, new_data")
      .eq("id", row.id)
      .maybeSingle();
    const full = data as unknown as { old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null } | null;
    if (full) setDetail(cur => (cur && cur.id === row.id ? { ...cur, ...full } : cur));
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const CHUNK = 1000;
      const MAX = 100000;
      const all: AuditTrailRow[] = [];
      for (let offset = 0; offset < MAX; offset += CHUNK) {
        const { data, error } = await applyFilters(
          supabase
            .from("audit_trail" as never)
            .select("id, ts, actor_id, actor_email, actor_role, schema_name, table_name, op, row_pk, changed_cols")
            .order("id", { ascending: false })
            .range(offset, offset + CHUNK - 1),
        );
        if (error) throw error;
        const batch = (data as unknown as AuditTrailRow[]) || [];
        all.push(...batch);
        if (batch.length < CHUNK) break;
      }

      const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const header = ["id", "data_hora", "usuario", "role", "schema", "tabela", "operacao", "chave", "colunas_alteradas"];
      const lines = [header.join(";")];
      for (const r of all) {
        lines.push(
          [
            r.id,
            new Date(r.ts).toLocaleString("pt-BR"),
            r.actor_email ?? "",
            r.actor_role ?? "",
            r.schema_name,
            r.table_name,
            OP_LABEL[r.op] ?? r.op,
            r.row_pk ? JSON.stringify(r.row_pk) : "",
            (r.changed_cols ?? []).join(", "),
          ]
            .map(esc)
            .join(";"),
        );
      }
      const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-trail-${format(new Date(), "yyyy-MM-dd-HHmm")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Exportação concluída", description: `${all.length.toLocaleString("pt-BR")} registros exportados.` });
    } catch (e) {
      toast({
        title: "Falha ao exportar",
        description: e instanceof Error ? e.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };


  const runVerify = async () => {
    setVerifying(true);
    setVerifyResult(null);
    const { data, error } = await (supabase.rpc as unknown as (fn: string) => Promise<{ data: unknown; error: { message: string } | null }>)("verify_audit_chain");
    setVerifying(false);
    if (error) {
      toast({ title: "Falha na verificação", description: error.message, variant: "destructive" });
      return;
    }
    const arr = Array.isArray(data) ? data : [];
    const row = arr.length > 0 ? (arr[0] as { first_broken_id: number | null; total_checked: number; ok: boolean }) : null;
    if (row) {
      setVerifyResult({ ok: row.ok, total: Number(row.total_checked), broken: row.first_broken_id });
      toast({
        title: row.ok ? "Cadeia íntegra" : "Cadeia comprometida",
        description: row.ok
          ? `${row.total_checked} registros verificados com sucesso.`
          : `Quebra detectada no registro #${row.first_broken_id}`,
        variant: row.ok ? "default" : "destructive",
      });
    }
  };

  const clearFilters = () => {
    setTableFilter("all");
    setOpFilter("all");
    setActorFilter("all");
    setDateFrom(undefined);
    setDateTo(undefined);
    setSearch("");
  };

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (tableFilter !== "all") n++;
    if (opFilter !== "all") n++;
    if (actorFilter !== "all") n++;
    if (dateFrom) n++;
    if (dateTo) n++;
    if (search.trim()) n++;
    return n;
  }, [tableFilter, opFilter, actorFilter, dateFrom, dateTo, search]);

  const rangeLabel = total === 0
    ? "0 registros"
    : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} de ${total.toLocaleString("pt-BR")}`;

  return (
    <div className="min-h-screen bg-background">
      <BackofficePageHeader
        title="Audit Trail"
        description="Registro imutável (append-only + hash chain) de todas as operações do banco"
        icon={<ScrollText className="w-5 h-5 text-primary" />}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={load} disabled={isLoading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
            <Button size="sm" onClick={runVerify} disabled={verifying}>
              {verifyResult?.ok === false ? (
                <ShieldAlert className="w-4 h-4 mr-2" />
              ) : (
                <ShieldCheck className="w-4 h-4 mr-2" />
              )}
              {verifying ? "Verificando..." : "Verificar integridade"}
            </Button>
          </>
        }
      />


      <main className="max-w-7xl mx-auto px-6 py-6 space-y-4">
        {verifyResult && (
          <Card className={`p-4 border-2 ${verifyResult.ok ? "border-green-500/40 bg-green-500/5" : "border-destructive/40 bg-destructive/5"}`}>
            <div className="flex items-center gap-3">
              {verifyResult.ok ? (
                <ShieldCheck className="w-6 h-6 text-green-500" />
              ) : (
                <ShieldAlert className="w-6 h-6 text-destructive" />
              )}
              <div>
                <div className="font-medium">
                  {verifyResult.ok ? "Cadeia íntegra" : `Cadeia comprometida no registro #${verifyResult.broken}`}
                </div>
                <div className="text-xs text-muted-foreground">
                  {verifyResult.total} registros verificados
                </div>
              </div>
            </div>
          </Card>
        )}

        <Card className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Buscar</Label>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Usuário, tabela, chave..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Usuário / ator</Label>
              <Select value={actorFilter} onValueChange={setActorFilter}>
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os usuários</SelectItem>
                  {actors.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Tabela</Label>
              <Select value={tableFilter} onValueChange={setTableFilter}>
                <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as tabelas</SelectItem>
                  {tables.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Operação</Label>
              <Select value={opFilter} onValueChange={setOpFilter}>
                <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="I">INSERT</SelectItem>
                  <SelectItem value="U">UPDATE</SelectItem>
                  <SelectItem value="D">DELETE</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">De</Label>
              <DateField value={dateFrom} onChange={setDateFrom} placeholder="Data inicial" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Até</Label>
              <DateField value={dateTo} onChange={setDateTo} placeholder="Data final" />
            </div>
            <div className="ml-auto flex items-center gap-2">
              {activeFilterCount > 0 && (
                <>
                  <Badge variant="secondary">{activeFilterCount} filtro{activeFilterCount > 1 ? "s" : ""}</Badge>
                  <Button variant="ghost" size="sm" onClick={clearFilters}>
                    <X className="w-4 h-4 mr-1" /> Limpar
                  </Button>
                </>
              )}
            </div>
          </div>
        </Card>

        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[70px]">#</TableHead>
                <TableHead className="w-[170px]">Quando</TableHead>
                <TableHead>Usuário</TableHead>
                <TableHead>Tabela</TableHead>
                <TableHead className="w-[110px]">Operação</TableHead>
                <TableHead>Chave / colunas alteradas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Sem registros</TableCell></TableRow>
              ) : rows.map(r => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setDetail(r)}>
                  <TableCell className="font-mono text-xs">{r.id}</TableCell>
                  <TableCell className="text-xs">{new Date(r.ts).toLocaleString("pt-BR")}</TableCell>
                  <TableCell className="text-xs">
                    <div>{r.actor_email || <span className="text-muted-foreground">—</span>}</div>
                    {r.actor_role && <div className="text-muted-foreground">{r.actor_role}</div>}
                  </TableCell>
                  <TableCell className="text-xs font-mono">{r.table_name}</TableCell>
                  <TableCell><Badge variant={OP_VARIANT[r.op]}>{OP_LABEL[r.op]}</Badge></TableCell>
                  <TableCell className="text-xs">
                    <div className="font-mono truncate max-w-[380px]">
                      {r.row_pk ? JSON.stringify(r.row_pk) : "—"}
                    </div>
                    {r.changed_cols && r.changed_cols.length > 0 && (
                      <div className="text-muted-foreground truncate max-w-[380px]">
                        {r.changed_cols.join(", ")}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex flex-wrap items-center justify-between gap-3 p-3 border-t border-border">
            <div className="text-xs text-muted-foreground">{rangeLabel}</div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Por página</span>
                <Select value={String(pageSize)} onValueChange={v => setPageSize(Number(v))}>
                  <SelectTrigger className="w-[80px] h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZES.map(s => <SelectItem key={s} value={String(s)}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1 || isLoading}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-xs px-2 min-w-[90px] text-center">
                  Página {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || isLoading}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </main>

      <Dialog open={!!detail} onOpenChange={o => !o && setDetail(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>
              Registro #{detail?.id} — {detail?.table_name} <Badge variant={detail ? OP_VARIANT[detail.op] : "default"} className="ml-2">{detail && OP_LABEL[detail.op]}</Badge>
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div><span className="text-muted-foreground">Quando:</span> {new Date(detail.ts).toLocaleString("pt-BR")}</div>
                <div><span className="text-muted-foreground">Usuário:</span> {detail.actor_email || "—"}</div>
                <div><span className="text-muted-foreground">Role SQL:</span> {detail.actor_role || "—"}</div>
                <div><span className="text-muted-foreground">Actor ID:</span> <span className="font-mono text-xs">{detail.actor_id || "—"}</span></div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Chave</div>
                <pre className="bg-muted p-3 rounded text-xs overflow-auto">{JSON.stringify(detail.row_pk, null, 2)}</pre>
              </div>
              {detail.changed_cols && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Colunas alteradas</div>
                  <div className="flex flex-wrap gap-1">
                    {detail.changed_cols.map(c => <Badge key={c} variant="outline">{c}</Badge>)}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Antes</div>
                  <pre className="bg-muted p-3 rounded text-xs overflow-auto max-h-[400px]">{JSON.stringify(detail.old_data, null, 2) || "—"}</pre>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Depois</div>
                  <pre className="bg-muted p-3 rounded text-xs overflow-auto max-h-[400px]">{JSON.stringify(detail.new_data, null, 2) || "—"}</pre>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
