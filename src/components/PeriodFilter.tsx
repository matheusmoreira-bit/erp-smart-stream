import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export type PeriodPreset = "all" | "7d" | "30d" | "90d" | "180d" | "365d" | "custom";

export interface DateRange {
  from: Date | null;
  to: Date | null;
}

export interface PeriodFilterValue {
  preset: PeriodPreset;
  range: DateRange;
}

const PRESETS: { value: PeriodPreset; label: string }[] = [
  { value: "all", label: "Todo histórico" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "90d", label: "90 dias" },
  { value: "180d", label: "6 meses" },
  { value: "365d", label: "1 ano" },
  { value: "custom", label: "Personalizado" },
];

function presetToRange(preset: PeriodPreset): DateRange {
  if (preset === "all" || preset === "custom") return { from: null, to: null };
  const days = parseInt(preset);
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from, to };
}

interface PeriodFilterProps {
  value: PeriodFilterValue;
  onChange: (value: PeriodFilterValue) => void;
}

export function PeriodFilter({ value, onChange }: PeriodFilterProps) {
  const [calendarOpen, setCalendarOpen] = useState(false);

  const handlePreset = (preset: PeriodPreset) => {
    if (preset === "custom") {
      onChange({ preset: "custom", range: value.range });
    } else {
      onChange({ preset, range: presetToRange(preset) });
    }
  };

  const label = (() => {
    if (value.preset === "all") return "Todo histórico";
    if (value.preset === "custom" && value.range.from && value.range.to) {
      return `${format(value.range.from, "dd/MM/yy")} — ${format(value.range.to, "dd/MM/yy")}`;
    }
    return PRESETS.find((p) => p.value === value.preset)?.label || "Período";
  })();

  return (
    <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8">
          <CalendarDays className="w-3.5 h-3.5" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex">
          {/* Preset sidebar */}
          <div className="border-r border-border p-2 space-y-0.5 min-w-[120px]">
            {PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => {
                  handlePreset(p.value);
                  if (p.value !== "custom") setCalendarOpen(false);
                }}
                className={`w-full text-left text-xs px-2.5 py-1.5 rounded-md transition-colors ${
                  value.preset === p.value
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted text-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Calendar for custom */}
          {value.preset === "custom" && (
            <div className="p-2">
              <Calendar
                mode="range"
                selected={
                  value.range.from && value.range.to
                    ? { from: value.range.from, to: value.range.to }
                    : undefined
                }
                onSelect={(range) => {
                  if (range?.from && range?.to) {
                    onChange({ preset: "custom", range: { from: range.from, to: range.to } });
                    setCalendarOpen(false);
                  } else if (range?.from) {
                    onChange({ preset: "custom", range: { from: range.from, to: null } });
                  }
                }}
                locale={ptBR}
                numberOfMonths={2}
              />
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Helper: filter rows by a date field within the period range */
export function filterByPeriod<T>(
  rows: T[],
  period: PeriodFilterValue,
  getDate: (row: T) => string | null | undefined,
): T[] {
  if (period.preset === "all") return rows;
  const { from, to } = period.range;
  if (!from) return rows;
  const fromTime = from.getTime();
  const toTime = to ? to.getTime() + 24 * 60 * 60 * 1000 : Date.now(); // include full "to" day

  return rows.filter((row) => {
    const dateStr = getDate(row);
    if (!dateStr) return false;
    const d = new Date(dateStr).getTime();
    return !isNaN(d) && d >= fromTime && d <= toTime;
  });
}

export const DEFAULT_PERIOD: PeriodFilterValue = { preset: "all", range: { from: null, to: null } };
