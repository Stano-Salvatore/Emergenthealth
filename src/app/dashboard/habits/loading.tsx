import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-9 w-28" />
      </div>
      {/* streak summary chips */}
      <div className="flex gap-2">
        <Skeleton className="h-7 w-24 rounded-full" />
        <Skeleton className="h-7 w-28 rounded-full" />
        <Skeleton className="h-7 w-20 rounded-full" />
      </div>
      {/* habit cards */}
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-8 w-8 rounded-full" />
          </div>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5, 6, 7].map(j => <Skeleton key={j} className="h-8 w-8 rounded-lg flex-1" />)}
          </div>
        </div>
      ))}
    </div>
  )
}
