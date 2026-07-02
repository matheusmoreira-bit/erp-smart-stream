import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, RefreshCw, ShieldCheck, ShieldAlert, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PageTitle } from "@/components/PageTitle";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

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

export default function AuditTrailPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<AuditTrailRow[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tableFilter, setTableFilter] = useState<string>("all");
  const [opFilter, setOpFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; total: number; broken: number | null } | null>(null);
  const [detail, setDetail] = useState<AuditTrailRow | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    let q = supabase
      .from("audit_trail" as never)
      .select("id, ts, actor_id, actor_email, actor_role, schema_name, table_name, op, row_pk, old_data, new_data, changed_cols")
      .order("id", { ascending: false })
      .limit(500);
    if (tableFilter !== "all") q = q.eq("table_name", tableFilter);
    if (opFilter !== "all") q = q.eq("op", opFilter);
    const { data, error } = await q;
    if (error) {
      toast({ title: "Erro ao carregar audit_trail", description: error.message, variant: "destructive" });
      setRows([]);
    } else {
      setRows((data as unknown as AuditTrailRow[]) || []);
    }
    setIsLoading(false);
  }, [tableFilter, opFilter]);

  useEffect(() => { load(); }, [load]);

  // Load distinct tables once
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("audit_trail" as never)
        .select("table_name")
        .limit(5000);
      const set = new Set<string>();
      ((data as unknown as { table_name: string }[]) || []).forEach(r => set.add(r.table_name));
      setTables(Array.from(set).sort());
    })();
  }, []);

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

  const filtered = rows.filter(r => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      r.actor_email?.toLowerCase().includes(s) ||
      r.table_name.toLowerCase().includes(s) ||
      JSON.stringify(r.row_pk || {}).toLowerCase().includes(s) ||
      JSON.stringify(r.new_data || r.old_data || {}).toLowerCase().includes(s)
    );
  });

  return (
    <div className="min-h-screen bg-background">
      <PageTitle title="Audit Trail" />
      <header className="border-b border-border px-6 py-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => navigate("/backoffice")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-foreground">Audit Trail</h1>
              <p className="text-sm text-muted-foreground">
                Registro imutável (append-only + hash chain) de todas as operações do banco
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
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
          </div>
        </div>
      </header>

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

        <Card className="p-4 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por usuário, tabela, valor..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={tableFilter} onValueChange={setTableFilter}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Tabela" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as tabelas</SelectItem>
              {tables.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={opFilter} onValueChange={setOpFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Operação" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="I">INSERT</SelectItem>
              <SelectItem value="U">UPDATE</SelectItem>
              <SelectItem value="D">DELETE</SelectItem>
            </SelectContent>
          </Select>
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
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Sem registros</TableCell></TableRow>
              ) : filtered.map(r => (
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
