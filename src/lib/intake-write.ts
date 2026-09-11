// The one place a drink is written.
//
// Emergy's log_water / log_coffee / log_drink and the quick-log parser all
// write the same two rows: the intake, and — for anything caffeinated — a
// caffeine entry at the SAME instant, under the deterministic `intake_<id>`
// so deleting the drink removes its caffeine. Three copies of that drifted
// once (the drinks tools logged everything as "now" long after log_dose
// learned minutesAgo); one writer cannot.
//
// It was written for the chat paths and stopped there. The Intake tab, the
// food photo analyser, the home-screen widget and the MCP tool kept their own
// copies — six in all by the time anyone counted — and they had already come
// apart in two ways:
//
//   Four of them swallowed the mirror's failure (`.catch(() => null)`), so a
//   coffee whose caffeine row failed to write was indistinguishable from a
//   coffee that never had any. Three coffees in this database have no dose
//   attached and there is no record anywhere of why.
//
//   The estimate read whatever text the note happened to carry. The widget's
//   note names the place ("the usual @ Kaviareň Vták"), which is fine until
//   someone's local is called Espresso House — `estimateCaffeine` matches
//   "espresso" in the label and rewrites every drink bought there as a shot.
//   Hence `caffeineLabel`: the estimate reads the drink, never the room.

import { prisma } from "@/lib/prisma"
import type { IntakeLog } from "@prisma/client"
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
   * A deterministic id, for a drink that belongs to something else and must
   * disappear with it — the drinks a meal photo mirrors, keyed to the meal.
   */
  id?: string
  /**
   * What the caffeine estimate should read, when the note says more than the
   * drink does. Defaults to the note. Pass "" to have it read nothing.
   */
  caffeineLabel?: string
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
  /** The row as written, so a caller can return it without reading it back. */
  log: IntakeLog
  /**
   * Caffeine was due and its row could not be written. The drink is saved
   * either way — but the dose is missing from body load and from every
   * pattern downstream, and a caller with a sentence to say should say so.
   */
  caffeineMirrorFailed?: true
}

type CaffeineInput = Pick<DrinkWrite, "type" | "note" | "amountMl" | "caffeineLabel" | "caffeineMg">

/** What caffeine a drink carries: the caller's own figure, or the app's estimate. */
function caffeineFor(w: CaffeineInput): { caffeineMg: number | null; compound: string | null } {
  if (w.caffeineMg === undefined) {
    // `??` and not `||`: an explicit empty label means "read nothing", which is
    // not the same as "fall back to the note".
    const est = estimateCaffeine(w.type, w.caffeineLabel ?? w.note ?? "", w.amountMl)
    return est ? { caffeineMg: est.mg, compound: est.compound } : { caffeineMg: null, compound: null }
  }
  return w.caffeineMg != null && w.caffeineMg > 0
    ? { caffeineMg: w.caffeineMg, compound: w.type }
    : { caffeineMg: null, compound: null }
}

/**
 * The id of the caffeine row belonging to a drink.
 *
 * One function rather than a `intake_${id}` template written at each site: the
 * meal path composes it twice over (a drink is `food_<meal>_<n>`, so its
 * caffeine is `intake_food_<meal>_<n>`), and the delete that cleans up after a
 * meal has to reproduce that by hand. Two places agreeing on a string is how
 * an orphan gets left behind.
 */
export const caffeineIdFor = (intakeId: string) => `intake_${intakeId}`

/** Drop the caffeine that came with a drink. False = it may still be there. */
export async function forgetDrinkCaffeine(userId: string, where: { intakeId?: string; idPrefix?: string }): Promise<boolean> {
  const id = where.intakeId
    ? { id: caffeineIdFor(where.intakeId) }
    : { id: { startsWith: caffeineIdFor(where.idPrefix ?? "") } }
  const gone = await prisma.caffeineLog.deleteMany({ where: { userId, ...id } })
    .catch((e: unknown) => {
      // An orphan is worse than a missing dose: the app goes on reporting
      // caffeine that was deleted, in body load and at the bedtime cutoff.
      console.error("[intake] caffeine cleanup failed for", where, e)
      return null
    })
  return gone != null
}

/** Write (or replace) the caffeine row tied to a drink. False = it was due and isn't there. */
async function mirrorCaffeine(
  intakeId: string, userId: string, compound: string, caffeineMg: number, at: Date,
): Promise<boolean> {
  const id = caffeineIdFor(intakeId)
  const row = await prisma.caffeineLog.upsert({
    where: { id },
    create: { id, userId, compound, caffeineMg, loggedAt: at },
    update: { compound, caffeineMg, loggedAt: at },
  }).catch((e: unknown) => {
    // Never swallowed. A drink that silently doesn't mirror looks to the user
    // exactly like a drink with no caffeine in it.
    console.error("[intake] caffeine mirror failed for", intakeId, e)
    return null
  })
  return row != null
}

export async function recordDrink(w: DrinkWrite): Promise<DrinkWritten | null> {
  const at = w.at ?? new Date()
  const log = await prisma.intakeLog.create({
    data: {
      ...(w.id ? { id: w.id } : {}),
      userId: w.userId,
      type: w.type,
      amountMl: w.amountMl,
      note: w.note ?? null,
      loggedAt: at,
    },
  }).catch((e: unknown) => {
    console.error("[intake] drink write failed:", w.type, w.amountMl, e)
    return null
  })
  if (!log) return null

  const { caffeineMg, compound } = caffeineFor(w)
  const failed = caffeineMg != null && compound != null
    && !(await mirrorCaffeine(log.id, w.userId, compound, caffeineMg, at))

  return {
    id: log.id,
    loggedAt: at,
    caffeineMg,
    compound,
    log,
    ...(failed ? { caffeineMirrorFailed: true as const } : {}),
  }
}

/**
 * Bring a drink's caffeine row back in line after the drink itself changed.
 *
 * An edit can add caffeine (water → coffee), change it (250ml → 500ml) or
 * remove it (coffee → water), so all three have to be handled — and the
 * original time is kept, because the dose is read as a decay curve against
 * bedtime and moving it would rewrite the night.
 */
export async function resyncDrinkCaffeine(log: IntakeLog): Promise<boolean> {
  const { caffeineMg, compound } = caffeineFor({
    type: log.type, note: log.note, amountMl: log.amountMl,
  })
  if (caffeineMg == null || compound == null) {
    return forgetDrinkCaffeine(log.userId, { intakeId: log.id })
  }
  return mirrorCaffeine(log.id, log.userId, compound, caffeineMg, log.loggedAt)
}
