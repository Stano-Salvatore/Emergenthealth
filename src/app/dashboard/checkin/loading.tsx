import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="flex flex-col items-center px-4 pt-6 pb-10">
      <div className="w-full max-w-sm space-y-6">
        {/* progress bar */}
        <div className="space-y-2">
          <div className="flex justify-between">
            {[1, 2, 3, 4].map(i => (
              <Skeleton key={i} className="h-2.5 w-12" />
            ))}
          </div>
          <Skeleton className="h-1 w-full rounded-full" />
        </div>

        {/* check-in card */}
        <div className="rounded-2xl border border-border bg-card p-6 space-y-6">
          <Skeleton className="h-7 w-48 mx-auto" />
          <div className="grid grid-cols-5 gap-2">
            {[1, 2, 3, 4, 5].map(i => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
