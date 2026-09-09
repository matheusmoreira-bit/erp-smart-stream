import { useCallback, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

export type SortDir = "asc" | "desc";

/** Botão de ordenação reutilizável (usado dentro ou fora de tabelas). */
export function SortButton<K extends string>({
  label,
  sortKey,
  active,
  dir,
  onSort,
  className = "",
}: {
  label: string;
  sortKey: K;
  active: boolean;
  dir: SortDir;
  onSort: (key: K) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      aria-label={`Ordenar por ${label}`}
      className={`inline-flex items-center gap-1 rounded transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        active ? "text-foreground" : ""
      } ${className}`}
    >
      {label}
      {active ? (
        dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
      ) : (
        <ArrowUpDown className="w-3 h-3 opacity-40" />
      )}
    </button>
  );
}

/** Cabeçalho de tabela clicável com indicador de ordenação. */
export function SortTh<K extends string>({
  label,
  sortKey,
  active,
  dir,
  onSort,
  align = "left",
  className = "",
}: {
  label: string;
  sortKey: K;
  active: boolean;
  dir: SortDir;
  onSort: (key: K) => void;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th className={`px-3 py-2 font-medium ${align === "right" ? "text-right" : "text-left"} ${className}`}>
      <SortButton label={label} sortKey={sortKey} active={active} dir={dir} onSort={onSort} />
    </th>
  );
}

/** Estado de ordenação com alternância asc/desc na mesma coluna. */
export function useTableSort<K extends string>(initialKey: K, initialDir: SortDir = "desc") {
  const [sort, setSort] = useState<{ key: K; dir: SortDir }>({ key: initialKey, dir: initialDir });
  const toggleSort = useCallback(
    (key: K) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" })),
    [],
  );
  return { sort, toggleSort };
}

/** Comparador estável para valores string/number/null. */
export function compareValues(a: unknown, b: unknown, dir: SortDir): number {
  const mult = dir === "asc" ? 1 : -1;
  const an = a === null || a === undefined || a === "";
  const bn = b === null || b === undefined || b === "";
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  if (typeof a === "number" && typeof b === "number") return (a - b) * mult;
  return String(a).localeCompare(String(b), "pt-BR", { numeric: true, sensitivity: "base" }) * mult;
}
