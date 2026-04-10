import { useMemo } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { isFailedLogin } from "@/hooks/useUserActivity";
import type { Usr5Record } from "@/hooks/useUserActivity";

interface Props {
  records: Usr5Record[]; // all records for historical avg
  filtered: Usr5Record[]; // filtered records for current month bars
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export default function MonthlyLoginChart({ records }: Props) {
  const chartData = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const totalDays = daysInMonth(currentYear, currentMonth);
    const currentMonthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}`;

    // Current month logins per day
    const currentMap = new Map<number, { logins: number; failures: number }>();
    for (let d = 1; d <= totalDays; d++) {
      currentMap.set(d, { logins: 0, failures: 0 });
    }

    // Historical: collect logins per day-of-month across all OTHER months
    const histMap = new Map<number, { total: number; months: Set<string> }>();
    for (let d = 1; d <= 31; d++) {
      histMap.set(d, { total: 0, months: new Set() });
    }

    records.forEach((r) => {
      if (r.Action !== "I" && r.Action !== "W") return;
      const dateStr = r.Date?.slice(0, 10);
      if (!dateStr) return;
      const month = dateStr.slice(0, 7);
      const dayNum = parseInt(dateStr.slice(8, 10));
      if (isNaN(dayNum)) return;

      if (month === currentMonthStr) {
        const entry = currentMap.get(dayNum);
        if (entry) {
          if (isFailedLogin(r)) {
            entry.failures++;
          } else {
            entry.logins++;
          }
        }
      } else {
        const hist = histMap.get(dayNum);
        if (hist && !isFailedLogin(r)) {
          hist.total++;
          hist.months.add(month);
        }
      }
    });

    // Count distinct historical months for averaging
    const allHistMonths = new Set<string>();
    histMap.forEach((v) => v.months.forEach((m) => allHistMonths.add(m)));
    const numHistMonths = Math.max(allHistMonths.size, 1);

    return Array.from({ length: totalDays }, (_, i) => {
      const day = i + 1;
      const cur = currentMap.get(day) || { logins: 0, failures: 0 };
      const hist = histMap.get(day);
      const avg = hist ? Math.round((hist.total / numHistMonths) * 10) / 10 : 0;
      return {
        day: String(day),
        Logins: cur.logins,
        Falhas: cur.failures,
        "Média Histórica": avg,
      };
    });
  }, [records]);

  const monthLabel = new Date().toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">
          Logins por Dia — {monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)}
        </h3>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={chartData}>
          <XAxis
            dataKey="day"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            interval={1}
          />
          <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              color: "hsl(var(--foreground))",
              fontSize: 12,
            }}
          />
          <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="Logins" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} barSize={14} />
          <Bar dataKey="Falhas" fill="hsl(var(--destructive))" radius={[3, 3, 0, 0]} barSize={14} />
          <Line
            dataKey="Média Histórica"
            type="monotone"
            stroke="hsl(var(--warning, 38 92% 50%))"
            strokeWidth={2}
            strokeDasharray="6 3"
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
