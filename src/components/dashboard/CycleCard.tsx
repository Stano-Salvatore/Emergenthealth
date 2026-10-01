// The cycle on the home page — only on the days it matters: period days
// ("Period · day 2"), the two days before, a late period, and the pill's
// break week. Every other day it renders nothing and the home page is as it
// was. Off entirely unless cycle tracking is on.

import Link from "next/link"
import { ChevronRight } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { loadCycle } from "@/lib/cycle-load"
import { homeCycleNote } from "@/lib/cycle-text"
import { cn } from "@/lib/utils"

const TONE: Record<"period" | "soon" | "late" | "pack", string> = {
  period: "border-rose-500/40 bg-rose-500/5",
  soon: "border-rose-400/30 bg-rose-400/5",
  late: "border-amber-500/30 bg-amber-500/5",
  pack: "border-border",
}

export async function CycleCard({ userId }: { userId: string }) {
  let note
  try {
    const load = await loadCycle(userId)
    note = homeCycleNote(load.today, load.settings)
  } catch {
    return null
  }
  if (!note) return null

  return (
    <Link href="/dashboard/cycle" className="block">
      <Card className={cn("transition-colors hover:bg-muted/30", TONE[note.tone])}>
        <CardContent className="py-3 flex items-start gap-3">
          <span className="text-xl leading-none mt-0.5" aria-hidden>🌸</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">{note.title}</p>
            {note.detail && <p className="text-xs text-muted-foreground mt-0.5">{note.detail}</p>}
            {note.tip && <p className="text-xs mt-1">{note.tip}</p>}
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        </CardContent>
      </Card>
    </Link>
  )
}
