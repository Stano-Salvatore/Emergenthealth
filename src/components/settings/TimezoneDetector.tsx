"use client"

import { Globe } from "lucide-react"
import { useClientValue } from "@/lib/use-client-value"

function deviceTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

// Pure display. TimezoneSync (mounted in the dashboard layout) owns keeping
// the stored timezone converged to the device's — this component used to be a
// second writer with different rules, and it showed the *stored* value, which
// after travel could be the old zone while TimezoneSync had already moved on.
// The device zone is what the server ends up holding, so show that.
export function TimezoneDetector() {
  const tz = useClientValue(deviceTimezone, null)

  if (!tz) return null

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Globe className="h-3.5 w-3.5 shrink-0" />
      <span>Notification timezone: <strong className="text-foreground">{tz}</strong></span>
    </div>
  )
}
