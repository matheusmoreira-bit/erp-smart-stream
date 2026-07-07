import { useEffect, useRef, useState } from "react";

/**
 * Lazy-render helper: shows `initial` items and grows by `step` when the
 * sentinel becomes visible (or when the caller triggers `loadMore`).
 *
 * Reset the window automatically whenever any value in `resetDeps` changes,
 * so filter changes always bring the user back to the top of the list.
 */
export function useLazyList<T>(
  items: T[],
  {
    initial = 30,
    step = 10,
    resetDeps = [] as unknown[],
  }: { initial?: number; step?: number; resetDeps?: unknown[] } = {},
) {
  const [visibleCount, setVisibleCount] = useState(initial);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVisibleCount(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, items.length === 0, ...resetDeps]);

  const hasMore = visibleCount < items.length;
  const loadMore = () =>
    setVisibleCount((c) => Math.min(c + step, items.length));

  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, items.length]);

  return {
    visibleItems: items.slice(0, visibleCount),
    visibleCount,
    hasMore,
    loadMore,
    sentinelRef,
    total: items.length,
    initial,
  };
}
