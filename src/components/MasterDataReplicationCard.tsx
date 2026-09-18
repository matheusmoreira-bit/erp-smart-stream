import { useCallback, useMemo, useState } from "react";
import { Copy, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { sapFunctionFetch } from "@/lib/auth-fetch";

type Scope = "suppliers" | "customers" | "items";

const SCOPE_LABELS: Record<Scope, string> = {
  suppliers: "Fornecedores",
  customers: "Clientes",
  items: "Itens",
};

interface ScopeResult {
  scope: Scope;
  created: number;
  skipped: number;
  failed: number;
  errors: Array<{ code: string; error: string }>;
}

const BATCH_SIZE = 10;

/**
 * Réplica de cadastros mestres (fornecedores, clientes e itens) de uma empresa
 * do ERP para outra — tipicamente de produção para a base de teste.
 * Registros já existentes no destino são preservados (nunca sobrescritos).
 */
export function MasterDataReplicationCard() {
  const { isAdmin } = useAuth();
  const { companies } = useCompanies();

  const sapCompanies = useMemo(
    () => companies.filter((c) => (c.erp_type || "sap") === "sap"),
    [companies],
  );

  const [sourceDb, setSourceDb] = useState("");
  const [targetDb, setTargetDb] = useState("");
  const [scopes, setScopes] = useState<Scope[]>(["suppliers", "items"]);
  const [dryRun, setDryRun] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [results, setResults] = useState<ScopeResult[] | null>(null);

  const toggleScope = useCallback((scope: Scope, checked: boolean) => {
    setScopes((prev) => (checked ? [...new Set([...prev, scope])] : prev.filter((s) => s !== scope)));
  }, []);

  const run = useCallback(async () => {
    if (!sourceDb || !targetDb || sourceDb === targetDb || scopes.length === 0) return;
    setRunning(true);
    setResults(null);
    const acc: ScopeResult[] = [];
    try {
      for (const scope of scopes) {
        const summary: ScopeResult = { scope, created: 0, skipped: 0, failed: 0, errors: [] };
        let offset: number | null = 0;
        let total = 0;
        while (offset !== null) {
          // O ERP pode demorar; em falha de rede tentamos novamente antes de abortar.
          let response: Response | null = null;
          let lastNetworkError: unknown = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              response = await sapFunctionFetch("sap-master-data-replicate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  source_company_db: sourceDb,
                  target_company_db: targetDb,
                  scope,
                  offset,
                  limit: BATCH_SIZE,
                  dry_run: dryRun,
                }),
              });
              break;
            } catch (err) {
              lastNetworkError = err;
              await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
            }
          }
          if (!response) {
            throw new Error(
              "Não foi possível falar com o ERP agora (conexão interrompida). Tente novamente em alguns minutos." +
                (lastNetworkError ? "" : ""),
            );
          }
          const data = await response.json().catch(() => null);
          if (!response.ok || data?.error) throw new Error(data?.error || `HTTP ${response.status}`);

          summary.created += Number(data.created || 0);
          summary.skipped += Number(data.skipped || 0);
          summary.failed += Number(data.failed || 0);
          summary.errors.push(...((data.errors || []) as ScopeResult["errors"]));
          total = Number(data.total) || total;
          const done = Number(offset) + Number(data.processed || 0);
          setProgress({ label: SCOPE_LABELS[scope], done, total: total || done });
          offset = data.next_offset === null || data.next_offset === undefined
            ? null
            : Number(data.next_offset);
        }
        acc.push(summary);
        setResults([...acc]);
      }
      const created = acc.reduce((s, r) => s + r.created, 0);
      const failed = acc.reduce((s, r) => s + r.failed, 0);
      toast.success(
        dryRun
          ? `Simulação: ${created} cadastros seriam criados no destino.`
          : `${created} cadastros criados${failed ? ` · ${failed} com falha` : ""}.`,
      );
    } catch (e) {
      toast.error((e as Error).message);
      setResults(acc.length ? acc : null);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }, [sourceDb, targetDb, scopes, dryRun]);

  if (!isAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4" aria-hidden="true" /> Réplica de cadastros
          </CardTitle>
          <CardDescription>Apenas administradores podem replicar cadastros entre empresas.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const pct = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.done / progress.total) * 100))
    : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Copy className="h-4 w-4" aria-hidden="true" /> Réplica de cadastros entre empresas
        </CardTitle>
        <CardDescription>
          Copia fornecedores, clientes e itens de uma empresa do ERP para outra (ex.: produção →
          teste). Cadastros que já existem no destino são mantidos como estão.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="replica-origem">Origem</Label>
            <Select value={sourceDb} onValueChange={setSourceDb}>
              <SelectTrigger id="replica-origem">
                <SelectValue placeholder="Selecione a empresa de origem" />
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
          <div className="space-y-1">
            <Label htmlFor="replica-destino">Destino</Label>
            <Select value={targetDb} onValueChange={setTargetDb}>
              <SelectTrigger id="replica-destino">
                <SelectValue placeholder="Selecione a empresa de destino" />
              </SelectTrigger>
              <SelectContent>
                {sapCompanies
                  .filter((c) => c.company_db !== sourceDb)
                  .map((c) => (
                    <SelectItem key={c.company_db} value={c.company_db}>
                      {c.display_name} · {c.company_db}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          {(Object.keys(SCOPE_LABELS) as Scope[]).map((scope) => (
            <div key={scope} className="flex items-center gap-2">
              <Checkbox
                id={`replica-${scope}`}
                checked={scopes.includes(scope)}
                onCheckedChange={(v) => toggleScope(scope, v === true)}
              />
              <Label htmlFor={`replica-${scope}`} className="font-normal">
                {SCOPE_LABELS[scope]}
              </Label>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Checkbox
              id="replica-dry-run"
              checked={dryRun}
              onCheckedChange={(v) => setDryRun(v === true)}
            />
            <Label htmlFor="replica-dry-run" className="font-normal">
              Apenas simular (não grava no destino)
            </Label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => void run()}
            disabled={running || !sourceDb || !targetDb || scopes.length === 0}
          >
            {running ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {dryRun ? "Simular réplica" : "Replicar cadastros"}
          </Button>
          {progress && (
            <span className="text-sm text-muted-foreground">
              {progress.label}: {progress.done} de {progress.total || "?"}
            </span>
          )}
        </div>

        {progress && <Progress value={pct} aria-label="Progresso da réplica" />}

        {results && (
          <div className="space-y-2 text-sm">
            {results.map((r) => (
              <div key={r.scope} className="rounded-md border p-3">
                <p className="font-medium">{SCOPE_LABELS[r.scope]}</p>
                <p className="text-muted-foreground">
                  {dryRun ? `${r.created} a criar` : `${r.created} criados`} · {r.skipped} já existiam
                  {r.failed ? ` · ${r.failed} com falha` : ""}
                </p>
                {r.errors.length > 0 && (
                  <ul className="mt-1 list-inside list-disc text-destructive">
                    {r.errors.slice(0, 10).map((e, i) => (
                      <li key={`${e.code}-${i}`}>
                        {e.code}: {e.error}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
