import { motion } from "framer-motion";
import { Clock, AlertTriangle, CheckCircle2, ArrowRight } from "lucide-react";

export interface FlowStage {
  id: string;
  name: string;
  avgDays: number;
  targetDays: number;
  status: "ok" | "warning" | "critical";
  count: number;
}

const statusConfig = {
  ok: { color: "text-success", bg: "bg-success/10", border: "border-success/30", icon: CheckCircle2 },
  warning: { color: "text-warning", bg: "bg-warning/10", border: "border-warning/30", icon: AlertTriangle },
  critical: { color: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/30", icon: AlertTriangle },
};

interface FlowTimelineProps {
  stages: FlowStage[];
}

export function FlowTimeline({ stages }: FlowTimelineProps) {
  return (
    <div className="glass-card p-6">
      <h2 className="text-lg font-semibold text-foreground mb-6">Fluxo de Compras — Tempo Médio por Etapa</h2>
      <div className="flex items-start justify-center gap-2 overflow-x-auto pb-4">
        {stages.map((stage, i) => {
          const config = statusConfig[stage.status];
          const Icon = config.icon;
          const ratio = stage.avgDays / stage.targetDays;

          return (
            <motion.div
              key={stage.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="flex items-center gap-2"
            >
              <div className={`flex flex-col items-center min-w-[140px] p-4 rounded-xl border ${config.bg} ${config.border}`}>
                <Icon className={`w-5 h-5 ${config.color} mb-2`} />
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">{stage.name}</span>
                <span className={`text-2xl font-bold font-mono ${config.color}`}>{stage.avgDays}d</span>
                <span className="text-xs text-muted-foreground mt-1">meta: {stage.targetDays}d</span>
                <div className="w-full mt-3 h-1.5 rounded-full bg-muted overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full ${stage.status === "ok" ? "bg-success" : stage.status === "warning" ? "bg-warning" : "bg-destructive"}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(ratio * 100, 100)}%` }}
                    transition={{ delay: i * 0.1 + 0.3, duration: 0.6 }}
                  />
                </div>
                <span className="text-xs text-muted-foreground mt-2">{stage.count} docs</span>
              </div>
              {i < stages.length - 1 && (
                <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              )}
            </motion.div>
          );
        })}
      </div>
      <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-success" /> Dentro da meta</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-warning" /> Atenção</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-destructive" /> Gargalo</span>
      </div>
    </div>
  );
}
