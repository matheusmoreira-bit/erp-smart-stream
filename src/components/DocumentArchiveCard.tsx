import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Loader2, RefreshCw, ShieldAlert, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useCompanies } from "@/hooks/useCompanies";
import { supabase } from "@/integrations/supabase/client";
import { sapFunctionFetch } from "@/lib/auth-fetch";

const DOC_LABELS: Record<string, string> = {
  purchase_orders: "Pedidos de compra",
  purchase_down_payments: "Adiantamentos a fornecedor",
  down_payments: "Adiantamentos de cliente",
  purchase_invoices: "NF de entrada",
  vendor_payments: "Contas a pagar (pagamentos)",
  sales_orders: "Pedidos de venda",
  sales_invoices: "NF de saída",
  incoming_payments: "Contas a receber (recebimentos)",
};

const MASTER_LABELS: Record<string, string> = {
  chart_of_accounts: "Plano de contas",
  payment_terms: "Condições de pagamento",
  warehouses: "Depósitos",
  price_lists: "Listas de preço",
  item_groups: "Grupos de itens",
  bp_groups: "Grupos de parceiros",
  cost_centers: "Centros de custo",
  projects: "Projetos",
  items: "Itens",
  business_partners: "Fornecedores e clientes",
};

interface MasterStat {
  entity: string;
  count: number;
  last_sync: string | null;
}

interface TypeStat {
  doc_type: string;
  count: number;
  completed: boolean;
  last_sync: string | null;
}

interface RunRow {
  id: string;
  kind: string;
  status: string;
  documents_count: number;
  attachments_count: number;
  errors: unknown;
  started_at: string;
}

function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/**
 * Base de backup dos documentos do SAP (pedidos, notas, pagamentos e
 * adiantamentos) dentro do ERP Flow, com anexos, para permitir devolvê-los ao
 * ERP depois de um wipe da base.
 */
export function DocumentArchiveCard() {
  const { isAdmin } = useAuth();
  const { companies } = useCompanies();

  const sapCompanies = useMemo(
    () => companies.filter((c) => (c.erp_type || "sap") === "sap"),
    [companies],
  );

  const [companyDb, setCompanyDb] = useState("");
  const [stats, setStats] = useState<TypeStat[]>([]);
  const [masterStats, setMasterStats] = useState<MasterStat[]>([]);
  const [targetDb, setTargetDb] = useState("");
  const [attachments, setAttachments] = useState({ stored: 0, pending: 0, error: 0 });
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<
    null | "pull" | "attachments" | "master" | "dry" | "restore" | "restoreMaster"
  >(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [dryResult, setDryResult] = useState<any>(null);

  const loadStats = useCallback(async (db: string) => {
    if (!db) return;
    setLoading(true);
    try {
      const [
        { data: cursors },
        { data: docs },
        { data: att },
        { data: runRows },
        { data: masterCursors },
        { data: masterRows },
      ] = await Promise.all([
        supabase.from("sap_archive_cursors").select("doc_type, completed, last_full_sync_at, last_incremental_at").eq("company_db", db),
        supabase.from("sap_archive_documents").select("doc_type").eq("company_db", db).limit(100000),
        supabase.from("sap_archive_attachments").select("status").eq("company_db", db).limit(100000),
        supabase.from("sap_archive_runs").select("id, kind, status, documents_count, attachments_count, errors, started_at").eq("company_db", db).order("started_at", { ascending: false }).limit(5),
        supabase.from("sap_archive_master_cursors").select("entity_type, last_incremental_at, last_full_sync_at").eq("company_db", db),
        supabase.from("sap_archive_master_data").select("entity_type").eq("company_db", db).limit(100000),
      ]);
      const counts = new Map<string, number>();
      for (const row of (docs || []) as Array<{ doc_type: string }>) {
        counts.set(row.doc_type, (counts.get(row.doc_type) || 0) + 1);
      }
      setStats(Object.keys(DOC_LABELS).map((key) => {
        const c = (cursors || []).find((x: any) => x.doc_type === key) as any;
        return {
          doc_type: key,
          count: counts.get(key) || 0,
          completed: Boolean(c?.completed),
          last_sync: c?.last_incremental_at || c?.last_full_sync_at || null,
        };
      }));
      const mCounts = new Map<string, number>();
      for (const row of (masterRows || []) as Array<{ entity_type: string }>) {
        mCounts.set(row.entity_type, (mCounts.get(row.entity_type) || 0) + 1);
      }
      setMasterStats(Object.keys(MASTER_LABELS).map((key) => {
        const c = (masterCursors || []).find((x: any) => x.entity_type === key) as any;
        return {
          entity: key,
          count: mCounts.get(key) || 0,
          last_sync: c?.last_incremental_at || c?.last_full_sync_at || null,
        };
      }));
      const a = { stored: 0, pending: 0, error: 0 };
      for (const row of (att || []) as Array<{ status: string }>) {
        if (row.status === "stored") a.stored++;
        else if (row.status === "error") a.error++;
        else a.pending++;
      }
      setAttachments(a);
      setRuns((runRows || []) as RunRow[]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (companyDb) { setTargetDb(companyDb); void loadStats(companyDb); }
  }, [companyDb, loadStats]);

  const callFn = useCallback(async (fn: string, payload: Record<string, unknown>) => {
    const res = await sapFunctionFetch(fn, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.error) {
      throw new Error(data?.error || `Não foi possível falar com o ERP agora (HTTP ${res.status}).`);
    }
    return data;
  }, []);

  const runPull = useCallback(async (incremental: boolean) => {
    if (!companyDb) return;
    setBusy("pull");
    try {
      let done = false;
      let total = 0;
      let rounds = 0;
      while (!done && rounds < 200) {
        rounds++;
        const data = await callFn("sap-archive-pull", { company_db: companyDb, incremental });
        total += Number(data.documents || 0);
        done = Boolean(data.done);
        setProgress(`${total} documentos copiados…`);
      }
      toast.success(`Cópia concluída: ${total} documentos atualizados.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
      setProgress(null);
      void loadStats(companyDb);
    }
  }, [companyDb, callFn, loadStats]);

  const runAttachments = useCallback(async () => {
    if (!companyDb) return;
    setBusy("attachments");
    try {
      let done = false;
      let total = 0;
      let rounds = 0;
      while (!done && rounds < 200) {
        rounds++;
        const data = await callFn("sap-archive-attachments", { company_db: companyDb });
        total += Number(data.downloaded || 0);
        done = Boolean(data.done);
        setProgress(`${total} anexos copiados · ${data.pending ?? 0} restantes`);
      }
      toast.success(`Anexos copiados: ${total}.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
      setProgress(null);
      void loadStats(companyDb);
    }
  }, [companyDb, callFn, loadStats]);

  const runMasterPull = useCallback(async () => {
    if (!companyDb) return;
    setBusy("master");
    try {
      let done = false;
      let total = 0;
      let rounds = 0;
      while (!done && rounds < 200) {
        rounds++;
        const data = await callFn("sap-archive-master-pull", { company_db: companyDb });
        total += Number(data.records || 0);
        done = Boolean(data.done);
        setProgress(`${total} cadastros copiados…`);
      }
      toast.success(`Cadastros atualizados: ${total}.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
      setProgress(null);
      void loadStats(companyDb);
    }
  }, [companyDb, callFn, loadStats]);

  const runRestore = useCallback(async (dryRun: boolean, masterOnly = false) => {
    if (!companyDb) return;
    const destination = targetDb || companyDb;
    if (!dryRun && confirmText !== destination) {
      toast.error(`Digite ${destination} para confirmar a devolução dos dados ao ERP.`);
      return;
    }
    setBusy(dryRun ? "dry" : masterOnly ? "restoreMaster" : "restore");
    try {
      if (dryRun) {
        const data = await callFn("sap-archive-restore", {
          company_db: companyDb, target_company_db: destination, dry_run: true,
        });
        setDryResult(data);
        toast.success("Simulação concluída.");
      } else {
        let done = false;
        let total = 0;
        let rounds = 0;
        while (!done && rounds < 500) {
          rounds++;
          const data = await callFn("sap-archive-restore", {
            company_db: companyDb,
            target_company_db: destination,
            dry_run: false,
            confirm: destination,
            master_only: masterOnly,
          });
          total += Number(data.restored || 0) + Number(data.master_restored || 0);
          done = Boolean(data.done);
          setProgress(
            masterOnly
              ? `${total} cadastros criados no ERP…`
              : `${total} registros devolvidos ao ERP…`,
          );
          if (
            Number(data.restored || 0) === 0 &&
            Number(data.master_restored || 0) === 0 &&
            (data.errors || []).length > 0
          ) break;
        }
        toast.success(
          masterOnly
            ? `Cadastros devolvidos: ${total}.`
            : `Devolução concluída: ${total} registros recriados no ERP.`,
        );
        setConfirmText("");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
      setProgress(null);
      void loadStats(companyDb);
    }
  }, [companyDb, targetDb, confirmText, callFn, loadStats]);

  if (!isAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4" aria-hidden="true" /> Backup de documentos
          </CardTitle>
          <CardDescription>Apenas administradores podem usar a base de backup.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const totalDocs = stats.reduce((s, r) => s + r.count, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Archive className="h-4 w-4" aria-hidden="true" /> Backup de documentos (ERP)
        </CardTitle>
        <CardDescription>
          Guarda no ERP Flow uma cópia completa de pedidos de compra e venda, notas de entrada e
          saída, pagamentos, recebimentos, adiantamentos e anexos — e permite devolvê-los ao ERP.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="arquivo-empresa">Empresa</Label>
            <Select value={companyDb} onValueChange={(v) => { setCompanyDb(v); setDryResult(null); }}>
              <SelectTrigger id="arquivo-empresa">
                <SelectValue placeholder="Selecione a empresa" />
              </SelectTrigger>
              <SelectContent>
                {sapCompanies.map((c) => (
                  <SelectItem key={c.company_db} value={c.company_db}>
                    {c.display_name} · {c.company_db}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            onClick={() => companyDb && void loadStats(companyDb)}
            disabled={!companyDb || loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            <span className="ml-2">Atualizar</span>
          </Button>
        </div>

        {companyDb && (
          <>
            <div className="rounded-md border">
              <table className="w-full text-sm">
                <caption className="sr-only">Documentos guardados no backup por tipo</caption>
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Documento</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Copiados</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Última cópia</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((s) => (
                    <tr key={s.doc_type} className="border-t">
                      <td className="px-3 py-2">{DOC_LABELS[s.doc_type]}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.count.toLocaleString("pt-BR")}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {fmtDate(s.last_sync)}{s.completed ? "" : " · em andamento"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-sm text-muted-foreground">
              {totalDocs.toLocaleString("pt-BR")} documentos · anexos: {attachments.stored} guardados,{" "}
              {attachments.pending} pendentes{attachments.error ? `, ${attachments.error} com erro` : ""}.
            </p>

            <div className="rounded-md border">
              <table className="w-full text-sm">
                <caption className="sr-only">Cadastros guardados no backup</caption>
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Cadastro</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Copiados</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Última cópia</th>
                  </tr>
                </thead>
                <tbody>
                  {masterStats.map((m) => (
                    <tr key={m.entity} className="border-t">
                      <td className="px-3 py-2">{MASTER_LABELS[m.entity]}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{m.count.toLocaleString("pt-BR")}</td>
                      <td className="px-3 py-2 text-muted-foreground">{fmtDate(m.last_sync)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {progress && (
              <div className="space-y-1">
                <Progress value={busy ? undefined : 0} aria-label="Progresso da cópia" />
                <p className="text-xs text-muted-foreground">{progress}</p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void runPull(true)} disabled={busy !== null}>
                {busy === "pull" && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                Copiar novidades dos documentos
              </Button>
              <Button variant="outline" onClick={() => void runMasterPull()} disabled={busy !== null}>
                {busy === "master" && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                Copiar cadastros
              </Button>
              <Button variant="outline" onClick={() => void runAttachments()} disabled={busy !== null}>
                {busy === "attachments" && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                Copiar anexos
              </Button>
            </div>

            <div className="space-y-2 rounded-md border border-dashed p-3">
              <p className="text-sm font-medium flex items-center gap-2">
                <Undo2 className="h-4 w-4" aria-hidden="true" /> Devolver os dados ao ERP
              </p>
              <p className="text-xs text-muted-foreground">
                Recria no ERP os documentos guardados, na ordem correta. Simule primeiro para ver o
                que falta de cadastro no destino.
              </p>
              <div className="space-y-1">
                <Label htmlFor="arquivo-destino">Base de destino</Label>
                <Select value={targetDb || companyDb} onValueChange={(v) => { setTargetDb(v); setConfirmText(""); }}>
                  <SelectTrigger id="arquivo-destino" className="sm:w-96">
                    <SelectValue placeholder="Selecione a base de destino" />
                  </SelectTrigger>
                  <SelectContent>
                    {sapCompanies.map((c) => (
                      <SelectItem key={c.company_db} value={c.company_db}>
                        {c.display_name} · {c.company_db}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Pode ser a base nova: os cadastros vão primeiro e depois os documentos.
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <Button variant="outline" onClick={() => void runRestore(true)} disabled={busy !== null}>
                  {busy === "dry" && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                  Simular devolução
                </Button>
                <div className="space-y-1">
                  <Label htmlFor="arquivo-confirmacao" className="text-xs">
                    Digite {targetDb || companyDb} para liberar
                  </Label>
                  <Input
                    id="arquivo-confirmacao"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    className="w-56"
                    autoComplete="off"
                  />
                </div>
                <Button
                  variant="outline"
                  onClick={() => void runRestore(false, true)}
                  disabled={busy !== null || confirmText !== (targetDb || companyDb)}
                >
                  {busy === "restoreMaster" && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                  Devolver só os cadastros
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => void runRestore(false)}
                  disabled={busy !== null || confirmText !== (targetDb || companyDb)}
                >
                  {busy === "restore" && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                  Devolver cadastros e documentos
                </Button>
              </div>

              {dryResult && (
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>
                    Fornecedores/clientes faltando no destino:{" "}
                    {dryResult.missing_business_partners?.length
                      ? dryResult.missing_business_partners.join(", ")
                      : "nenhum"}
                  </p>
                  <p>
                    Itens faltando no destino:{" "}
                    {dryResult.missing_items?.length ? dryResult.missing_items.join(", ") : "nenhum"}
                  </p>
                </div>
              )}
            </div>

            {runs.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Últimas execuções</p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {runs.map((r) => (
                    <li key={r.id}>
                      {fmtDate(r.started_at)} · {r.kind} · {r.status} · {r.documents_count} doc(s)
                      {r.attachments_count ? ` · ${r.attachments_count} anexo(s)` : ""}
                      {Array.isArray(r.errors) && r.errors.length
                        ? ` · ${(r.errors as string[])[0]}`
                        : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
