// The one place a drink is written.
//
// Emergy's log_water / log_coffee / log_drink and the quick-log parser all
// write the same two rows: the intake, and — for anything caffeinated — a
// caffeine entry at the SAME instant, under the deterministic `intake_<id>`
// so deleting the drink removes its caffeine. Three copies of that drifted
// once (the drinks tools logged everything as "now" long after log_dose
// learned minutesAgo); one writer cannot.

import { prisma } from "@/lib/prisma"
import { estimateCaffeine } from "@/lib/caffeine"

export interface DrinkWrite {
  userId: string
  /** An IntakeLog type — water, coffee, beer, … */
  type: string
  amountMl: number
  note?: string | null
  /** When it was had. Defaults to now. */
  at?: Date
  /**
   * A caffeine figure the caller already has (the model's estimate for a
   * branded drink). Omitted, the app estimates from type and label; 0 means
   * "none", and nothing is mirrored.
   */
  caffeineMg?: number | null
}

export interface DrinkWritten {
  id: string
  loggedAt: Date
  /** What went into the caffeine log, if anything. */
  caffeineMg: number | null
  compound: string | null
}

export async function recordDrink(w: DrinkWrite): Promise<DrinkWritten | null> {
  const at = w.at ?? new Date()
  const log = await prisma.intakeLog.create({
    data: { userId: w.userId, type: w.type, amountMl: w.amountMl, note: w.note ?? null, loggedAt: at },
  }).catch(() => null)
  if (!log) return null

  let caffeineMg: number | null = null
  let compound: string | null = null
  if (w.caffeineMg === undefined) {
    const est = estimateCaffeine(w.type, w.note ?? "", w.amountMl)
    if (est) { caffeineMg = est.mg; compound = est.compound }
  } else if (w.caffeineMg != null && w.caffeineMg > 0) {
    caffeineMg = w.caffeineMg
    compound = w.type
  }

  if (caffeineMg && compound) {
    await prisma.caffeineLog.create({
      data: { id: `intake_${log.id}`, userId: w.userId, compound, caffeineMg, loggedAt: at },
    }).catch(() => null)
  }
  return { id: log.id, loggedAt: at, caffeineMg, compound }
}
