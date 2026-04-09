import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

export interface ValidationItem {
  id: string;
  document: string;
  supplier: string;
  stage: string;
  status: "valid" | "warning" | "error";
  message: string;
  date: string;
}

const statusConfig = {
  valid: { icon: CheckCircle2, color: "text-success", label: "Válido" },
  warning: { icon: AlertTriangle, color: "text-warning", label: "Atenção" },
  error: { icon: XCircle, color: "text-destructive", label: "Erro" },
};

interface ValidationTableProps {
  items: ValidationItem[];
}

export function ValidationTable({ items }: ValidationTableProps) {
  return (
    <div className="glass-card p-6">
      <h2 className="text-lg font-semibold text-foreground mb-4">Validação de Lançamentos</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-3 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
              <th className="text-left py-3 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Documento</th>
              <th className="text-left py-3 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Fornecedor</th>
              <th className="text-left py-3 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Etapa</th>
              <th className="text-left py-3 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Mensagem</th>
              <th className="text-left py-3 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Data</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => {
              const config = statusConfig[item.status];
              const Icon = config.icon;
              return (
                <motion.tr
                  key={item.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.03 }}
                  className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                >
                  <td className="py-3 px-3">
                    <span className={`flex items-center gap-1.5 ${config.color}`}>
                      <Icon className="w-4 h-4" />
                      <span className="text-xs font-medium">{config.label}</span>
                    </span>
                  </td>
                  <td className="py-3 px-3 font-mono text-xs text-foreground">{item.document}</td>
                  <td className="py-3 px-3 text-foreground">{item.supplier}</td>
                  <td className="py-3 px-3 text-muted-foreground">{item.stage}</td>
                  <td className="py-3 px-3 text-muted-foreground max-w-[250px] truncate">{item.message}</td>
                  <td className="py-3 px-3 text-muted-foreground font-mono text-xs">{item.date}</td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
