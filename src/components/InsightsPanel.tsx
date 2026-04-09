import { motion } from "framer-motion";
import { Lightbulb, AlertTriangle, TrendingUp, Zap } from "lucide-react";

export interface Insight {
  id: string;
  type: "bottleneck" | "improvement" | "alert" | "positive";
  title: string;
  description: string;
  impact: "alto" | "médio" | "baixo";
}

const typeConfig = {
  bottleneck: { icon: AlertTriangle, color: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/20" },
  improvement: { icon: Lightbulb, color: "text-warning", bg: "bg-warning/10", border: "border-warning/20" },
  alert: { icon: Zap, color: "text-primary", bg: "bg-primary/10", border: "border-primary/20" },
  positive: { icon: TrendingUp, color: "text-success", bg: "bg-success/10", border: "border-success/20" },
};

const impactBadge = {
  alto: "bg-destructive/20 text-destructive",
  médio: "bg-warning/20 text-warning",
  baixo: "bg-muted text-muted-foreground",
};

interface InsightsPanelProps {
  insights: Insight[];
}

export function InsightsPanel({ insights }: InsightsPanelProps) {
  return (
    <div className="glass-card p-6">
      <div className="flex items-center gap-2 mb-5">
        <Lightbulb className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold text-foreground">Insights & Recomendações IA</h2>
      </div>
      <div className="space-y-3">
        {insights.map((insight, i) => {
          const config = typeConfig[insight.type];
          const Icon = config.icon;
          return (
            <motion.div
              key={insight.id}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.08 }}
              className={`p-4 rounded-lg border ${config.bg} ${config.border} flex gap-3`}
            >
              <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${config.color}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-foreground">{insight.title}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium uppercase ${impactBadge[insight.impact]}`}>
                    {insight.impact}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{insight.description}</p>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
