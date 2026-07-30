import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, XCircle, AlertTriangle, ShieldCheck } from "lucide-react";

type Info = {
  ok: boolean;
  approverName?: string | null;
  approverEmail?: string | null;
  expired?: boolean;
  used?: boolean;
  usedAction?: string | null;
  pending?: boolean;
  status?: string | null;
  expense?: {
    id: string;
    docType?: string | null;
    companyDb?: string | null;
    supplierName?: string | null;
    totalAmount?: number | null;
    currency?: string | null;
    requesterName?: string | null;
    levelOrder?: number | null;
    dueDate?: string | null;
    description?: string | null;
  } | null;
};

function money(v?: number | null, currency?: string | null) {
  if (v === null || v === undefined) return "—";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(Number(v));
  } catch {
    return `${currency || "BRL"} ${Number(v).toFixed(2)}`;
  }
}

export default function ApprovalLink() {
  const { token = "" } = useParams();
  const [params] = useSearchParams();
  const intent = params.get("a");

  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState<"approve" | "reject" | null>(null);
  const [done, setDone] = useState<{ action: string; finalized: boolean | null; next?: string | null } | null>(null);

  const call = useCallback(
    async (action: "info" | "approve" | "reject", body?: Record<string, unknown>) => {
      const { data, error } = await supabase.functions.invoke("approval-link", {
        body: { token, action, ...body },
      });
      if (error) {
        let detail = "";
        try {
          // @ts-expect-error context existe em FunctionsHttpError
          detail = await error.context?.text?.();
        } catch { /* ignore */ }
        let msg = "Não foi possível concluir a operação.";
        try { msg = JSON.parse(detail)?.error || msg; } catch { /* ignore */ }
        throw new Error(msg);
      }
      return data as Info & { action?: string; finalized?: boolean | null; nextApproverName?: string | null };
    },
    [token],
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await call("info");
        if (alive) setInfo(data);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Link inválido.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [call]);

  const decide = async (action: "approve" | "reject") => {
    setSubmitting(action);
    setError(null);
    try {
      const data = await call(action, { remarks });
      setDone({ action, finalized: data.finalized ?? null, next: data.nextApproverName ?? null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao registrar a decisão.");
    } finally {
      setSubmitting(null);
    }
  };

  const exp = info?.expense;
  const blocked = useMemo(() => {
    if (!info) return null;
    if (info.expired) return "Este link expirou. Abra o ERP Flow para decidir.";
    if (info.used) return "Este link já foi utilizado.";
    if (info.status && info.status !== "pendente_aprovacao") return "Este documento não está mais pendente de aprovação.";
    return null;
  }, [info]);

  return (
    <main className="min-h-screen bg-background px-4 py-8 flex justify-center">
      <div className="w-full max-w-md space-y-4">
        <header className="text-center space-y-1">
          <h1 className="text-xl font-semibold text-foreground">Aprovação ERP Flow</h1>
          <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
            <ShieldCheck className="h-3.5 w-3.5" /> Link pessoal, de uso único
          </p>
        </header>

        {loading && (
          <Card>
            <CardContent className="py-10 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        )}

        {!loading && error && !info && (
          <Card className="border-destructive/40">
            <CardContent className="py-8 text-center space-y-2">
              <AlertTriangle className="h-6 w-6 mx-auto text-destructive" />
              <p className="text-sm text-foreground">{error}</p>
            </CardContent>
          </Card>
        )}

        {!loading && info && done && (
          <Card className="border-primary/40">
            <CardContent className="py-8 text-center space-y-3">
              {done.action === "approve" ? (
                <CheckCircle2 className="h-8 w-8 mx-auto text-primary" />
              ) : (
                <XCircle className="h-8 w-8 mx-auto text-destructive" />
              )}
              <p className="text-base font-medium text-foreground">
                {done.action === "approve" ? "Aprovação registrada" : "Documento reprovado"}
              </p>
              {done.action === "approve" && done.finalized === false && done.next && (
                <p className="text-sm text-muted-foreground">Encaminhado para {done.next}.</p>
              )}
              {done.action === "approve" && done.finalized && (
                <p className="text-sm text-muted-foreground">Última alçada concluída — o documento segue para integração.</p>
              )}
            </CardContent>
          </Card>
        )}

        {!loading && info && !done && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {exp?.docType === "sales" ? "Pedido de venda" : "Pedido de compra"}
                {exp?.levelOrder ? <Badge variant="secondary" className="ml-2">Nível {exp.levelOrder}</Badge> : null}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="space-y-2 text-sm">
                {[
                  { k: exp?.docType === "sales" ? "Cliente" : "Fornecedor", v: exp?.supplierName },
                  { k: "Valor", v: money(exp?.totalAmount, exp?.currency) },
                  { k: "Empresa", v: exp?.companyDb },
                  { k: "Solicitante", v: exp?.requesterName },
                  { k: "Aprovador", v: info.approverName || info.approverEmail },
                  { k: "Descrição", v: exp?.description },
                ]
                  .filter((r) => r.v)
                  .map((r) => (
                    <div key={r.k} className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">{r.k}</dt>
                      <dd className="font-medium text-right text-foreground">{r.v as string}</dd>
                    </div>
                  ))}
              </dl>

              {blocked ? (
                <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground flex gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{blocked}</span>
                </div>
              ) : (
                <>
                  <Textarea
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    maxLength={500}
                    placeholder="Observação (opcional)"
                    className="min-h-20"
                  />
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <div className="space-y-2">
                    <Button
                      className="w-full h-12 text-base"
                      disabled={!!submitting}
                      autoFocus={intent === "approve"}
                      onClick={() => decide("approve")}
                    >
                      {submitting === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Aprovar"}
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full h-12 text-base text-destructive border-destructive/40 hover:bg-destructive/10"
                      disabled={!!submitting}
                      autoFocus={intent === "reject"}
                      onClick={() => decide("reject")}
                    >
                      {submitting === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reprovar"}
                    </Button>
                  </div>
                </>
              )}

              <Button variant="ghost" className="w-full" asChild>
                <a href="/aprovacoes?tab=pending">Abrir no ERP Flow</a>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
