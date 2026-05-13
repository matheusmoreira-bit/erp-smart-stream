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
  ChevronDown,
  Ban,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { useCompanies } from "@/hooks/useCompanies";
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
  type SapBusinessPartnerRow,
  type SapItemRow,
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

function consolidateBPs(
  results: PerCompanyResult<SapBusinessPartnerRow[]>[],
): { rows: UnifiedAccountRow[]; companies: { db: string; name: string }[] } {
  const companies = results
    .filter((r) => r.ok && r.data)
    .map((r) => ({ db: r.company_db, name: r.display_name }));
  const map = new Map<string, UnifiedAccountRow>();
  for (const r of results) {
    if (!r.ok || !r.data) continue;
    for (const a of r.data) {
      const code = String(a.CardCode || "").trim();
      if (!code) continue;
      let row = map.get(code);
      if (!row) {
        row = { code, names: new Set(), presence: new Map() };
        map.set(code, row);
      }
      row.names.add(a.CardName || "");
      row.presence.set(r.company_db, {
        name: a.CardName || "",
        active: a.Frozen !== "tYES" && a.Valid !== "tNO",
      });
    }
  }
  const rows = Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  return { rows, companies };
}

function consolidateItems(
  results: PerCompanyResult<SapItemRow[]>[],
): { rows: UnifiedAccountRow[]; companies: { db: string; name: string }[] } {
  const companies = results
    .filter((r) => r.ok && r.data)
    .map((r) => ({ db: r.company_db, name: r.display_name }));
  const map = new Map<string, UnifiedAccountRow>();
  for (const r of results) {
    if (!r.ok || !r.data) continue;
    for (const a of r.data) {
      const code = String(a.ItemCode || "").trim();
      if (!code) continue;
      let row = map.get(code);
      if (!row) {
        row = { code, names: new Set(), presence: new Map() };
        map.set(code, row);
      }
      row.names.add(a.ItemName || "");
      row.presence.set(r.company_db, {
        name: a.ItemName || "",
        active: a.Frozen !== "tYES" && a.Valid !== "tNO",
      });
    }
  }
  const rows = Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  return { rows, companies };
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

function CreateAccountDialog({ onCreated, companyDbs }: { onCreated: () => void; companyDbs: string[] }) {
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
    if (companyDbs.length === 0) {
      toast.error("Selecione ao menos uma empresa");
      return;
    }
    setSubmitting(true);
    try {
      const { results } = await createAccount({
        code: code.trim(),
        name: name.trim(),
        account_type: accountType,
        company_dbs: companyDbs,
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

function CreateCostCenterDialog({ onCreated, companyDbs }: { onCreated: () => void; companyDbs: string[] }) {
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
    if (companyDbs.length === 0) {
      toast.error("Selecione ao menos uma empresa");
      return;
    }
    setSubmitting(true);
    try {
      const { results } = await createCostCenter({
        center_code: code.trim(),
        center_name: name.trim(),
        group_code: groupCode.trim() ? Number(groupCode.trim()) : undefined,
        company_dbs: companyDbs,
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

function ResolveConflictDialog({
  open,
  onOpenChange,
  code,
  names,
  kind,
  companyDbs,
  onResolved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  code: string;
  names: string[];
  kind: "account" | "center";
  companyDbs: string[];
  onResolved: () => void;
}) {
  const { renameAccount, renameCostCenter } = useIntercompany();
  const [selected, setSelected] = useState<string>("");
  const [custom, setCustom] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [report, setReport] = useState<PerCompanyResult[] | null>(null);

  useEffect(() => {
    if (open) {
      setSelected(names[0] || "");
      setCustom("");
    }
  }, [open, names]);

  const finalName = selected === "__custom__" ? custom.trim() : selected;

  const submit = async () => {
    if (!finalName) {
      toast.error("Informe um nome");
      return;
    }
    if (companyDbs.length === 0) {
      toast.error("Selecione ao menos uma empresa");
      return;
    }
    setSubmitting(true);
    try {
      const { results } =
        kind === "account"
          ? await renameAccount({ code, name: finalName, company_dbs: companyDbs })
          : await renameCostCenter({ center_code: code, center_name: finalName, company_dbs: companyDbs });
      setReport(results);
      onOpenChange(false);
      onResolved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao unificar nome");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unificar nome — {code}</DialogTitle>
            <DialogDescription>
              Escolha o nome que será aplicado em todas as empresas onde este registro existe.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Nomes encontrados</Label>
              <div className="space-y-1.5">
                {names.map((n) => (
                  <label
                    key={n}
                    className={`flex items-center gap-2 p-2 rounded border cursor-pointer text-sm ${
                      selected === n ? "border-primary bg-primary/5" : "border-border"
                    }`}
                  >
                    <input
                      type="radio"
                      name="conflict-name"
                      checked={selected === n}
                      onChange={() => setSelected(n)}
                    />
                    <span className="flex-1">{n}</span>
                  </label>
                ))}
                <label
                  className={`flex items-center gap-2 p-2 rounded border cursor-pointer text-sm ${
                    selected === "__custom__" ? "border-primary bg-primary/5" : "border-border"
                  }`}
                >
                  <input
                    type="radio"
                    name="conflict-name"
                    checked={selected === "__custom__"}
                    onChange={() => setSelected("__custom__")}
                  />
                  <span className="text-muted-foreground">Outro nome…</span>
                </label>
              </div>
            </div>
            {selected === "__custom__" && (
              <div>
                <Label>Novo nome</Label>
                <Input
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  placeholder="Digite o nome unificado"
                  autoFocus
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={submitting || !finalName}>
              {submitting ? "Aplicando..." : "Aplicar em todas"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {report && (
        <ResultReportDialog
          open={!!report}
          onOpenChange={(v) => !v && setReport(null)}
          results={report}
          title="Relatório de unificação de nome"
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
  onToggleActive,
  onReplicate,
  readOnly = false,
}: {
  rows: { code: string; names: Set<string>; presence: Map<string, { name: string; active: boolean }> }[];
  companies: { db: string; name: string }[];
  search: string;
  onResolveConflict?: (code: string, names: string[]) => void;
  onToggleActive?: (code: string, companyDb: string, nextActive: boolean) => Promise<void> | void;
  onReplicate?: (code: string, name: string, companyDb: string) => Promise<void> | void;
  readOnly?: boolean;
}) {
  const [pending, setPending] = useState<string | null>(null);
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
          Ativo (clique para inativar)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <XCircle className="w-4 h-4 text-muted-foreground" />
          Inativo (clique para ativar)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Ban className="w-4 h-4 text-destructive" />
          Não existe — clique para replicar nesta empresa
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Badge variant="outline" className="text-warning border-warning/40 text-[10px]">
            nomes divergentes
          </Badge>
          Mesmo código com nomes diferentes
        </span>
      </div>
      <div className="border rounded-md overflow-auto max-h-[65vh]">
        <table className="w-full caption-bottom text-sm">
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
                    const replicateKey = `${row.code}::${c.db}::replicate`;
                    const isReplicating = pending === replicateKey;
                    const sourceName = names[0];
                    const canReplicate = !!onReplicate && !!sourceName;
                    return (
                      <TableCell key={c.db} className="text-center">
                        {canReplicate ? (
                          <button
                            type="button"
                            disabled={isReplicating}
                            onClick={async () => {
                              if (!onReplicate) return;
                              setPending(replicateKey);
                              try {
                                await onReplicate(row.code, sourceName, c.db);
                              } finally {
                                setPending(null);
                              }
                            }}
                            className="inline-flex items-center justify-center rounded-md p-1 text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50 disabled:cursor-wait"
                            title={`Não existe nesta empresa — clique para replicar "${sourceName}" (${row.code})`}
                            aria-label="Não existe — clique para replicar nesta empresa"
                          >
                            {isReplicating ? (
                              <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                              <Ban className="w-4 h-4" />
                            )}
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    );
                  }
                  const key = `${row.code}::${c.db}`;
                  const isPending = pending === key;
                  const next = !info.active;
                  if (readOnly) {
                    return (
                      <TableCell key={c.db} className="text-center" title={info.name}>
                        <span
                          className={`inline-flex items-center justify-center p-1 ${
                            info.active ? "text-success" : "text-muted-foreground"
                          }`}
                        >
                          {info.active ? (
                            <CheckCircle2 className="w-4 h-4" />
                          ) : (
                            <XCircle className="w-4 h-4" />
                          )}
                        </span>
                      </TableCell>
                    );
                  }
                  return (
                    <TableCell key={c.db} className="text-center" title={info.name}>
                      <button
                        type="button"
                        disabled={isPending || !onToggleActive}
                        onClick={async () => {
                          if (!onToggleActive) return;
                          setPending(key);
                          try {
                            await onToggleActive(row.code, c.db, next);
                          } finally {
                            setPending(null);
                          }
                        }}
                        className={`inline-flex items-center justify-center rounded-md p-1 transition-colors hover:bg-muted disabled:opacity-50 disabled:cursor-wait ${
                          info.active ? "text-success" : "text-muted-foreground"
                        }`}
                        title={`${info.name} — ${info.active ? "Clique para inativar" : "Clique para ativar"}`}
                        aria-label={info.active ? "Inativar" : "Ativar"}
                      >
                        {isPending ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : info.active ? (
                          <CheckCircle2 className="w-4 h-4" />
                        ) : (
                          <XCircle className="w-4 h-4" />
                        )}
                      </button>
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
      </table>
      </div>
    </div>
  );
}

export default function Intercompany() {
  const {
    loadingAccounts,
    loadingCenters,
    loadingBPs,
    loadingItems,
    accountResults,
    centerResults,
    bpResults,
    itemResults,
    loadAccounts,
    loadCostCenters,
    loadBusinessPartners,
    loadItems,
    toggleAccount,
    toggleCostCenter,
    createAccount,
    createCostCenter,
    replicateBusinessPartner,
    replicateItem,
  } = useIntercompany();
  const { companies: allCompanies, loading: loadingCompanies } = useCompanies(true);
  const sapCompanies = useMemo(
    () => allCompanies.filter((c) => (c.erp_type || "sap") === "sap"),
    [allCompanies],
  );

  const [tab, setTab] = useState<"accounts" | "centers" | "bps" | "items">("accounts");
  const [search, setSearch] = useState("");
  const [selectedDbs, setSelectedDbs] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("intercompany.selectedDbs");
      if (raw) return JSON.parse(raw) as string[];
    } catch { /* noop */ }
    return [];
  });
  const [conflict, setConflict] = useState<{
    open: boolean;
    code: string;
    names: string[];
    kind: "account" | "center";
  }>({ open: false, code: "", names: [], kind: "account" });

  // Default to all SAP companies on first load when nothing is persisted
  useEffect(() => {
    if (loadingCompanies) return;
    if (selectedDbs.length === 0 && sapCompanies.length > 0) {
      setSelectedDbs(sapCompanies.map((c) => c.company_db));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingCompanies, sapCompanies.length]);

  // Persist selection
  useEffect(() => {
    try {
      localStorage.setItem("intercompany.selectedDbs", JSON.stringify(selectedDbs));
    } catch { /* noop */ }
  }, [selectedDbs]);

  const reloadAccounts = useMemo(
    () => () => loadAccounts(selectedDbs),
    [loadAccounts, selectedDbs],
  );
  const reloadCenters = useMemo(
    () => () => loadCostCenters(selectedDbs),
    [loadCostCenters, selectedDbs],
  );
  const reloadBPs = useMemo(
    () => () => loadBusinessPartners(selectedDbs),
    [loadBusinessPartners, selectedDbs],
  );
  const reloadItems = useMemo(
    () => () => loadItems(selectedDbs),
    [loadItems, selectedDbs],
  );

  // Load accounts/centers eagerly; BPs/items only on tab access (datasets podem ser grandes)
  useEffect(() => {
    if (selectedDbs.length === 0) return;
    reloadAccounts();
    reloadCenters();
  }, [reloadAccounts, reloadCenters, selectedDbs]);

  useEffect(() => {
    if (selectedDbs.length === 0) return;
    if (tab === "bps" && bpResults.length === 0 && !loadingBPs) reloadBPs();
    if (tab === "items" && itemResults.length === 0 && !loadingItems) reloadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selectedDbs]);

  const { rows: accountRows, companies: accountCompanies } = useMemo(
    () => consolidateAccounts(accountResults),
    [accountResults],
  );
  const { rows: centerRows, companies: centerCompanies } = useMemo(
    () => consolidateCenters(centerResults),
    [centerResults],
  );
  const { rows: bpRows, companies: bpCompanies } = useMemo(
    () => consolidateBPs(bpResults),
    [bpResults],
  );
  const { rows: itemRows, companies: itemCompanies } = useMemo(
    () => consolidateItems(itemResults),
    [itemResults],
  );

  // Floating notification (15s) for companies that failed
  const lastErrorKeyRef = useRef<string>("");
  useEffect(() => {
    const failed = [...accountResults, ...centerResults].filter((r) => !r.ok);
    if (failed.length === 0) return;
    // Deduplicate per company_db (a company can fail in both lists)
    const byDb = new Map<string, { display_name: string; error?: string }>();
    for (const f of failed) {
      if (!byDb.has(f.company_db)) {
        byDb.set(f.company_db, { display_name: f.display_name, error: f.error });
      }
    }
    const key = Array.from(byDb.keys()).sort().join("|");
    if (key === lastErrorKeyRef.current) return;
    lastErrorKeyRef.current = key;
    toast.error(`${byDb.size} empresa(s) com falha`, {
      description: (
        <ul className="space-y-0.5 mt-1">
          {Array.from(byDb.entries()).map(([db, v]) => (
            <li key={db} className="text-xs">
              <span className="font-medium">{v.display_name}:</span> {v.error}
            </li>
          ))}
        </ul>
      ) as unknown as string,
      duration: 15000,
      icon: <AlertTriangle className="w-4 h-4" />,
    });
  }, [accountResults, centerResults]);

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
                Plano de contas, centros de custo, parceiros de negócios e itens consolidados entre empresas
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-4">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <Tabs value={tab} onValueChange={(v) => setTab(v as "accounts" | "centers" | "bps" | "items")}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <TabsList>
                <TabsTrigger value="accounts">Plano de Contas</TabsTrigger>
                <TabsTrigger value="centers">Centros de Custo</TabsTrigger>
                <TabsTrigger value="bps">Parceiros de Negócios</TabsTrigger>
                <TabsTrigger value="items">Itens</TabsTrigger>
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
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2">
                      <Building2 className="w-4 h-4" />
                      Empresas
                      <Badge variant="secondary" className="ml-1">
                        {selectedDbs.length}/{sapCompanies.length}
                      </Badge>
                      <ChevronDown className="w-3 h-3 opacity-60" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-72 p-0">
                    <div className="flex items-center justify-between px-3 py-2 border-b">
                      <span className="text-xs font-medium">Empresas consideradas</span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="text-[11px] text-primary hover:underline"
                          onClick={() => setSelectedDbs(sapCompanies.map((c) => c.company_db))}
                        >
                          Todas
                        </button>
                        <button
                          type="button"
                          className="text-[11px] text-muted-foreground hover:underline"
                          onClick={() => setSelectedDbs([])}
                        >
                          Nenhuma
                        </button>
                      </div>
                    </div>
                    <div className="max-h-72 overflow-auto py-1">
                      {sapCompanies.length === 0 ? (
                        <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                          Nenhuma empresa SAP ativa
                        </div>
                      ) : (
                        sapCompanies.map((c) => {
                          const checked = selectedDbs.includes(c.company_db);
                          return (
                            <label
                              key={c.company_db}
                              className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted/50 cursor-pointer"
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(v) => {
                                  setSelectedDbs((prev) =>
                                    v
                                      ? Array.from(new Set([...prev, c.company_db]))
                                      : prev.filter((d) => d !== c.company_db),
                                  );
                                }}
                              />
                              <span className="flex-1 truncate">{c.display_name}</span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
                {tab === "accounts" && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={reloadAccounts}
                      disabled={loadingAccounts || selectedDbs.length === 0}
                      className="gap-2"
                    >
                      <RefreshCw className={`w-4 h-4 ${loadingAccounts ? "animate-spin" : ""}`} />
                      Atualizar
                    </Button>
                    <CreateAccountDialog onCreated={reloadAccounts} companyDbs={selectedDbs} />
                  </>
                )}
                {tab === "centers" && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={reloadCenters}
                      disabled={loadingCenters || selectedDbs.length === 0}
                      className="gap-2"
                    >
                      <RefreshCw className={`w-4 h-4 ${loadingCenters ? "animate-spin" : ""}`} />
                      Atualizar
                    </Button>
                    <CreateCostCenterDialog onCreated={reloadCenters} companyDbs={selectedDbs} />
                  </>
                )}
                {tab === "bps" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={reloadBPs}
                    disabled={loadingBPs || selectedDbs.length === 0}
                    className="gap-2"
                  >
                    <RefreshCw className={`w-4 h-4 ${loadingBPs ? "animate-spin" : ""}`} />
                    Atualizar
                  </Button>
                )}
                {tab === "items" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={reloadItems}
                    disabled={loadingItems || selectedDbs.length === 0}
                    className="gap-2"
                  >
                    <RefreshCw className={`w-4 h-4 ${loadingItems ? "animate-spin" : ""}`} />
                    Atualizar
                  </Button>
                )}
              </div>
            </div>

            <TabsContent value="accounts" className="space-y-3 mt-4">
              {loadingAccounts && accountResults.length === 0 ? (
                <div className="text-center text-muted-foreground py-12 text-sm">
                  Carregando plano de contas de todas as empresas…
                </div>
              ) : (
                <ConsolidatedTable
                  rows={accountRows}
                  companies={accountCompanies}
                  search={search}
                  onResolveConflict={(code, names) =>
                    setConflict({ open: true, code, names, kind: "account" })
                  }
                  onToggleActive={async (code, companyDb, nextActive) => {
                    try {
                      const { results } = await toggleAccount({
                        code,
                        active: nextActive,
                        company_db: companyDb,
                      });
                      const r = results[0];
                      if (!r?.ok) throw new Error(r?.error || "Falha ao atualizar");
                      toast.success(`Conta ${code} ${nextActive ? "ativada" : "inativada"}`);
                      await reloadAccounts();
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Erro ao atualizar");
                    }
                  }}
                  onReplicate={async (code, name, companyDb) => {
                    try {
                      const { results } = await createAccount({
                        code,
                        name,
                        company_dbs: [companyDb],
                      });
                      const r = results[0];
                      if (!r?.ok) throw new Error(r?.error || "Falha ao replicar");
                      toast.success(`Conta ${code} replicada nesta empresa`);
                      await reloadAccounts();
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Erro ao replicar");
                    }
                  }}
                />
              )}
            </TabsContent>

            <TabsContent value="centers" className="space-y-3 mt-4">
              {loadingCenters && centerResults.length === 0 ? (
                <div className="text-center text-muted-foreground py-12 text-sm">
                  Carregando centros de custo de todas as empresas…
                </div>
              ) : (
                <ConsolidatedTable
                  rows={centerRows}
                  companies={centerCompanies}
                  search={search}
                  onResolveConflict={(code, names) =>
                    setConflict({ open: true, code, names, kind: "center" })
                  }
                  onToggleActive={async (code, companyDb, nextActive) => {
                    try {
                      const { results } = await toggleCostCenter({
                        center_code: code,
                        active: nextActive,
                        company_db: companyDb,
                      });
                      const r = results[0];
                      if (!r?.ok) throw new Error(r?.error || "Falha ao atualizar");
                      toast.success(`Centro ${code} ${nextActive ? "ativado" : "inativado"}`);
                      await reloadCenters();
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Erro ao atualizar");
                    }
                  }}
                  onReplicate={async (code, name, companyDb) => {
                    try {
                      const { results } = await createCostCenter({
                        center_code: code,
                        center_name: name,
                        company_dbs: [companyDb],
                      });
                      const r = results[0];
                      if (!r?.ok) throw new Error(r?.error || "Falha ao replicar");
                      toast.success(`Centro ${code} replicado nesta empresa`);
                      await reloadCenters();
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Erro ao replicar");
                    }
                  }}
                />
              )}
            </TabsContent>

            <TabsContent value="bps" className="space-y-3 mt-4">
              {loadingBPs && bpResults.length === 0 ? (
                <div className="text-center text-muted-foreground py-12 text-sm">
                  Carregando parceiros de negócios de todas as empresas…
                </div>
              ) : (
                <ConsolidatedTable
                  rows={bpRows}
                  companies={bpCompanies}
                  search={search}
                  readOnly
                  onReplicate={async (code, _name, targetDb) => {
                    const row = bpRows.find((r) => r.code === code);
                    const sourceDb = row ? Array.from(row.presence.keys())[0] : undefined;
                    if (!sourceDb) {
                      toast.error("Não foi possível identificar a empresa de origem");
                      return;
                    }
                    try {
                      const { results } = await replicateBusinessPartner({
                        code,
                        source_company_db: sourceDb,
                        target_company_db: targetDb,
                      });
                      const r = results[0];
                      if (!r?.ok) throw new Error(r?.error || "Falha ao replicar");
                      toast.success(`PN ${code} replicado nesta empresa`);
                      await reloadBPs();
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Erro ao replicar");
                    }
                  }}
                />
              )}
            </TabsContent>

            <TabsContent value="items" className="space-y-3 mt-4">
              {loadingItems && itemResults.length === 0 ? (
                <div className="text-center text-muted-foreground py-12 text-sm">
                  Carregando itens de todas as empresas…
                </div>
              ) : (
                <ConsolidatedTable
                  rows={itemRows}
                  companies={itemCompanies}
                  search={search}
                  readOnly
                  onReplicate={async (code, _name, targetDb) => {
                    const row = itemRows.find((r) => r.code === code);
                    const sourceDb = row ? Array.from(row.presence.keys())[0] : undefined;
                    if (!sourceDb) {
                      toast.error("Não foi possível identificar a empresa de origem");
                      return;
                    }
                    try {
                      const { results } = await replicateItem({
                        code,
                        source_company_db: sourceDb,
                        target_company_db: targetDb,
                      });
                      const r = results[0];
                      if (!r?.ok) throw new Error(r?.error || "Falha ao replicar");
                      toast.success(`Item ${code} replicado nesta empresa`);
                      await reloadItems();
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Erro ao replicar");
                    }
                  }}
                />
              )}
            </TabsContent>
          </Tabs>
        </motion.div>
      </main>

      <ResolveConflictDialog
        open={conflict.open}
        onOpenChange={(v) => setConflict((c) => ({ ...c, open: v }))}
        code={conflict.code}
        names={conflict.names}
        kind={conflict.kind}
        companyDbs={selectedDbs}
        onResolved={() => {
          if (conflict.kind === "account") reloadAccounts();
          else reloadCenters();
        }}
      />
    </div>
  );
}
