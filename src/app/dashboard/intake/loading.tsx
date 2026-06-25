import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="space-y-5 max-w-2xl">
      {/* header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-4 w-36" />
        </div>
        <div className="flex items-center gap-1">
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
      </div>

      {/* summary cards */}
      <div className="grid gap-3 grid-cols-2">
        {[1, 2].map(i => (
          <div key={i} className="rounded-2xl border border-border bg-card p-3 text-center space-y-1">
            <Skeleton className="h-8 w-8 rounded-full mx-auto" />
            <Skeleton className="h-6 w-16 mx-auto" />
            <Skeleton className="h-3 w-12 mx-auto" />
            <Skeleton className="h-1 w-full rounded-full" />
          </div>
        ))}
      </div>

      {/* 7-day trend */}
      <div className="space-y-2">
        <Skeleton className="h-3 w-28" />
        <div className="flex items-end gap-1.5 h-16">
          {[1, 2, 3, 4, 5, 6, 7].map((_, i) => (
            <Skeleton key={i} className="flex-1 rounded-t-sm" style={{ height: `${30 + (i % 4) * 12}%` }} />
          ))}
        </div>
      </div>

      {/* quick add buttons row */}
      <div className="space-y-2">
        <Skeleton className="h-3 w-20" />
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <Skeleton key={i} className="h-9 w-28 rounded-lg" />
          ))}
        </div>
      </div>

      {/* history list */}
      <div className="space-y-2">
        <Skeleton className="h-3 w-16" />
        {[1, 2, 3, 4].map(i => (
          <Skeleton key={i} className="h-12 w-full rounded-xl" />
        ))}
      </div>
    </div>
  )
}
