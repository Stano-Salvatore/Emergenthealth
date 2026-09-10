// The one place a manual dose is written.
//
// A dose lives in OuraTag alongside the ring's own tags, marked `manual`, so
// the engine, the meds page and the schedule adherence all read one table.
// Emergy's log_dose and the quick-log parser both come through here.

import { prisma } from "@/lib/prisma"
import { randomUUID } from "crypto"
import { localDateStr } from "@/lib/local-date"
import type { DoseUnit } from "@/lib/dose"

export interface DoseWrite {
  userId: string
  timezone: string
  /** The substance alone — "Atarax", never "Atarax 25mg". */
  name: string
  dose: { amount: number; unit: DoseUnit } | null
  /** When it was taken. Defaults to now. */
  at?: Date
}

export async function recordDose(w: DoseWrite): Promise<boolean> {
  const at = w.at ?? new Date()
  const wrote = await prisma.$executeRaw`
    INSERT INTO "OuraTag" ("id","userId","day","timestamp","tagName","text","tags","doseAmount","doseUnit")
    VALUES (${`manual_${randomUUID()}`}, ${w.userId}, ${localDateStr(w.timezone, at)}, ${at}, ${w.name}, ${null}, ARRAY['manual']::text[], ${w.dose?.amount ?? null}, ${w.dose?.unit ?? null})
  `.catch(() => 0)
  return wrote > 0
}
