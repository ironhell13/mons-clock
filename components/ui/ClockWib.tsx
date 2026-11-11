'use client';

import { useEffect, useState } from 'react';
import { formatWibDateFull, formatWibTimeSeconds } from '@/lib/time';

interface ClockWibProps {
  compact?: boolean;
}

export function ClockWib({ compact = false }: ClockWibProps) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!now) {
    return (
      <div className={compact ? 'text-xs text-ink-muted' : 'text-right'}>
        <div className="h-5 w-36 rounded bg-primary-100/70 animate-pulse" />
      </div>
    );
  }

  if (compact) {
    return (
      <div className="inline-flex items-center gap-2 rounded-xl bg-page border border-border-sky px-3 py-1.5 text-xs font-semibold text-ink">
        <span>{formatWibDateFull(now)}</span>
        <span className="text-primary-700 font-bold tabular-nums">{formatWibTimeSeconds(now)}</span>
      </div>
    );
  }

  return (
    <div className="text-right leading-tight">
      <div className="text-2xl lg:text-3xl font-extrabold text-primary-700 tabular-nums tracking-tight">
        {formatWibTimeSeconds(now)}
      </div>
      <div className="text-sm font-medium text-ink-muted mt-0.5">{formatWibDateFull(now)}</div>
    </div>
  );
}

