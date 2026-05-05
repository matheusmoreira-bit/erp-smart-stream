import { useMemo } from "react";
import { LogIn, Timer, ShieldAlert, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDuration, isFailedLogin } from "@/hooks/useUserActivity";
import type { Usr5Record } from "@/hooks/useUserActivity";

interface Props {
  records: Usr5Record[];
}

interface RankItem {
  user: string;
  value: number;
  formatted: string;
}

function RankingCard({
  title,
  icon: Icon,
  items,
  badgeClass,
}: {
  title: string;
  icon: React.ElementType;
  items: RankItem[];
  badgeClass?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
        <Icon className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <div className="divide-y divide-border">
        {items.map((item, i) => (
          <div
            key={item.user}
            className="flex items-center justify-between px-5 py-2.5 hover:bg-muted/20 transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-xs font-bold text-muted-foreground w-5 text-right">
                {i + 1}º
              </span>
              <span className="text-sm font-medium text-foreground truncate">
                {item.user}
              </span>
            </div>
            <Badge
              variant="secondary"
              className={`font-mono text-xs ${badgeClass || "bg-primary/15 text-primary"}`}
            >
              {item.formatted}
            </Badge>
          </div>
        ))}
        {items.length === 0 && (
          <div className="px-5 py-6 text-center text-sm text-muted-foreground">
            Sem dados
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Detect users who caused the most lockouts.
 * A lockout = 3+ consecutive failed logins (SessionID < 0) for the same UserCode,
 * sorted chronologically.
 */
function computeLockoutRanking(records: Usr5Record[]): RankItem[] {
  // Consider any login-related action (I, W, F) — failure detection is by SessionID < 0 OR Action === "F"
  const loginRecords = records
    .filter((r) => r.Action === "I" || r.Action === "W" || r.Action === "F" || r.Action === "K")
    .slice()
    .sort((a, b) => {
      if (a.UserCode !== b.UserCode) return a.UserCode.localeCompare(b.UserCode);
      if (a.Date !== b.Date) return a.Date.localeCompare(b.Date);
      return a.Time - b.Time;
    });

  const lockoutMap = new Map<string, number>();
  let currentUser = "";
  let consecutiveFails = 0;

  const isFail = (r: Usr5Record) => isFailedLogin(r) || r.Action === "F" || r.Action === "K";

  for (const r of loginRecords) {
    if (r.UserCode !== currentUser) {
      if (consecutiveFails >= 3 && currentUser) {
        lockoutMap.set(currentUser, (lockoutMap.get(currentUser) || 0) + 1);
      }
      currentUser = r.UserCode;
      consecutiveFails = 0;
    }

    if (isFail(r)) {
      consecutiveFails++;
    } else {
      // successful login or other action breaks the streak
      if (consecutiveFails >= 3) {
        lockoutMap.set(currentUser, (lockoutMap.get(currentUser) || 0) + 1);
      }
      consecutiveFails = 0;
    }
  }
  // Handle trailing streak (last record was a failure)
  if (consecutiveFails >= 3 && currentUser) {
    lockoutMap.set(currentUser, (lockoutMap.get(currentUser) || 0) + 1);
  }

  return Array.from(lockoutMap, ([user, value]) => ({
    user,
    value,
    formatted: `${value}x`,
  }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
}

export default function UserActivityRankings({ records }: Props) {
  const topLogins = useMemo(() => {
    const map = new Map<string, number>();
    records.forEach((r) => {
      if (r.Action === "I" || r.Action === "W") {
        if (!isFailedLogin(r)) {
          map.set(r.UserCode, (map.get(r.UserCode) || 0) + 1);
        }
      }
    });
    return Array.from(map, ([user, value]) => ({
      user,
      value,
      formatted: String(value),
    }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [records]);

  const topDuration = useMemo(() => {
    const map = new Map<string, number>();
    records.forEach((r) => {
      if (r.AliveDurtn > 0) {
        map.set(r.UserCode, (map.get(r.UserCode) || 0) + r.AliveDurtn);
      }
    });
    return Array.from(map, ([user, value]) => ({
      user,
      value,
      formatted: formatDuration(value),
    }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [records]);

  const topFailures = useMemo(() => {
    const map = new Map<string, number>();
    records.forEach((r) => {
      if (isFailedLogin(r)) {
        map.set(r.UserCode, (map.get(r.UserCode) || 0) + 1);
      }
    });
    return Array.from(map, ([user, value]) => ({
      user,
      value,
      formatted: String(value),
    }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [records]);

  const topLockouts = useMemo(() => computeLockoutRanking(records), [records]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      <RankingCard
        title="Mais Logins"
        icon={LogIn}
        items={topLogins}
        badgeClass="bg-primary/15 text-primary"
      />
      <RankingCard
        title="Maior Tempo de Sessão"
        icon={Timer}
        items={topDuration}
        badgeClass="bg-primary/15 text-primary"
      />
      <RankingCard
        title="Mais Falhas de Login"
        icon={ShieldAlert}
        items={topFailures}
        badgeClass="bg-destructive/15 text-destructive"
      />
      <RankingCard
        title="Mais Bloqueios (3 falhas)"
        icon={Lock}
        items={topLockouts}
        badgeClass="bg-destructive/15 text-destructive"
      />
    </div>
  );
}
