import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="space-y-6">
      {/* header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="space-y-1">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-36" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-24 rounded-md" />
          <Skeleton className="h-9 w-20 rounded-md" />
          <Skeleton className="h-9 w-20 rounded-md" />
        </div>
      </div>

      {/* two stats tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="rounded-2xl border border-border bg-card p-6 space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-8 w-24" />
          </div>
        ))}
      </div>

      {/* 6-month spending trend chart */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-44 w-full rounded-xl" />
      </div>

      {/* category breakdown + transaction list */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <Skeleton className="h-5 w-44" />
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="space-y-1">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-16" />
              </div>
              <Skeleton className="h-1.5 w-full rounded-full" />
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <Skeleton className="h-5 w-32" />
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="flex items-center gap-2 py-2 border-b border-border last:border-0">
              <Skeleton className="h-6 w-6 rounded-sm shrink-0" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <Skeleton className="h-3.5 w-16 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
