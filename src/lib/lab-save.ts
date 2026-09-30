// The one place lab results are written in bulk: Emergy's log_lab_results
// tool and the import card's save both come through here.
//
// The marker is canonicalised on the server whatever the caller sent. A name
// the model copied "as printed", or one the user retyped in the import card,
// otherwise starts a series of its own — and the dedupe below, which keys on
// the marker, misses the same report imported a second way.

import { prisma } from "@/lib/prisma"
import { canonicalMarker } from "@/lib/lab-markers"

export interface LabRowIn {
  marker: string
  value: number
  unit: string
  referenceMin: number | null
  referenceMax: number | null
  notes: string | null
}

/**
 * Save rows for one draw date (YYYY-MM-DD). Re-recording the same
 * marker/date/value is skipped rather than doubled, so a retry is safe.
 * Returns the rows actually written, under the names they were written as.
 */
export async function saveLabRows(
  userId: string,
  date: string,
  rowsIn: LabRowIn[],
): Promise<{ saved: LabRowIn[]; skipped: number }> {
  const rows = rowsIn
    .map(r => ({ ...r, marker: canonicalMarker(r.marker).slice(0, 80) }))
    .filter(r => r.marker)
  if (rows.length === 0) return { saved: [], skipped: 0 }

  const when = new Date(date + "T00:00:00.000Z")
  const existing = await prisma.labResult.findMany({
    where: { userId, date: when, marker: { in: rows.map(r => r.marker) } },
    select: { marker: true, value: true },
  })
  const seen = new Set(existing.map(e => `${e.marker}|${e.value}`))
  const fresh = rows.filter(r => !seen.has(`${r.marker}|${r.value}`))

  if (fresh.length > 0) {
    await prisma.labResult.createMany({
      data: fresh.map(r => ({ ...r, userId, date: when })),
    })
  }
  return { saved: fresh, skipped: rows.length - fresh.length }
}
