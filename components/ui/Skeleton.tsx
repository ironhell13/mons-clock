export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: rows }).map((_, rIdx) => (
        <div key={rIdx} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: cols }).map((__, cIdx) => (
            <div key={cIdx} className="h-6 rounded-lg bg-primary-100/70 animate-pulse" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="rounded-2xl bg-surface border border-border-sky p-5 animate-pulse space-y-3">
      <div className="h-4 w-24 rounded bg-primary-100" />
      <div className="h-8 w-16 rounded bg-primary-100" />
    </div>
  );
}

