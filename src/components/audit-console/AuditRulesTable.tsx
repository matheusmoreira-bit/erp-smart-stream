import { ListChecks } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuditRules, useUpdateAuditRule, type AuditRule } from "@/hooks/useAuditConsole";
import { useToast } from "@/hooks/use-toast";

const SEVERITIES: AuditRule["default_severity"][] = ["low", "medium", "high", "critical"];

export function AuditRulesTable() {
  const { data, isLoading } = useAuditRules();
  const update = useUpdateAuditRule();
  const { toast } = useToast();

  async function patch(id: string, p: Partial<AuditRule>) {
    try {
      await update.mutateAsync({ id, ...p });
    } catch (e) {
      toast({ title: "Erro ao salvar", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <ListChecks className="h-5 w-5" /> Regras de divergência
        </h2>
        <p className="text-sm text-muted-foreground">
          Ative/desative, ajuste a severidade padrão e a tolerância. Regras globais valem para todas as empresas.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card/60">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ativa</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Severidade</TableHead>
                <TableHead>Tolerância</TableHead>
                <TableHead>Escopo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Switch checked={r.is_active} onCheckedChange={(v) => patch(r.id, { is_active: v })} />
                  </TableCell>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.divergence_type}</TableCell>
                  <TableCell>
                    <Select value={r.default_severity} onValueChange={(v) => patch(r.id, { default_severity: v as AuditRule["default_severity"] })}>
                      <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number" step="0.01" className="h-8 w-24"
                      value={r.tolerance ?? ""}
                      onChange={(e) => patch(r.id, { tolerance: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.company_db ? r.company_db : "Global"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
