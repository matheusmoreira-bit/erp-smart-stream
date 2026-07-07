import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageTitle } from "@/components/PageTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, ArrowRightLeft, RefreshCw, Loader2, Search } from "lucide-react";

interface TransferRow {
  id: string;
  actor_email: string | null;
  entity_id: string;
  company_db: string | null;
  created_at: string;
  details: {
    from?: string;
    to?: string;
    costCenter?: string | null;
    totalAmount?: number | null;
    requester?: string | null;
    reason?: string | null;
  } | null;
}

interface CompanyOpt { company_db: string; display_name: string }

const PAGE_SIZE = 50;

export default function TransferApprovalsHistory() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [companies, setCompanies] = useState<CompanyOpt[]>([]);
  const [companyDb, setCompanyDb] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    supabase.from("companies").select("company_db, display_name")
      .eq("is_active", true).order("display_name")
      .then(({ data }) => setCompanies(data || []));
  }, []);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      let q = supabase.from("audit_log")
        .select("id, actor_email, entity_id, company_db, created_at, details")
        .eq("action", "transfer_approval")
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
      if (companyDb !== "all") q = q.eq("company_db", companyDb);
      const { data, error } = await q;
      if (error) throw error;
      const list = (data || []) as TransferRow[];
      setHasMore(list.length > PAGE_SIZE);
      setRows(list.slice(0, PAGE_SIZE));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar histórico");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [companyDb, page]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => {
      const d = r.details || {};
      return (
        (r.actor_email || "").toLowerCase().includes(s) ||
        (d.from || "").toLowerCase().includes(s) ||
        (d.to || "").toLowerCase().includes(s) ||
        (d.costCenter || "").toLowerCase().includes(s) ||
        (d.requester || "").toLowerCase().includes(s) ||
        (r.entity_id || "").toLowerCase().includes(s)
      );
    });
  }, [rows, search]);

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });
  const money = (n: number | null | undefined) =>
    typeof n === "number"
      ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
      : "—";

  return (
    <div className="min-h-screen bg-background">
      <PageTitle title="Histórico de transferências de aprovação" />
      <div className="max-w-7xl mx-auto p-6 space-y-5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/backoffice")}>
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Backoffice
          </Button>
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-semibold text-foreground">
              Histórico de transferências de aprovação
            </h1>
          </div>
        </div>

        <div className="glass-card p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Empresa</Label>
            <Select value={companyDb} onValueChange={(v) => { setPage(0); setCompanyDb(v); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c.company_db} value={c.company_db}>
                    {c.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs">Busca (executor, origem, destino, CC, solicitante, expense id)</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filtrar resultados..."
                className="pl-8"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {loading ? "Carregando..." : `${filtered.length} registro(s) exibidos`}
            {search && rows.length !== filtered.length ? ` (de ${rows.length} na página)` : ""}
          </p>
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
            Atualizar
          </Button>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 text-destructive p-3 text-sm">
            {error}
          </div>
        )}

        <div className="glass-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Executado por</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>De → Para</TableHead>
                <TableHead>CC</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Solicitante</TableHead>
                <TableHead>Despesa</TableHead>
                <TableHead>Motivo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!loading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    Nenhuma transferência encontrada.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((r) => {
                const d = r.details || {};
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs whitespace-nowrap">
                      {fmt(r.created_at)}
                    </TableCell>
                    <TableCell className="text-xs">{r.actor_email || "—"}</TableCell>
                    <TableCell className="text-xs">{r.company_db || "—"}</TableCell>
                    <TableCell className="text-xs">
                      <span className="text-muted-foreground">{d.from || "—"}</span>
                      <span className="mx-1.5 text-primary">→</span>
                      <span className="font-medium">{d.to || "—"}</span>
                    </TableCell>
                    <TableCell className="text-xs font-mono">{d.costCenter || "—"}</TableCell>
                    <TableCell className="text-xs font-mono text-right">
                      {money(d.totalAmount ?? null)}
                    </TableCell>
                    <TableCell className="text-xs">{d.requester || "—"}</TableCell>
                    <TableCell className="text-[10px] font-mono text-muted-foreground">
                      {r.entity_id.slice(0, 8)}…
                    </TableCell>
                    <TableCell className="text-xs max-w-[240px] truncate" title={d.reason || ""}>
                      {d.reason || "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0 || loading}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            ← Anterior
          </Button>
          <span className="text-xs text-muted-foreground">Página {page + 1}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasMore || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima →
          </Button>
        </div>
      </div>
    </div>
  );
}
