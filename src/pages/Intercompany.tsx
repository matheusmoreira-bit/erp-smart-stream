import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Building2,
  Plus,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Search,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  useIntercompany,
  type PerCompanyResult,
  type SapAccountRow,
  type SapCostCenterRow,
} from "@/hooks/useIntercompany";

interface UnifiedAccountRow {
  code: string;
  names: Set<string>;
  presence: Map<string, { name: string; active: boolean }>; // company_db -> info
}

interface UnifiedCenterRow {
  code: string;
  names: Set<string>;
  presence: Map<string, { name: string; active: boolean }>;
}

const ACCOUNT_TYPES: { value: string; label: string }[] = [
  { value: "at_Other", label: "Outro" },
  { value: "at_Expenses", label: "Despesa" },
  { value: "at_Revenues", label: "Receita" },
];

function consolidateAccounts(
  results: PerCompanyResult<SapAccountRow[]>[],
): { rows: UnifiedAccountRow[]; companies: { db: string; name: string }[] } {
  const companies = results
    .filter((r) => r.ok && r.data)
    .map((r) => ({ db: r.company_db, name: r.display_name }));
  const map = new Map<string, UnifiedAccountRow>();
  for (const r of results) {
    if (!r.ok || !r.data) continue;
    for (const a of r.data) {
      const code = String(a.Code || "").trim();
      if (!code) continue;
      let row = map.get(code);
      if (!row) {
        row = { code, names: new Set(), presence: new Map() };
        map.set(code, row);
      }
      row.names.add(a.Name || "");
      row.presence.set(r.company_db, {
        name: a.Name || "",
        active: a.ActiveAccount !== "tNO",
      });
    }
  }
  const rows = Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  return { rows, companies };
}

function consolidateCenters(
  results: PerCompanyResult<SapCostCenterRow[]>[],
): { rows: UnifiedCenterRow[]; companies: { db: string; name: string }[] } {
  const companies = results
    .filter((r) => r.ok && r.data)
    .map((r) => ({ db: r.company_db, name: r.display_name }));
  const map = new Map<string, UnifiedCenterRow>();
  for (const r of results) {
    if (!r.ok || !r.data) continue;
    for (const c of r.data) {
      const code = String(c.CenterCode || "").trim();
      if (!code) continue;
      let row = map.get(code);
      if (!row) {
        row = { code, names: new Set(), presence: new Map() };
        map.set(code, row);
      }
      row.names.add(c.CenterName || "");
      row.presence.set(r.company_db, {
        name: c.CenterName || "",
        active: c.Active !== "tNO",
      });
    }
  }
  const rows = Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  return { rows, companies };
}

function CompanyErrorsBanner({ results }: { results: PerCompanyResult[] }) {
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) return null;
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
      <div className="flex items-center gap-2 font-medium text-destructive mb-1">
        <AlertTriangle className="w-4 h-4" />
        {failed.length} empresa(s) com falha
      </div>
      <ul className="space-y-0.5 text-xs text-muted-foreground">
        {failed.map((f) => (
          <li key={f.company_db}>
            <span className="font-medium text-foreground">{f.display_name}:</span> {f.error}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResultReportDialog({
  open,
  onOpenChange,
  results,
  title,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  results: PerCompanyResult[];
  title: string;
}) {
  const okCount = results.filter((r) => r.ok).length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {okCount} de {results.length} empresa(s) processadas com sucesso.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Detalhes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r) => (
                <TableRow key={r.company_db}>
                  <TableCell className="font-medium">{r.display_name}</TableCell>
                  <TableCell>
                    {r.ok ? (
                      <span className="inline-flex items-center gap-1 text-success text-xs">
                        <CheckCircle2 className="w-4 h-4" /> Sucesso
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-destructive text-xs">
                        <XCircle className="w-4 h-4" /> Falha
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-xs">
                    {r.ok ? "OK" : r.error || "Erro desconhecido"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateAccountDialog({ onCreated }: { onCreated: () => void }) {
  const { createAccount } = useIntercompany();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [accountType, setAccountType] = useState<string>("at_Other");
  const [submitting, setSubmitting] = useState(false);
  const [report, setReport] = useState<PerCompanyResult[] | null>(null);

  const submit = async () => {
    if (!code.trim() || !name.trim()) {
      toast.error("Preencha código e nome");
      return;
    }
    setSubmitting(true);
    try {
      const { results } = await createAccount({
        code: code.trim(),
        name: name.trim(),
        account_type: accountType,
      });
      setReport(results);
      setOpen(false);
      setCode("");
      setName("");
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar conta");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" className="gap-2">
            <Plus className="w-4 h-4" /> Nova Conta
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Conta Contábil</DialogTitle>
            <DialogDescription>
              Será criada em todas as empresas SAP ativas (best-effort).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Código</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="1.01.001" />
            </div>
            <div>
              <Label>Nome</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Despesas operacionais" />
            </div>
            <div>
              <Label>Tipo</Label>
              <Select value={accountType} onValueChange={setAccountType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? "Criando..." : "Criar em todas as empresas"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {report && (
        <ResultReportDialog
          open={!!report}
          onOpenChange={(v) => !v && setReport(null)}
          results={report}
          title="Relatório de criação — Conta Contábil"
        />
      )}
    </>
  );
}

function CreateCostCenterDialog({ onCreated }: { onCreated: () => void }) {
  const { createCostCenter } = useIntercompany();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [groupCode, setGroupCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [report, setReport] = useState<PerCompanyResult[] | null>(null);

  const submit = async () => {
    if (!code.trim() || !name.trim()) {
      toast.error("Preencha código e nome");
      return;
    }
    setSubmitting(true);
    try {
      const { results } = await createCostCenter({
        center_code: code.trim(),
        center_name: name.trim(),
        group_code: groupCode.trim() ? Number(groupCode.trim()) : undefined,
      });
      setReport(results);
      setOpen(false);
      setCode("");
      setName("");
      setGroupCode("");
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar centro de custo");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" className="gap-2">
            <Plus className="w-4 h-4" /> Novo Centro
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Centro de Custo</DialogTitle>
            <DialogDescription>
              Será criado em todas as empresas SAP ativas (best-effort).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Código</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="CC001" />
            </div>
            <div>
              <Label>Nome</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Marketing" />
            </div>
            <div>
              <Label>Grupo (opcional)</Label>
              <Input value={groupCode} onChange={(e) => setGroupCode(e.target.value)} placeholder="1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? "Criando..." : "Criar em todas as empresas"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {report && (
        <ResultReportDialog
          open={!!report}
          onOpenChange={(v) => !v && setReport(null)}
          results={report}
          title="Relatório de criação — Centro de Custo"
        />
      )}
    </>
  );
}

function ConsolidatedTable({
  rows,
  companies,
  search,
  onResolveConflict,
}: {
  rows: { code: string; names: Set<string>; presence: Map<string, { name: string; active: boolean }> }[];
  companies: { db: string; name: string }[];
  search: string;
  onResolveConflict?: (code: string, names: string[]) => void;
}) {
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        r.code.toLowerCase().includes(s) ||
        Array.from(r.names).some((n) => n.toLowerCase().includes(s)),
    );
  }, [rows, search]);

  if (companies.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-12 text-sm">
        Nenhuma empresa carregada. Clique em Atualizar.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground px-1">
        <span className="font-medium text-foreground">Legenda:</span>
        <span className="inline-flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4 text-success" />
          Existe e está ativo
        </span>
        <span className="inline-flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
          Existe, mas inativo/congelado
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 text-center font-mono">—</span>
          Não existe nesta empresa
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Badge variant="outline" className="text-warning border-warning/40 text-[10px]">
            nomes divergentes
          </Badge>
          Mesmo código com nomes diferentes
        </span>
      </div>
      <div className="border rounded-md overflow-auto max-h-[65vh]">
        <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-32 sticky top-0 z-20 bg-card border-b shadow-[0_1px_0_0_hsl(var(--border))]">
              Código
            </TableHead>
            <TableHead className="sticky top-0 z-20 bg-card border-b shadow-[0_1px_0_0_hsl(var(--border))]">
              Nome
            </TableHead>
            {companies.map((c) => (
              <TableHead
                key={c.db}
                className="text-center text-xs whitespace-nowrap sticky top-0 z-20 bg-card border-b shadow-[0_1px_0_0_hsl(var(--border))]"
              >
                {c.name}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((row) => {
            const names = Array.from(row.names).filter(Boolean);
            const conflict = names.length > 1;
            const presentCount = row.presence.size;
            const missing = presentCount < companies.length;
            return (
              <TableRow key={row.code}>
                <TableCell className="font-mono text-xs">{row.code}</TableCell>
                <TableCell className="text-sm">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span>{names[0] || "—"}</span>
                    {conflict && (
                      <button
                        type="button"
                        onClick={() => onResolveConflict?.(row.code, names)}
                        className="inline-flex items-center gap-1 rounded border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning hover:bg-warning/20 transition-colors"
                        title="Unificar nome em todas as empresas"
                      >
                        <Pencil className="w-3 h-3" />
                        nomes divergentes
                      </button>
                    )}
                    {missing && (
                      <Badge variant="outline" className="text-muted-foreground text-[10px]">
                        {presentCount}/{companies.length}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                {companies.map((c) => {
                  const info = row.presence.get(c.db);
                  if (!info) {
                    return (
                      <TableCell key={c.db} className="text-center text-xs text-muted-foreground">
                        —
                      </TableCell>
                    );
                  }
                  return (
                    <TableCell key={c.db} className="text-center" title={info.name}>
                      <CheckCircle2
                        className={`w-4 h-4 inline ${info.active ? "text-success" : "text-muted-foreground"}`}
                      />
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={companies.length + 2} className="text-center text-muted-foreground py-8 text-sm">
                Nenhum registro encontrado
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      </div>
    </div>
  );
}

export default function Intercompany() {
  const {
    loadingAccounts,
    loadingCenters,
    accountResults,
    centerResults,
    loadAccounts,
    loadCostCenters,
  } = useIntercompany();

  const [tab, setTab] = useState<"accounts" | "centers">("accounts");
  const [search, setSearch] = useState("");

  useEffect(() => {
    loadAccounts();
    loadCostCenters();
  }, [loadAccounts, loadCostCenters]);

  const { rows: accountRows, companies: accountCompanies } = useMemo(
    () => consolidateAccounts(accountResults),
    [accountResults],
  );
  const { rows: centerRows, companies: centerCompanies } = useMemo(
    () => consolidateCenters(centerResults),
    [centerResults],
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="p-2 rounded-lg bg-primary/10">
              <Building2 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Intercompany</h1>
              <p className="text-xs text-muted-foreground">
                Plano de contas e centros de custo consolidados entre empresas
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-4">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <Tabs value={tab} onValueChange={(v) => setTab(v as "accounts" | "centers")}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <TabsList>
                <TabsTrigger value="accounts">Plano de Contas</TabsTrigger>
                <TabsTrigger value="centers">Centros de Custo</TabsTrigger>
              </TabsList>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar código ou nome"
                    className="pl-8 w-64"
                  />
                </div>
                {tab === "accounts" ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={loadAccounts}
                      disabled={loadingAccounts}
                      className="gap-2"
                    >
                      <RefreshCw className={`w-4 h-4 ${loadingAccounts ? "animate-spin" : ""}`} />
                      Atualizar
                    </Button>
                    <CreateAccountDialog onCreated={loadAccounts} />
                  </>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={loadCostCenters}
                      disabled={loadingCenters}
                      className="gap-2"
                    >
                      <RefreshCw className={`w-4 h-4 ${loadingCenters ? "animate-spin" : ""}`} />
                      Atualizar
                    </Button>
                    <CreateCostCenterDialog onCreated={loadCostCenters} />
                  </>
                )}
              </div>
            </div>

            <TabsContent value="accounts" className="space-y-3 mt-4">
              <CompanyErrorsBanner results={accountResults} />
              {loadingAccounts && accountResults.length === 0 ? (
                <div className="text-center text-muted-foreground py-12 text-sm">
                  Carregando plano de contas de todas as empresas…
                </div>
              ) : (
                <ConsolidatedTable
                  rows={accountRows}
                  companies={accountCompanies}
                  search={search}
                />
              )}
            </TabsContent>

            <TabsContent value="centers" className="space-y-3 mt-4">
              <CompanyErrorsBanner results={centerResults} />
              {loadingCenters && centerResults.length === 0 ? (
                <div className="text-center text-muted-foreground py-12 text-sm">
                  Carregando centros de custo de todas as empresas…
                </div>
              ) : (
                <ConsolidatedTable
                  rows={centerRows}
                  companies={centerCompanies}
                  search={search}
                />
              )}
            </TabsContent>
          </Tabs>
        </motion.div>
      </main>
    </div>
  );
}
