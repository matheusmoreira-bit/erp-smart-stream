import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
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
import { ArrowRightLeft, Loader2, Play, Eye, History } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";

interface CompanyOpt { company_db: string; display_name: string }

interface TransferResult {
  dryRun: boolean;
  fromUser?: { code: string; internalKey: number; email?: string };
  toUser?: { code: string; internalKey: number; email?: string };
  transferred: Array<Record<string, unknown>>;
  skipped: Array<Record<string, unknown>>;
  errors: Array<Record<string, unknown>>;
}

export default function TransferApprovalsTool() {
  const [companies, setCompanies] = useState<CompanyOpt[]>([]);
  const [companyDb, setCompanyDb] = useState("open_gaming_sa");
  const [fromUser, setFromUser] = useState("");
  const [toUser, setToUser] = useState("juliana.gavineli");
  const [costCenter, setCostCenter] = useState("");
  const [reason, setReason] = useState("Transferência administrativa de aprovações pendentes");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TransferResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    supabase.from("companies").select("company_db, display_name")
      .eq("is_active", true).order("display_name")
      .then(({ data }) => setCompanies(data || []));
  }, []);

  const run = async (dryRun: boolean) => {
    if (!companyDb || !toUser.trim()) {
      toast.error("Preencha empresa e usuário de destino");
      return;
    }
    if (!fromUser.trim() && !costCenter.trim()) {
      toast.error("Informe usuário de origem e/ou centro de custo");
      return;
    }
    if (fromUser.trim() && fromUser.trim().toLowerCase() === toUser.trim().toLowerCase()) {
      toast.error("Origem e destino devem ser diferentes");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("transfer-approvals", {
        body: {
          company_db: companyDb,
          from_user_code: fromUser.trim() || undefined,
          to_user_code: toUser.trim(),
          cost_center: costCenter.trim() || undefined,
          reason,
          dry_run: dryRun,
        },
      });
      if (error) throw error;
      const res = data as TransferResult;
      setResult(res);
      const count = res.transferred?.length ?? 0;
      if (dryRun) {
        toast.success(`Preview: ${count} aprovação(ões) seriam transferidas`);
      } else {
        toast.success(`${count} aprovação(ões) transferidas`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao transferir aprovações");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-foreground">Transferir aprovações pendentes</h3>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/backoffice/transfer-history">
            <History className="w-4 h-4 mr-1.5" />
            Ver histórico
          </Link>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Reatribui aprovações SAP pendentes para outro aprovador dentro da mesma empresa e envia
        notificação in-app. Filtre por usuário de origem e/ou centro de custo (informe pelo menos um).
        Faça o preview antes de executar.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Empresa</Label>
          <Select value={companyDb} onValueChange={setCompanyDb}>
            <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
            <SelectContent>
              {companies.map((c) => (
                <SelectItem key={c.company_db} value={c.company_db}>
                  {c.display_name} <span className="opacity-60">({c.company_db})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Para (UserCode SAP)</Label>
          <Input value={toUser} onChange={(e) => setToUser(e.target.value)} placeholder="juliana.gavineli" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">De (UserCode SAP) — opcional</Label>
          <Input value={fromUser} onChange={(e) => setFromUser(e.target.value)} placeholder="ex: lucas.silva" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Centro de custo — opcional</Label>
          <Input value={costCenter} onChange={(e) => setCostCenter(e.target.value)} placeholder="ex: 1.8.1.4" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Motivo (aparece no audit log)</Label>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </div>


      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={loading} onClick={() => run(true)}>
          {loading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Eye className="w-4 h-4 mr-1.5" />}
          Preview (dry-run)
        </Button>
        <Button size="sm" disabled={loading} onClick={() => setConfirmOpen(true)}>
          {loading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Play className="w-4 h-4 mr-1.5" />}
          Executar transferência
        </Button>
      </div>

      {result && (
        <div className="mt-2 rounded-lg border border-border bg-muted/30 p-3 space-y-2">
          <div className="text-xs text-muted-foreground">
            {result.dryRun ? "Preview" : "Execução"} — de{" "}
            <span className="font-mono text-foreground">{result.fromUser?.code}</span> →{" "}
            <span className="font-mono text-foreground">{result.toUser?.code}</span>
          </div>
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="text-emerald-600">Transferidas: {result.transferred?.length ?? 0}</span>
            <span className="text-muted-foreground">Ignoradas: {result.skipped?.length ?? 0}</span>
            <span className="text-destructive">Erros: {result.errors?.length ?? 0}</span>
          </div>
          <pre className="text-[11px] leading-relaxed max-h-64 overflow-auto bg-background/50 rounded p-2 border border-border">
{JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Executar transferência de aprovações?"
        description={`As aprovações SAP pendentes${fromUser ? ` de ${fromUser}` : ""}${costCenter ? ` no CC ${costCenter}` : ""} serão reatribuídas para ${toUser} em ${companyDb}. Essa ação é registrada no audit log.`}
        confirmLabel="Transferir"
        destructive
        onConfirm={() => run(false)}
      />
    </div>
  );
}
