import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Banknote, Loader2, RefreshCw, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { sapFunctionFetch } from "@/lib/auth-fetch";
import { useSap } from "@/contexts/SapContext";
import { useSapCachedList } from "@/hooks/useSapCachedList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageTitle } from "@/components/PageTitle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CachedSearchCombobox } from "@/components/CachedSearchCombobox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface PendingRow {
  id: string;
  company_db: string;
  sap_doc_entry: number | null;
  sap_doc_num: number | null;
  settlement_invoice_doc_entry: number | null;
  settlement_invoice_doc_num: number | null;
  settlement_status: string;
  settlement_error: string | null;
  created_at: string;
  pagcorp_data: Record<string, unknown> | null;
}

function txField(payload: Record<string, unknown> | null, keys: string[]): string | null {
  if (!payload) return null;
  const tx = ((payload.transaction as Record<string, unknown>) || payload) as Record<string, unknown>;
  for (const k of keys) {
    const v = tx?.[k] ?? (payload as Record<string, unknown>)[k];
    if (v != null && String(v).trim() !== "") return String(v);
  }
  return null;
}

function txAmount(payload: Record<string, unknown> | null): number | null {
  const raw = txField(payload, ["amount", "value", "totalAmount", "originalAmount"]);
  const n = raw != null ? Number(String(raw).replace(",", ".")) : NaN;
  return Number.isFinite(n) ? n : null;
}

function money(v: number | null | undefined, currency?: string | null) {
  if (v == null) return "—";
  const cur = (currency || "BRL").toUpperCase();
  try {
    return v.toLocaleString("pt-BR", { style: "currency", currency: cur });
  } catch {
    return `${cur} ${v.toFixed(2)}`;
  }
}

function dateBr(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
}

export default function PagCorpSettlements() {
  const navigate = useNavigate();
  const { session } = useSap();
  const companyDb = session?.companyDB || "";

  const [rows, setRows] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<PendingRow | null>(null);
  const [accountCode, setAccountCode] = useState<string>("");
  const [posting, setPosting] = useState(false);

  // Contas contábeis do ERP — a baixa do cartão só pode usar contas cujo
  // NOME contenha "PagCorp".
  const accountCache = useSapCachedList({
    cacheKey: "chart_of_accounts_active",
    endpoint: "ChartOfAccounts",
    params: {
      $filter: "ActiveAccount eq 'tYES'",
      $select: "Code,Name,FormatCode",
    },
    mapRow: (r: any) => ({
      code: r.FormatCode || r.Code,
      name: r.Name || "",
      extra: r.FormatCode && r.Code && r.FormatCode !== r.Code ? r.Code : "",
    }),
  });

  const pagcorpAccounts = useMemo(
    () => (accountCache.options || []).filter((o) => (o.name || "").toLowerCase().includes("pagcorp")),
    [accountCache.options],
  );

  const load = useCallback(async () => {
    if (!companyDb) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("pagcorp_integration_log")
      .select(
        "id, company_db, sap_doc_entry, sap_doc_num, settlement_invoice_doc_entry, settlement_invoice_doc_num, settlement_status, settlement_error, created_at, pagcorp_data",
      )
      .eq("company_db", companyDb)
      .eq("settlement_status", "awaiting_manual")
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) toast.error(`Falha ao carregar pendências: ${error.message}`);
    setRows(((data || []) as unknown) as PendingRow[]);
    setLoading(false);
  }, [companyDb]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [
        r.sap_doc_num, r.sap_doc_entry, r.settlement_invoice_doc_num,
        txField(r.pagcorp_data, ["supplierName", "merchantName", "establishmentName", "description"]),
        txField(r.pagcorp_data, ["cardName", "cardLastDigits"]),
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  async function confirmSettlement() {
    if (!target) return;
    if (!accountCode) {
      toast.error("Selecione a conta contábil PagCorp.");
      return;
    }
    setPosting(true);
    try {
      const resp = await sapFunctionFetch("pagcorp-settlement-watcher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logId: target.id, forceRetry: true, accountCode }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || `Erro ${resp.status}`);
      const result = Array.isArray(json?.results) ? json.results[0] : null;
      if (result?.status === "error") throw new Error(result.error || "Falha na baixa");
      toast.success("Baixa lançada no ERP.");
      setTarget(null);
      setAccountCode("");
      await load();
    } catch (e) {
      toast.error(`Falha ao lançar a baixa: ${(e as Error).message}`);
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <PageTitle title="Baixas PagCorp" />
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/cartoes/transacoes")} aria-label="Voltar">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-lg font-semibold flex items-center gap-2">
                <Banknote className="w-5 h-5" /> Baixas de cartão corporativo
              </h1>
              <p className="text-xs text-muted-foreground">
                Notas de entrada de pedidos do cartão aguardando baixa manual{companyDb ? ` · ${companyDb}` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-4">
        {!companyDb && (
          <Card className="p-6 text-sm text-muted-foreground">
            Faça login em uma empresa do ERP para ver as baixas pendentes.
          </Card>
        )}

        {companyDb && (
          <>
            <div className="flex items-center gap-2">
              <div className="relative w-full max-w-sm">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Buscar por PC, NF, fornecedor ou cartão…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Badge variant="secondary">{filtered.length} pendente(s)</Badge>
            </div>

            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pedido de compra</TableHead>
                    <TableHead>NF (Contas a Pagar)</TableHead>
                    <TableHead>Fornecedor / Cartão</TableHead>
                    <TableHead className="text-right">Valor da transação</TableHead>
                    <TableHead>Detectada em</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Carregando…
                      </TableCell>
                    </TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                        Nenhuma baixa pendente.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((r) => {
                      const cur = txField(r.pagcorp_data, ["currency"]) || "BRL";
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium">
                            {r.sap_doc_num ?? r.sap_doc_entry ?? "—"}
                          </TableCell>
                          <TableCell>{r.settlement_invoice_doc_num ?? "—"}</TableCell>
                          <TableCell className="max-w-[280px] truncate">
                            {txField(r.pagcorp_data, ["supplierName", "merchantName", "establishmentName", "description"]) || "—"}
                            <span className="block text-xs text-muted-foreground">
                              {txField(r.pagcorp_data, ["cardName", "cardLastDigits"]) || ""}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">{money(txAmount(r.pagcorp_data), cur)}</TableCell>
                          <TableCell>{dateBr(r.created_at)}</TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" onClick={() => { setTarget(r); setAccountCode(""); }}>
                              Lançar baixa
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </Card>
          </>
        )}
      </main>

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar baixa no ERP</DialogTitle>
            <DialogDescription>
              A baixa será lançada como Pagamento de Fornecedor sobre a NF de entrada do pedido,
              usando a conta contábil selecionada.
            </DialogDescription>
          </DialogHeader>

          {target && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Pedido de compra</p>
                  <p className="font-medium">{target.sap_doc_num ?? target.sap_doc_entry ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">NF (Contas a Pagar)</p>
                  <p className="font-medium">{target.settlement_invoice_doc_num ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Fornecedor</p>
                  <p className="font-medium">
                    {txField(target.pagcorp_data, ["supplierName", "merchantName", "establishmentName"]) || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Valor da transação</p>
                  <p className="font-medium">
                    {money(txAmount(target.pagcorp_data), txField(target.pagcorp_data, ["currency"]) || "BRL")}
                  </p>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Conta contábil (somente contas PagCorp)</p>
                <CachedSearchCombobox
                  options={pagcorpAccounts}
                  isLoading={accountCache.isLoading}
                  value={pagcorpAccounts.find((o) => o.code === accountCode) || null}
                  onChange={(opt) => setAccountCode(opt?.code || "")}
                  placeholder="Selecione a conta PagCorp…"
                  required
                />
                {!accountCache.isLoading && pagcorpAccounts.length === 0 && (
                  <p className="text-xs text-destructive">
                    Nenhuma conta contábil com "PagCorp" no nome foi encontrada no ERP desta empresa.
                  </p>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                O valor exato da baixa (e a PTAX, em compras em dólar) é calculado pelo ERP Flow a partir
                da fatia da NF pertencente a este pedido de compra.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)} disabled={posting}>Cancelar</Button>
            <Button onClick={confirmSettlement} disabled={posting || !accountCode}>
              {posting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Confirmar baixa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
