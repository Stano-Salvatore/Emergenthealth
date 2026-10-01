// The bars that decide when a pattern can be shown and when it can be
// trusted, and the sentences that state them to the user.
//
// They live here rather than in correlations.ts because the onboarding, the
// Insights page and the dashboard panel all quote them, and those run in the
// browser — where the engine, which imports the database client, must not.
// The engine reads the same constants, so a sentence written from them stays
// true when a bar moves.

/**
 * A comparison is only tested once each side has at least this many days —
 * compareGroups' default, which nearly every family runs on. Combinations ask
 * for more.
 */
export const MIN_GROUP_DAYS = 5

/**
 * A side with this many days counts as enough. Below it, a weak card says it
 * needs more days rather than a bigger difference (lib/insight-weakness).
 */
export const CONFIDENT_N = 10

/**
 * The windows a user can ask for.
 *
 * "year" exists because 90 days cannot see a season. A Samsung Health export
 * goes back years and all of it is stored, but the longest window on offer was
 * a quarter — so "am I worse in winter", the question a year of data is for,
 * could not be asked at all. The engine is window-agnostic; only this list
 * decided how far it was allowed to look.
 */
export const PERIOD_DAYS: Record<string, number> = { week: 7, month: 30, overall: 90, year: 365 }

/** The earliest day a comparison can be tested: both sides at the minimum. */
export const EARLIEST_TEST_DAY = 2 * MIN_GROUP_DAYS

/** The earliest day both sides can be at the confident size. */
export const EARLIEST_CONFIDENT_DAY = 2 * CONFIDENT_N

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

/**
 * Why a window has no comparison to show, in days.
 *
 * `days` is how many days in the window have any data at all (the engine's
 * totalDays), or null when that is not known; `windowDays` is the window that
 * was asked for. Three different answers, because "keep logging" is only true
 * of one of them — a 7-day window cannot hold five days a side however much
 * is logged in it.
 */
export function noPatternsYet(days: number | null, windowDays: number): string {
  if (windowDays < EARLIEST_TEST_DAY) {
    return `${plural(windowDays, "day")} is too short for a comparison, which needs ${MIN_GROUP_DAYS} days on each side. The longer views have room for one.`
  }
  if (days != null && days < EARLIEST_TEST_DAY) {
    const sofar = days === 0 ? "No days of data yet" : `${plural(days, "day")} of data so far`
    return `${sofar}. A comparison needs ${MIN_GROUP_DAYS} days with something and ${MIN_GROUP_DAYS} without, so day ${EARLIEST_TEST_DAY} is the earliest one can appear.`
  }
  return `No comparison has ${MIN_GROUP_DAYS} days on each side in this window yet.`
}
