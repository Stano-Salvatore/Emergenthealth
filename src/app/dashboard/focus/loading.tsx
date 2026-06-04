import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="space-y-6 max-w-xl mx-auto">
      {/* header */}
      <div className="space-y-1">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-4 w-48" />
      </div>

      {/* stats strip */}
      <div className="grid grid-cols-3 gap-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="rounded-2xl border border-border bg-card p-3 text-center space-y-1">
            <Skeleton className="h-7 w-7 rounded-full mx-auto" />
            <Skeleton className="h-6 w-12 mx-auto" />
            <Skeleton className="h-3 w-20 mx-auto" />
          </div>
        ))}
      </div>

      {/* timer card */}
      <div className="rounded-2xl border border-border bg-card p-6 space-y-5">
        {/* mode selector */}
        <div className="flex gap-2 justify-center">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-9 w-28 rounded-lg" />
          ))}
        </div>

        {/* duration pickers */}
        <div className="space-y-2 px-2">
          <div className="flex items-center gap-3">
            <Skeleton className="h-4 w-12 shrink-0" />
            <div className="flex gap-1.5">
              <Skeleton className="h-7 w-12 rounded-md" />
              <Skeleton className="h-7 w-12 rounded-md" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="h-4 w-12 shrink-0" />
            <div className="flex gap-1.5">
              <Skeleton className="h-7 w-12 rounded-md" />
              <Skeleton className="h-7 w-12 rounded-md" />
              <Skeleton className="h-7 w-12 rounded-md" />
            </div>
          </div>
        </div>

        {/* circular timer area */}
        <div className="flex justify-center">
          <Skeleton className="h-[200px] w-[200px] rounded-full" />
        </div>

        {/* label input */}
        <Skeleton className="h-9 w-full rounded-md mx-4" style={{ width: "calc(100% - 2rem)" }} />

        {/* start button */}
        <div className="flex justify-center">
          <Skeleton className="h-10 w-32 rounded-md" />
        </div>
      </div>

      {/* session list */}
      <div className="space-y-2">
        <Skeleton className="h-3 w-28" />
        {[1, 2, 3].map(i => (
          <Skeleton key={i} className="h-12 w-full rounded-xl" />
        ))}
      </div>
    </div>
  )
}
