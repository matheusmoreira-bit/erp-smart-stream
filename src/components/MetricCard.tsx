import { motion } from "framer-motion";
import { LucideIcon } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: LucideIcon;
  trend?: { value: string; positive: boolean };
  delay?: number;
}

export function MetricCard({ title, value, subtitle, icon: Icon, trend, delay = 0 }: MetricCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="glass-card p-5 flex flex-col gap-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{title}</span>
        <div className="p-2 rounded-lg bg-primary/10">
          <Icon className="w-4 h-4 text-primary" />
        </div>
      </div>
      <div>
        <span className="text-3xl font-bold font-mono text-foreground">{value}</span>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {trend && (
        <span className={`text-xs font-medium ${trend.positive ? "text-success" : "text-destructive"}`}>
          {trend.positive ? "↓" : "↑"} {trend.value} vs mês anterior
        </span>
      )}
    </motion.div>
  );
}
