import { useEffect, useState } from "react";

/**
 * useState clone that persists JSON-serializable values to localStorage.
 * Safe on SSR and against malformed stored data.
 */
export function usePersistedState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return initial;
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* quota / disabled — ignore */
    }
  }, [key, value]);

  return [value, setValue] as const;
}
