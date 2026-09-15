import { useCallback, useEffect, useMemo, useState } from "react";
import { CloudOff, Download, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";
import { useAuth } from "@/hooks/useAuth";
import { sapFunctionFetch } from "@/lib/auth-fetch";
import { invalidateStandaloneModes } from "@/lib/standalone-mode";
import { useStandaloneMode } from "@/hooks/useStandaloneMode";

interface SnapshotResult {
  cache_key: string;
  rows: number;
  status: string;
  error?: string;
}

/**
 * Controle administrativo do modo standalone da empresa ativa:
 * copia os cadastros do ERP para o banco do Flow e pausa as integrações
 * SAP/HANA apenas desta empresa.
 */
export function StandaloneModeCard() {
  const { session } = useSap();
  const { isAdmin } = useAuth();
  const companyDb = session?.companyDB ?? null;
  const { mode, loading, refresh } = useStandaloneMode(companyDb);

  const [reason, setReason] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [snapshotting, setSnapshotting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [results, setResults] = useState<SnapshotResult[] | null>(null);

  useEffect(() => {
    setReason(mode?.reason ?? "");
    setEndsAt(mode?.ends_at ? mode.ends_at.slice(0, 16) : "");
  }, [mode?.reason, mode?.ends_at]);

  const snapshotAt = mode?.snapshot_at ?? null;
  const hasSnapshot = !!snapshotAt;

  const [storedSnapshotAt, setStoredSnapshotAt] = useState<string | null>(null);
  useEffect(() => {
    if (!companyDb) return;
    let cancelled = false;
    void supabase
      .from("standalone_mode")
      .select("snapshot_at")
      .eq("company_db", companyDb)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setStoredSnapshotAt((data?.snapshot_at as string) ?? null);
      });
    return () => { cancelled = true; };
  }, [companyDb, snapshotting]);

  const lastSnapshot = snapshotAt ?? storedSnapshotAt;

  const runSnapshot = useCallback(async () => {
    if (!companyDb) return;
    setSnapshotting(true);
    setResults(null);
    try {
      const response = await sapFunctionFetch("standalone-snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_db: companyDb, ttl_days: 30 }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.error) throw new Error(data?.error || `HTTP ${response.status}`);
      setResults((data?.results as SnapshotResult[]) || []);
      toast.success(`Cadastros copiados: ${data?.total_rows ?? 0} registros.`);
      await refresh();
    } catch (e) {
      toast.error(`Falha ao copiar os cadastros: ${(e as Error).message}`);
    } finally {
      setSnapshotting(false);
    }
  }, [companyDb, refresh]);

  const toggle = useCallback(
    async (next: boolean) => {
      if (!companyDb) return;
      if (next && !lastSnapshot) {
        toast.error("Copie os cadastros antes de ligar o modo standalone.");
        return;
      }
      setToggling(true);
      try {
        const { data: userData } = await supabase.auth.getUser();
        const { error } = await supabase.from("standalone_mode").upsert(
          {
            company_db: companyDb,
            enabled: next,
            reason: reason.trim() || null,
            ends_at: endsAt ? new Date(endsAt).toISOString() : null,
            updated_by: userData?.user?.id ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "company_db" },
        );
        if (error) throw new Error(error.message);
        invalidateStandaloneModes();
        await refresh();
        toast.success(next ? "Modo standalone ligado." : "Modo standalone desligado — a fila será enviada ao ERP.");
      } catch (e) {
        toast.error(`Não foi possível alterar o modo: ${(e as Error).message}`);
      } finally {
        setToggling(false);
      }
    },
    [companyDb, endsAt, lastSnapshot, reason, refresh],
  );

  const summary = useMemo(() => {
    if (!results) return null;
    const ok = results.filter((r) => r.status === "ok");
    const failed = results.filter((r) => r.status === "error");
    return { ok, failed };
  }, [results]);

  if (!isAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4" aria-hidden="true" /> Modo standalone
          </CardTitle>
          <CardDescription>Apenas administradores podem configurar este modo.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CloudOff className="h-4 w-4" aria-hidden="true" /> Modo standalone (sem ERP)
          {mode ? <Badge variant="destructive">Ativo</Badge> : <Badge variant="secondary">Desligado</Badge>}
        </CardTitle>
        <CardDescription>
          Copia os cadastros do ERP para o banco do Flow e pausa as integrações SAP/HANA apenas da
          empresa ativa{companyDb ? ` (${companyDb})` : ""}. Documentos aprovados ficam na fila e são
          enviados ao ERP quando o modo for desligado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!companyDb ? (
          <p className="text-sm text-muted-foreground">Faça login em uma empresa para configurar.</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="standalone-reason">Motivo</Label>
                <Input
                  id="standalone-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Ex.: manutenção do servidor SAP"
                  maxLength={200}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="standalone-ends">Desligar automaticamente em</Label>
                <Input
                  id="standalone-ends"
                  type="datetime-local"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => void runSnapshot()} disabled={snapshotting} variant="outline">
                {snapshotting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                )}
                Copiar cadastros do ERP
              </Button>
              <span className="text-sm text-muted-foreground">
                {lastSnapshot
                  ? `Última cópia: ${new Date(lastSnapshot).toLocaleString("pt-BR")}`
                  : "Nenhuma cópia feita ainda."}
              </span>
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">Operar sem o ERP</p>
                <p className="text-sm text-muted-foreground">
                  {loading ? "Verificando…" : mode ? "Integrações SAP/HANA pausadas." : "Integrações normais."}
                </p>
              </div>
              <Switch
                checked={!!mode}
                onCheckedChange={(v) => void toggle(v)}
                disabled={toggling || loading}
                aria-label="Ligar ou desligar o modo standalone"
              />
            </div>

            {summary && (
              <div className="space-y-1 text-sm">
                <p className="text-muted-foreground">
                  {summary.ok.length} listas copiadas
                  {summary.failed.length > 0 ? ` · ${summary.failed.length} com falha` : ""}
                </p>
                {summary.failed.length > 0 && (
                  <ul className="list-inside list-disc text-destructive">
                    {summary.failed.map((r) => (
                      <li key={r.cache_key}>
                        {r.cache_key}: {r.error}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
