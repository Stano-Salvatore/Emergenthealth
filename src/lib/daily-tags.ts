// The day's tags: what was going on, in the user's own words.
//
// These feed the correlation engine's onset family — tags that were silent for
// a fortnight and then started appearing, compared against the matched stretch
// before they entered your life. That comparison keys on the tag *string*, so
// two writers with two normalisation rules do not produce one tag seen twice;
// they produce two tags, each with half the days, and both below the threshold
// that would have made either one testable.
//
// Until now there was one writer (the Check-in page) and the rule lived inside
// its route. Emergy is the second, so the rule moves here and both import it.

/** The preference key one day's tags live under. */
export function dailyTagsKey(date: string): string {
  return `daily_tags:${date}`
}

/** As many as one day can carry. The tenth is already a stretch. */
export const MAX_TAGS_PER_DAY = 10
/** Long enough for "couldn't get to sleep", short enough to stay a label. */
export const MAX_TAG_LENGTH = 30

/**
 * One tag, as it will be stored and compared. Null when there is nothing left
 * of it — an empty string would otherwise become a tag that every day shares.
 */
export function normaliseTag(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const tag = raw.trim().toLowerCase().slice(0, MAX_TAG_LENGTH)
  return tag.length > 0 ? tag : null
}

/** A whole day's worth, deduplicated and capped, in the order given. */
export function normaliseTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    const tag = normaliseTag(item)
    if (tag && !out.includes(tag)) out.push(tag)
    if (out.length >= MAX_TAGS_PER_DAY) break
  }
  return out
}

/**
 * Add tags to a day that may already have some.
 *
 * Merge, never replace. The Check-in page owns the whole array and sends it
 * whole, which is right for a screen showing every tag at once — but a second
 * writer doing the same would quietly delete whatever the first had put there.
 * Emergy adding "flu" to a day must not take "travel" off it.
 *
 * Reports what it could not fit rather than silently dropping it, so the
 * answer on screen can say so.
 */
export function mergeTags(
  existing: unknown,
  adding: unknown,
): { tags: string[]; added: string[]; alreadyThere: string[]; noRoom: string[] } {
  const tags = normaliseTags(existing)
  const added: string[] = []
  const alreadyThere: string[] = []
  const noRoom: string[] = []

  for (const item of Array.isArray(adding) ? adding : [adding]) {
    const tag = normaliseTag(item)
    if (!tag) continue
    if (tags.includes(tag)) { if (!alreadyThere.includes(tag)) alreadyThere.push(tag); continue }
    if (tags.length >= MAX_TAGS_PER_DAY) { if (!noRoom.includes(tag)) noRoom.push(tag); continue }
    tags.push(tag)
    added.push(tag)
  }
  return { tags, added, alreadyThere, noRoom }
}

/** A calendar day as this app writes them, and nothing else. */
export function isDayString(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

/**
 * How far back a tag may be backdated.
 *
 * The point of a date at all is the drift question — "your resting heart rate
 * moved in late August, what changed?" — whose answer belongs on the days it
 * describes, not on the day it was typed. A year is the longest window the
 * engine reads, so a tag older than that can never reach a card.
 */
export const MAX_BACKDATE_DAYS = 365

/**
 * Which day to write, or why not.
 *
 * Tomorrow is not a day anyone has anything to report about, and a typo in a
 * year turns a tag into one nothing will ever read again.
 */
export function resolveTagDate(
  requested: unknown,
  today: string,
): { day: string } | { error: string } {
  if (requested == null || requested === "") return { day: today }
  if (!isDayString(requested)) return { error: `"${String(requested)}" is not a date I can use — give it as YYYY-MM-DD.` }
  if (requested > today) return { error: `${requested} hasn't happened yet.` }

  const ageDays = Math.round(
    (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${requested}T12:00:00Z`)) / 86_400_000,
  )
  if (!Number.isFinite(ageDays)) return { error: `${requested} is not a date I can use.` }
  if (ageDays > MAX_BACKDATE_DAYS) {
    return { error: `${requested} is more than a year back, and nothing reads that far.` }
  }
  return { day: requested }
}
