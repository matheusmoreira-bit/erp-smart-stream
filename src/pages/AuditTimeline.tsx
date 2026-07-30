import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { History, Search, Loader2 } from "lucide-react";
import { BackofficePageHeader } from "@/components/BackofficePageHeader";
import { DocumentTimeline } from "@/components/DocumentTimeline";
import { expenseRead } from "@/lib/expense-read";
import { cn } from "@/lib/utils";

interface DocRow {
  id: string;
  doc_type: string | null;
  status: string | null;
  supplier_name: string | null;
  requester_name: string | null;
  requester_email: string | null;
  company_db: string | null;
  sap_doc_num: number | null;
  total_amount: number | null;
  currency: string | null;
  created_at: string;
}

const COLUMNS =
  "id, doc_type, status, supplier_name, requester_name, requester_email, company_db, sap_doc_num, total_amount, currency, created_at";

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleString("pt-BR") : "—");
const fmtMoney = (v: number | null, c: string | null) =>
  v == null ? "—" : `${c ?? "BRL"} ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

export default function AuditTimeline() {
  const [params, setParams] = useSearchParams();
  const [term, setTerm] = useState(params.get("q") ?? "");
  const [rows, setRows] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DocRow | null>(null);

  const search = useCallback(async (raw: string) => {
    setLoading(true);
    setError(null);
    const q = raw.trim();
    let builder = expenseRead("expenses").select(COLUMNS);
    if (q) {
      const isUuid = /^[0-9a-f-]{36}$/i.test(q);
      const isNum = /^\d+$/.test(q);
      if (isUuid) builder = builder.eq("id", q);
      else if (isNum) builder = builder.eq("sap_doc_num", Number(q));
      else
        builder = builder.or(
          `supplier_name.ilike.%${q}%,requester_name.ilike.%${q}%,requester_email.ilike.%${q}%,company_db.ilike.%${q}%`,
        );
    }
    const { data, error: err } = await builder
      .order("created_at", { ascending: false })
      .limit(40);
    if (err) setError(err.message);
    setRows((data ?? []) as DocRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void search(params.get("q") ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = params.get("doc");
    if (id && (!selected || selected.id !== id)) {
      void (async () => {
        const { data } = await expenseRead("expenses").select(COLUMNS).eq("id", id).limit(1);
        if (data && data[0]) setSelected(data[0] as DocRow);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(params);
    if (term) next.set("q", term);
    else next.delete("q");
    setParams(next, { replace: true });
    void search(term);
  };

  const pick = (row: DocRow) => {
    setSelected(row);
    const next = new URLSearchParams(params);
    next.set("doc", row.id);
    setParams(next, { replace: true });
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <BackofficePageHeader
        title="Trilha de Auditoria Unificada"
        description="Uma única linha do tempo por documento, reunindo eventos de ERP, SAP, aprovações, integrações, notificações e alterações de dados."
        icon={<History className="h-5 w-5 text-muted-foreground" />}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
        <Card className="h-fit">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Documentos</CardTitle>
            <form onSubmit={submit} className="flex gap-2 pt-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  placeholder="Nº SAP, fornecedor, solicitante, base ou ID"
                  className="pl-8"
                />
              </div>
              <Button type="submit" size="sm" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buscar"}
              </Button>
            </form>
          </CardHeader>
          <CardContent className="space-y-1.5 max-h-[70vh] overflow-y-auto">
            {error && <p className="text-sm text-destructive">{error}</p>}
            {!loading && rows.length === 0 && (
              <p className="text-sm text-muted-foreground py-6 text-center">Nenhum documento encontrado.</p>
            )}
            {rows.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => pick(r)}
                className={cn(
                  "w-full text-left rounded-md border p-2.5 hover:bg-muted/50 transition-colors",
                  selected?.id === r.id ? "border-primary bg-muted/40" : "border-border",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">
                    {r.supplier_name ?? "Sem fornecedor"}
                  </span>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {r.sap_doc_num ? `SAP ${r.sap_doc_num}` : r.status ?? "—"}
                  </Badge>
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {[r.company_db, r.requester_name ?? r.requester_email, fmtMoney(r.total_amount, r.currency)]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                <div className="text-[11px] text-muted-foreground">{fmtDate(r.created_at)}</div>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {selected
                ? `${selected.doc_type === "sales" ? "Pedido de venda" : "Pedido de compra"}${
                    selected.sap_doc_num ? ` · SAP ${selected.sap_doc_num}` : ""
                  }`
                : "Linha do tempo"}
            </CardTitle>
            {selected && (
              <p className="text-xs text-muted-foreground">
                {[selected.supplier_name, selected.company_db, selected.status].filter(Boolean).join(" · ")}
              </p>
            )}
          </CardHeader>
          <CardContent>
            {selected ? (
              <DocumentTimeline expenseId={selected.id} />
            ) : (
              <p className="text-sm text-muted-foreground py-10 text-center">
                Selecione um documento à esquerda para ver a trilha completa.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
