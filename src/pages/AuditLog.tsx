import { useNavigate } from "react-router-dom";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuditLog } from "@/hooks/useAuditLog";
import { useSap } from "@/contexts/SapContext";
import AuditLogTable from "@/components/AuditLogTable";

export default function AuditLogPage() {
  const navigate = useNavigate();
  const { session } = useSap();
  const companyDb = session?.companyDB;
  const { entries, isLoading, error, refresh } = useAuditLog(companyDb);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-foreground">Logs de Auditoria</h1>
              <p className="text-sm text-muted-foreground">
                Registro de ações — {companyDb || "todas as empresas"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive text-sm">{error}</div>
        )}
        <AuditLogTable entries={entries} isLoading={isLoading} />
      </main>
    </div>
  );
}
