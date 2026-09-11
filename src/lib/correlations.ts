import { prisma } from "@/lib/prisma"
import { subDays, format } from "date-fns"
import { classifyOuraTag } from "@/lib/oura-tag-classify"
import { normalizeSupplement, cleanLabel } from "@/lib/supplement-normalize"
import { supplementInfoFor } from "@/lib/supplement-info"
import { hydrationMl, HYDRATING_TYPES } from "@/lib/hydration"
import { getGoals } from "@/lib/goals"
import { computeTargets } from "@/lib/targets"
import { estimateHome, summariseDays, AWAY_KM } from "@/lib/day-location"
import { loadCoarsePoints } from "@/lib/day-location-load"
import { bedtimeMinutesLate } from "@/lib/caffeine-cutoff"
import { ALCOHOL_TYPES, ethanolGrams } from "@/lib/body-load"

// Shared correlation engine, used by both the /api/insights/correlations route
// (interactive dashboard) and the correlation-watch cron (pin & watch alerts).

type DayData = {
  date: string
  sleepScore?: number
  sleepDuration?: number // hours
  /** Minutes from lights-out to asleep. Stored for months and never read until now. */
  sleepLatencyMin?: number
  /** Share of time in bed actually asleep, 0-100. */
  sleepEfficiency?: number
  /** Local minutes past midnight the night began — 23:08 is 1388, 01:20 is 80 + 1440. */
  bedtimeMin?: number
  readiness?: number
  restingHR?: number
  stressHighMin?: number
  hrv?: number
  steps?: number
  activityScore?: number
  screenTimeMin?: number
  firstUnlockMin?: number
  energy?: number
  mood?: number
  habitCount?: number
  caffeineMg?: number
  /** The part of the day's caffeine taken after 16:00 — the dose the night still has to clear. */
  lateCaffeineMg?: number
  /**
   * Grams of ethanol, which is the only number that means anything.
   *
   * The volume is deliberately not kept. Beer and wine already reach this
   * engine as fluid through HYDRATING_TYPES, discounted 0.8 and 0.4; a second
   * millilitre figure here had no reader once every threshold moved to grams,
   * and a field that is written and never read is how sleep latency sat in the
   * database for months.
   *
   * 300ml of beer and 300ml of wine are the same millilitres and not the same
   * evening. Every threshold in this file is in grams for that reason, and the
   * per-drink ABV comes from the note where the log carries one ("Beer 4.8%")
   * and from the type where it does not.
   */
  alcoholG?: number
  /**
   * Names of places checked into on this day, accent-folded (see foldPlace).
   * A visit is a fact about the day the same way a coffee is.
   */
  places?: string[]
  /**
   * The user wrote something down today — a drink, a meal, a mood, a check-in.
   *
   * Absence of a caffeine log is not evidence of no caffeine unless the diary
   * was open. On this account 26 days have caffeine, 6 have something else
   * logged and no caffeine, and 58 have nothing at all: read as zeroes, those
   * 58 turn "coffee vs no coffee" into "days I used the app vs days I didn't".
   */
  logged?: boolean
  tags?: string[]
  precipMm?: number
  tempMaxC?: number
  weatherCode?: number
  eventCount?: number      // calendar events on this day
  eventTitles?: string[]   // their titles (for per-activity discovery)
  waterMl?: number         // total fluid, weighted by type (see lib/hydration)
  calories?: number        // meals logged on the Food tab
  proteinG?: number
  sugarG?: number
  lastMealMin?: number     // minutes after local midnight of the day's last meal
  supplements?: string[]   // normalized supplement names taken (Oura tags)
  symptoms?: Record<string, number> // symptom name -> worst severity that day (1-5)
  custom?: Record<string, number>   // custom tracker values by metric id (logged days only)
  deepSleepMin?: number    // sleep architecture (Oura)
  remSleepMin?: number
  /** Times the night was disturbed enough for the ring to call it restless. */
  restlessPeriods?: number
  workoutMin?: number      // Strava moving time that day
  focusMin?: number        // completed focus-session minutes
  listeningMin?: number    // Last.fm music listening (estimated: tracks × 3min)
  lateTracks?: number      // scrobbles between 22:00 and 04:00 local
  musicGenre?: string      // majority genre of the day's plays (top artist on old rows)
  spendEur?: number        // card spending (outgoing, transfers excluded)
  uvIndex?: number
  fastH?: number           // longest completed fast ending this day
  presence?: "home" | "local" | "away" // coarse GPS day-fact (lib/day-location)
  sleptAway?: boolean      // where the night ENDING this morning was spent
  walkMin?: number         // minutes recognised as walking (ActivitySpan); 0 on tracked days
  productiveH?: number     // RescueTime productive hours
  distractingH?: number    // RescueTime distracting hours
  systolic?: number        // blood pressure — the day's average systolic
  weightKg?: number        // a weigh-in recorded on this day (BodyMeasurement)
  waistCm?: number
}

export type InsightResult = {
  id: string
  category: "sleep" | "stress" | "habits" | "caffeine" | "recovery" | "screen" | "tags" | "calendar" | "food" | "supplements" | "interactions" | "symptoms" | "fitness" | "music" | "money" | "focus" | "fasting" | "custom" | "places" | "work" | "heart" | "week" | "consistency" | "streaks" | "absence" | "body"
  emoji: string
  title: string
  finding: string
  delta: number
  highGroupLabel: string
  lowGroupLabel: string
  highGroupAvg: number
  lowGroupAvg: number
  highGroupN: number
  lowGroupN: number
  confident: boolean
  /** Permutation-test p-value: how often random group shuffles produce a difference this large. */
  pValue: number
  /**
   * Trust tier after Benjamini-Hochberg false-discovery control across the
   * whole run: "strong" survives FDR at q=0.10, "suggestive" has raw p ≤ 0.10,
   * "noise" is indistinguishable from chance. With ~70 candidate insights,
   * several will always look interesting by luck — this is what separates them.
   */
  tier: "strong" | "suggestive" | "noise"
  /**
   * Which false-discovery family this insight is judged inside.
   *
   * Unset means the main battery, where every test competes with every other
   * — the right default, and the reason a single interesting finding among
   * ninety-seven does not get to call itself strong.
   *
   * A pool is only granted where the test was pre-registered BEHIND a
   * gatekeeper: the sleep panel asks one question per cause first, in the main
   * battery, and only opens the six-aspect breakdown if that question is
   * answered. Six tests you were licensed to run are a smaller family than
   * ninety-seven you might have, and the bar moves with it — 0.10/97 versus
   * 0.10/6 at rank one. Without this, a cause with a real effect on latency
   * is rejected for the sole reason that the engine also asked about music.
   */
  pool?: string
  /**
   * Set where the comparison rests on days the user may simply not have logged.
   * Rendered as a caveat, never silently absorbed into the delta.
   */
  coverage?: string
  /**
   * The two groups differ in something else large enough to explain the gap.
   *
   * Same purpose as weekendDriven, said as a sentence rather than a flag,
   * because the confounder here is continuous: on this account the nights
   * after caffeine-past-four begin at 02:43 and the nights after an early cup
   * at 00:17. Two and a half hours of bedtime is a bigger lever on a sleep
   * score than the coffee is, and a card that reports the coffee without
   * saying so is telling the truth and misleading anyway.
   */
  confounded?: string
  /** True when the effect collapses or flips once weekends are excluded — the classic confounder. */
  weekendDriven?: boolean
  /** The same comparison on weekdays only — set alongside weekendDriven so the
   * card can show HOW MUCH of the effect was the weekend, not just that some was. */
  weekdayDelta?: number
}

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

/**
 * Bump when the insight battery gains or loses sources, or when a group
 * definition moves — a cached card carries the label it was computed with,
 * so a stale run would advertise a threshold the engine no longer applies.
 * Cached runs stamped with an older version are recomputed on the next read
 * instead of served, so the change appears immediately rather than after the
 * cache TTL happens to expire.
 */
export const ENGINE_VERSION = 14

/**
 * Both sides need this many days before a card is called confident.
 *
 * `insight-weakness.ts` used to declare its own copy of this number and write
 * sentences about it. Two constants meaning one thing is how a card comes to
 * say "under 10 days a side" while the engine has moved to a different bar.
 */
export const CONFIDENT_N = 10

function avg(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function r1(n: number): number {
  return Math.round(n * 10) / 10
}

function nextDateStr(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z")
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * A day-level source split into "high" and "low", and whether the cut came
 * from the user or from a textbook.
 */
type Cut = { at: number; personal: boolean }

/**
 * A cut needs this many days behind it before a personal median is trusted
 * over a fixed one, and this share of them on its thinner side before the
 * fixed one is trusted at all.
 */
const CUT_MIN_DAYS = 20
const CUT_MIN_SIDE = 0.25

/**
 * Where to cut a source into high and low days.
 *
 * Some thresholds in this engine are borrowed from physiology rather than
 * from the data: 200mg of caffeine, 25°C, an hour of high stress. While days
 * fall on both sides of one, it is the better cut — it means something
 * outside this dataset, and the card can say so.
 *
 * What it cannot survive is a climate or a habit it wasn't written for. In a
 * Central European year, "25°C+" picks out seven days against fifty-seven;
 * that isn't a comparison, it's an average of seven numbers, and no effect
 * however real clears a permutation test from a group that size. The same
 * borrowed number that carries meaning for one person quietly deletes the
 * family for the next.
 *
 * So: keep the borrowed number while it splits the days somewhere near the
 * middle, and fall back to the person's own median when it doesn't. Either
 * way the label prints the number actually used, so a card never claims a
 * threshold it didn't apply.
 */
export function balancedCut(raw: (number | undefined)[], fixed: number): Cut {
  const vals = raw.filter((v): v is number => v != null)
  const fixedCut: Cut = { at: fixed, personal: false }
  if (vals.length < CUT_MIN_DAYS) return fixedCut

  const thinnerSide = (cut: number): number => {
    const high = vals.filter(v => v >= cut).length
    return Math.min(high, vals.length - high)
  }
  if (thinnerSide(fixed) >= Math.max(8, vals.length * CUT_MIN_SIDE)) return fixedCut

  const sorted = [...vals].sort((a, b) => a - b)
  const mid = median(sorted)
  // A median sitting on the floor of the distribution — the zero-caffeine
  // days outnumbering the rest — splits nothing, because every value is
  // ">= mid". Step up to the next distinct value so both sides have days.
  const cut = mid > sorted[0] ? mid : sorted.find(v => v > sorted[0])
  // Falling back to a median that is itself lopsided buys nothing, and costs
  // the borrowed number's meaning. Keep the textbook.
  if (cut == null || thinnerSide(cut) < 5) return fixedCut
  return { at: cut, personal: true }
}

/**
 * One standard drink, in grams of ethanol — the line between "had a drink"
 * and "had a sip of someone else's".
 *
 * It replaces a 50 ml volume threshold that meant nothing: fifty millilitres
 * is two grams of ethanol in beer and five in wine, so the same number was
 * two different questions depending on what was in the glass. Ten grams is
 * the WHO/NIAAA standard-drink figure, give or take the country, and it is
 * roughly a 250 ml glass of 5% beer.
 */
const STANDARD_DRINK_G = 10

/**
 * How that threshold is written on a card, kept beside the number so the two
 * cannot drift — which they did: the split moved to grams and four cards went
 * on printing "(50ml+)", a figure the engine had stopped applying. The rule is
 * already written down next to balancedCut, and it was broken here: a card
 * never claims a threshold it did not use.
 *
 * "1+ drink" rather than "10g+", because grams of ethanol is the right unit to
 * reason in and the wrong one to read.
 */
const DRINKING_DAYS_LABEL = "drinking days (1+ drink)"

/**
 * After this o'clock, local, a dose still has most of its work to do by
 * bedtime. Sixteen hundred is the number the Caffeine page already quotes.
 */
const LATE_CAFFEINE_MIN = 16 * 60

/**
 * One café, one key. Accents, case and stray punctuation are the difference
 * between "Kaviareň Vták" and "Kaviaren Vtak", and nothing else is.
 */
export function foldPlace(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/**
 * A day needs this many genre-tagged plays before a majority means anything.
 * Two plays cannot outvote each other into a label worth grouping days by.
 */
const MIN_TAGGED_PLAYS = 3

/**
 * The genre of a day, from the share of its plays.
 *
 * The old label was the genre of the day's single top artist — and on a real
 * year of listening, 118 days were owned by 44 artists, 28 of them exactly
 * once. A 3-track day was labelled by an act with 2 plays; a day of 20 folk
 * songs topped by one untagged obscurity got no label at all. Groups of 6
 * and 9 days came out of that, and no permutation test clears groups that
 * size however real the effect.
 *
 * A genre earns the day only by holding a MAJORITY of its tagged plays.
 * Deliberately not a plurality: "mostly folk" is a claim about the day;
 * "folk, narrowly, out of five genres" is a claim about the tie-break. A day
 * with full counts and no majority gets NO label — falling back to the top
 * artist there would reintroduce the fragile label exactly where the data
 * says it isn't representative. The fallback exists only for rows written
 * before per-artist counts did.
 */
export function dominantGenre(
  plays: Record<string, unknown> | null | undefined,
  genreByArtist: Map<string, string>,
): string | null {
  if (!plays || typeof plays !== "object") return null
  const byGenre = new Map<string, number>()
  let tagged = 0
  for (const [artist, raw] of Object.entries(plays)) {
    const count = Number(raw)
    if (!Number.isFinite(count) || count <= 0) continue
    const genre = genreByArtist.get(artist.toLowerCase())
    if (!genre) continue
    tagged += count
    byGenre.set(genre, (byGenre.get(genre) ?? 0) + count)
  }
  if (tagged < MIN_TAGGED_PLAYS) return null
  for (const [genre, count] of byGenre) {
    if (count * 2 > tagged) return genre
  }
  return null
}

// Deterministic RNG (mulberry32) so permutation p-values are reproducible in
// tests and stable across the two engine passes (all days / weekdays only).
function seededRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const PERMUTATIONS = 1000

// Off during the weekday-only guard pass (see the end of computeCorrelations):
// that pass exists for its deltas alone, and 1000 shuffles per family for
// p-values nobody reads was most of the engine's run time.
let permutationsOn = true

/**
 * A family's observations in DAY ORDER — the order is the point. Every family
 * used to collect two bare arrays, which threw away how high and low days
 * interleave in time; the block permutation test below needs that interleaving
 * back, so families now collect one sequence and the split is derived.
 */
export class Split {
  readonly obs: { v: number; hi: boolean }[] = []
  add(hi: boolean, v: number): void {
    this.obs.push({ v, hi })
  }
  get high(): number[] {
    return this.obs.filter(o => o.hi).map(o => o.v)
  }
  get low(): number[] {
    return this.obs.filter(o => !o.hi).map(o => o.v)
  }
}

/**
 * How long a block to hold together, given n observations. Longer blocks
 * respect longer-range autocorrelation; more blocks give the null
 * distribution enough distinct arrangements for small p-values to exist at
 * all — with 3 blocks there are six orderings and nothing under ~0.17 is
 * reachable. n/12 keeps at least ~12 blocks; 7 is enough for the
 * correlation lengths daily physiology shows; 3 is the floor below which a
 * "block" stops meaning anything.
 */
function blockLength(n: number): number {
  return Math.max(3, Math.min(7, Math.floor(n / 12)))
}

/**
 * Block permutation: shuffle week-scale runs of days, not days.
 *
 * The plain shuffle below assumes days are exchangeable, and they aren't —
 * heat comes in waves, stress in weeks, HRV carries yesterday inside it.
 * Shuffling single days destroys that structure in the null while the
 * observed data keeps it, which makes coincidental alignment of two slow
 * curves look like signal. Measured on AR(1) pairs at the autocorrelation
 * daily weather and physiology actually show (phi 0.5–0.7), the day-shuffle
 * rejects 9–17% of TRUE nulls at p<0.05 — two to three times its nominal
 * rate. Shuffling contiguous blocks keeps the short-range structure in the
 * null too, and the same measurement comes back at 5–8%.
 *
 * The cost is honest and small: ~98% power stays ~98% on strong effects;
 * borderline ones lose most of the excess that was never real. The
 * observations must arrive in day order — Split preserves it — and label
 * counts are preserved by construction, so groups can never come back empty.
 * Days a family skipped (nulls) compress out of the sequence, so a "block"
 * is adjacent observations, not strictly adjacent dates; the approximation
 * is noted rather than hidden.
 */
export function blockPermutationP(obs: { v: number; hi: boolean }[], seedKey: string): number {
  const n = obs.length
  const labels = obs.map(o => o.hi)
  const values = obs.map(o => o.v)

  const diffFor = (lab: boolean[]): number => {
    let sh = 0, nh = 0, sl = 0, nl = 0
    for (let i = 0; i < n; i++) {
      if (lab[i]) { sh += values[i]; nh++ } else { sl += values[i]; nl++ }
    }
    return Math.abs(sh / nh - sl / nl)
  }
  const observed = diffFor(labels)

  const b = blockLength(n)
  const nBlocks = Math.ceil(n / b)
  const idx = Array.from({ length: nBlocks }, (_, i) => i)
  const rng = seededRng(hashString(seedKey))
  const permuted: boolean[] = new Array(n)

  let atLeast = 0
  for (let p = 0; p < PERMUTATIONS; p++) {
    shuffleInPlace(idx, rng)
    let at = 0
    for (const bi of idx) {
      for (let k = bi * b; k < Math.min((bi + 1) * b, n); k++) permuted[at++] = labels[k]
    }
    if (diffFor(permuted) >= observed - 1e-12) atLeast++
  }
  // +1 correction: a permutation p-value is never exactly 0
  return (atLeast + 1) / (PERMUTATIONS + 1)
}

/**
 * Day-shuffle permutation test. No longer what compareGroups runs — it
 * assumes exchangeable days, and blockPermutationP above documents the
 * measured cost of that assumption — but kept exported as the honest
 * baseline the calibration test compares against.
 */
export function permutationP(high: number[], low: number[], seedKey: string): number {
  const observed = Math.abs(avg(high) - avg(low))
  const pool = [...high, ...low]
  const nHigh = high.length
  const rng = seededRng(hashString(seedKey))
  let atLeast = 0
  for (let p = 0; p < PERMUTATIONS; p++) {
    shuffleInPlace(pool, rng)
    const diff = Math.abs(meanOfSlice(pool, 0, nHigh) - meanOfSlice(pool, nHigh, pool.length))
    if (diff >= observed - 1e-12) atLeast++
  }
  // +1 correction: a permutation p-value is never exactly 0
  return (atLeast + 1) / (PERMUTATIONS + 1)
}

function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  // Fisher-Yates
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
}

/** Mean of arr[from..to), without allocating a slice per permutation. */
function meanOfSlice(arr: number[], from: number, to: number): number {
  let sum = 0
  for (let i = from; i < to; i++) sum += arr[i]
  return sum / (to - from)
}

/**
 * Permutation test for a two-way interaction: the difference between two
 * differences, which is the thing an interaction card actually claims.
 *
 * The null here is narrower than the one `permutationP` tests, and the
 * difference matters. "Nothing in this table matters" is easy to reject and
 * would be the wrong question — a moderator with a large effect of its own
 * (a workout lifts HRV whether or not you drank) would clear it every time
 * and every interaction card would look significant. The null being tested
 * is only "the moderator does not change the predictor's effect".
 *
 * So the shuffle moves the MODERATOR label within each predictor level
 * separately, holding all four cell counts fixed. A main effect of either
 * variable shifts both cells of a level equally and cancels in the
 * difference-of-differences, so it cannot manufacture a small p-value; only
 * a genuine change in the effect survives the shuffle.
 *
 * Where the moderator does have a main effect it stays in the pool being
 * shuffled, widening the null distribution and pushing the p-value up. The
 * test is conservative in exactly the cases most likely to fool a reader,
 * which is the right direction to be wrong in.
 */
export function interactionPermutationP(
  onYes: number[], onNo: number[],
  offYes: number[], offNo: number[],
  seedKey: string,
): number {
  const observed = Math.abs((avg(offYes) - avg(offNo)) - (avg(onYes) - avg(onNo)))
  // One pool per predictor level; the first n entries stand in for "moderator on".
  const yesPool = [...onYes, ...offYes]
  const noPool = [...onNo, ...offNo]
  const nOnYes = onYes.length
  const nOnNo = onNo.length
  const rng = seededRng(hashString(seedKey))
  let atLeast = 0
  for (let p = 0; p < PERMUTATIONS; p++) {
    shuffleInPlace(yesPool, rng)
    shuffleInPlace(noPool, rng)
    const on = meanOfSlice(yesPool, 0, nOnYes) - meanOfSlice(noPool, 0, nOnNo)
    const off = meanOfSlice(yesPool, nOnYes, yesPool.length) - meanOfSlice(noPool, nOnNo, noPool.length)
    if (Math.abs(off - on) >= observed - 1e-12) atLeast++
  }
  return (atLeast + 1) / (PERMUTATIONS + 1)
}

/**
 * Benjamini-Hochberg false-discovery control at q=0.10, assigning each insight
 * its trust tier in place.
 *
 * Applied within each `pool` rather than across the run. Everything without a
 * pool is one family — the main battery — and the pools that exist are the
 * gatekept ones: tests the engine was only allowed to run because a question
 * asked in the main battery came back answered. Correcting those against the
 * whole run would charge them for the ninety-odd tests they were never in.
 */
export function assignTiers(insights: InsightResult[]): void {
  const pools = new Map<string, InsightResult[]>()
  for (const ins of insights) {
    const key = ins.pool ?? ""
    const list = pools.get(key)
    if (list) list.push(ins)
    else pools.set(key, [ins])
  }
  for (const pool of pools.values()) {
    const sorted = [...pool].sort((a, b) => a.pValue - b.pValue)
    const m = sorted.length
    let cutoffIdx = -1
    for (let i = 0; i < m; i++) {
      if (sorted[i].pValue <= ((i + 1) / m) * 0.10) cutoffIdx = i
    }
    sorted.forEach((ins, idx) => {
      ins.tier = idx <= cutoffIdx ? "strong" : ins.pValue <= 0.10 ? "suggestive" : "noise"
    })
  }
}

function isWeekendDate(dateStr: string): boolean {
  const dow = new Date(dateStr + "T12:00:00Z").getUTCDay()
  return dow === 0 || dow === 6
}

/**
 * A group's name, in the two forms it has to serve.
 *
 * `chip` heads a stat column on the card — ALL-CAPS, truncated, so it wants a
 * bare noun phrase. `phrase` goes inside a sentence, where it needs whatever
 * article or preposition makes that sentence read.
 *
 * One string could not do both, and the damage was the doubled preposition:
 * the template hard-coded "After …" while the chip already began "after
 * 16:00", so the card said "After some caffeine after 16:00 the night scores
 * 62.9". `COMBO_CONDITIONS` has carried the same short/label split for this
 * reason since it was written; this generalises it.
 *
 * A plain string still means both — which is most call sites, and they are
 * right to stay that way.
 */
type GroupLabel = string | { chip: string; phrase: string }

const chipOf = (l: GroupLabel) => (typeof l === "string" ? l : l.chip)
const phraseOf = (l: GroupLabel) => (typeof l === "string" ? l : l.phrase)

/**
 * Compare two groups on a metric. Returns an insight if both groups have >= minN days.
 */
function compareGroups(opts: {
  id: string
  category: InsightResult["category"]
  emoji: string
  title: string
  highGroupLabel: GroupLabel
  lowGroupLabel: GroupLabel
  /** The family's observations in day order — see Split. */
  series: Split
  higherIsBetter?: boolean
  /** `label` carries the PHRASE forms — the ones that belong in a sentence. */
  findingTemplate: (
    highAvg: number,
    lowAvg: number,
    label: { high: string; low: string },
  ) => string
  minN?: number
}): InsightResult | null {
  const {
    id, category, emoji, title,
    highGroupLabel, lowGroupLabel,
    series,
    higherIsBetter = true,
    findingTemplate,
    minN = 5,
  } = opts
  const highValues = series.high
  const lowValues = series.low

  if (highValues.length < minN || lowValues.length < minN) return null

  const highAvg = r1(avg(highValues))
  const lowAvg = r1(avg(lowValues))

  // A zero baseline used to abort the comparison, because the percentage
  // change is undefined. For scores that never reach zero this never came up,
  // but symptoms live there: "headache 4/5 the day after drinking, 0 the rest
  // of the time" is the single most useful thing this engine can say, and it
  // was being discarded. Measuring against whichever side is non-zero makes
  // "only ever happens in this group" a clean 100%.
  if (highAvg === 0 && lowAvg === 0) return null
  const base = Math.abs(lowAvg) || Math.abs(highAvg)

  const rawDelta = ((highAvg - lowAvg) / base) * 100
  const delta = higherIsBetter ? rawDelta : -rawDelta

  return {
    id,
    category,
    emoji,
    title,
    finding: findingTemplate(highAvg, lowAvg, { high: phraseOf(highGroupLabel), low: phraseOf(lowGroupLabel) }),
    delta: Math.round(delta * 10) / 10,
    // The chip form is what leaves this function, so `InsightResult` keeps the
    // plain strings every consumer already reads — the page, the weakness
    // note, and the experiment suggester that parses them.
    highGroupLabel: chipOf(highGroupLabel),
    lowGroupLabel: chipOf(lowGroupLabel),
    highGroupAvg: highAvg,
    lowGroupAvg: lowAvg,
    highGroupN: highValues.length,
    lowGroupN: lowValues.length,
    confident: highValues.length >= CONFIDENT_N && lowValues.length >= CONFIDENT_N,
    pValue: permutationsOn ? blockPermutationP(series.obs, id) : 1,
    tier: "noise", // provisional — assignTiers() sets the real tier per run
  }
}

/**
 * Compute all correlation insights for a user over the last `windowDays` days,
 * sorted by absolute effect size (strongest first).
 */
export async function computeCorrelations(
  userId: string,
  windowDays: number,
): Promise<{ insights: InsightResult[]; totalDays: number }> {
  const since60 = subDays(new Date(), windowDays - 1)
  const since60str = format(since60, "yyyy-MM-dd")

  const [healthLogs, checkIns, habitCompletions, caffeineRows, alcoholRows, tagPrefs, weatherLogs, screenRows, deviceEvents] = await Promise.all([
    prisma.healthLog.findMany({
      where: { userId, date: { gte: since60 } },
      orderBy: { date: "asc" },
      select: {
        date: true,
        sleepScore: true,
        sleepDuration: true,
        readinessScore: true,
        restingHR: true,
        stressHigh: true,
        hrv: true,
        steps: true,
        activityScore: true,
        deepSleep: true,
        remSleep: true,
        sleepLatency: true,
        sleepEfficiency: true,
        sleepStart: true,
        restlessPeriods: true,
      },
    }),

    prisma.$queryRaw<{ date: string; energy: number; mood: number }[]>`
      SELECT "date", "energy", "mood"
      FROM "MorningCheckIn"
      WHERE "userId" = ${userId}
        AND "date" >= ${since60str}
    `.catch(() => [] as { date: string; energy: number; mood: number }[]),

    prisma.habitCompletion.findMany({
      where: { userId, date: { gte: since60 } },
      select: { date: true },
    }).catch(() => [] as { date: Date }[]),

    // Raw timestamps, summed per LOCAL day further down (next to water and
    // meals). The SQL used to GROUP BY the UTC date, so a nightcap at 00:30
    // Prague time counted for the day before — the one night it could not
    // have affected.
    prisma.caffeineLog.findMany({
      where: { userId, loggedAt: { gte: since60 } },
      select: { loggedAt: true, caffeineMg: true },
    }).catch(() => [] as { loggedAt: Date; caffeineMg: number }[]),

    prisma.intakeLog.findMany({
      // Not `type: "alcohol"`. That is one of four alcohol types and the least
      // used of them — the Intake screen has its own buttons for beer, wine and
      // spirits, so nobody taps the generic one. See ALCOHOL_TYPES.
      where: { userId, type: { in: [...ALCOHOL_TYPES] }, loggedAt: { gte: since60 } },
      select: { loggedAt: true, amountMl: true, type: true, note: true },
    }).catch(() => [] as { loggedAt: Date; amountMl: number; type: string; note: string | null }[]),

    prisma.$queryRaw<{ key: string; value: string }[]>`
      SELECT "key", "value"
      FROM "UserPreference"
      WHERE "userId" = ${userId}
        AND "key" LIKE 'daily_tags:%'
    `.catch(() => [] as { key: string; value: string }[]),

    prisma.weatherLog.findMany({
      where: { userId, date: { gte: since60str } },
      select: { date: true, precipMm: true, tempMaxC: true, weatherCode: true, uvIndex: true },
    }).catch(() => [] as { date: string; precipMm: number | null; tempMaxC: number | null; weatherCode: number | null; uvIndex: number | null }[]),

    prisma.screenTimeLog.findMany({
      where: { userId, date: { gte: since60str } },
      select: { date: true, totalMin: true, firstUnlockMin: true },
    }).catch(() => [] as { date: string; totalMin: number; firstUnlockMin: number | null }[]),

    // Past calendar events in the window — for calendar-load + per-activity
    // correlations. Capped at midnight today so future events don't count.
    prisma.deviceCalendarEvent.findMany({
      where: { userId, start: { gte: since60, lte: new Date() } },
      select: { title: true, start: true },
    }).catch(() => [] as { title: string; start: Date }[]),
  ])

  const [waterRows, foodRows, ouraTagRows, tzRow, placeCheckIns] = await Promise.all([
    prisma.intakeLog.findMany({
      where: { userId, type: { in: HYDRATING_TYPES }, loggedAt: { gte: since60 } },
      select: { loggedAt: true, amountMl: true, type: true },
    }).catch(() => [] as { loggedAt: Date; amountMl: number; type: string }[]),

    prisma.foodLog.findMany({
      where: { userId, loggedAt: { gte: since60 } },
      select: { loggedAt: true, calories: true, proteinG: true, sugarG: true },
    }).catch(() => [] as { loggedAt: Date; calories: number; proteinG: number | null; sugarG: number | null }[]),

    // Supplements the user logs in the Oura app (drinks are mirrored into
    // IntakeLog by the sync; med-kind tags are the supplement signal)
    prisma.ouraTag.findMany({
      where: { userId, day: { gte: since60str } },
      select: { day: true, tagName: true, text: true },
    }).catch(() => [] as { day: string; tagName: string | null; text: string | null }[]),

    prisma.userPreference.findUnique({
      where: { userId_key: { userId, key: "timezone" } },
    }).catch(() => null),

    // Where you were. The places page had its own copy of this question and
    // answered it out of a Google Timeline import run once in August; the
    // engine never asked it at all. These are the live check-ins — the same
    // rows the location page reads — so a place can finally face the same
    // gates as a coffee.
    prisma.$queryRaw<{ checkedAt: Date; place: string; isAuto: boolean }[]>`
      SELECT "checkedAt", "place", "isAuto" FROM "CheckIn"
      WHERE "userId" = ${userId} AND "checkedAt" >= ${since60}
    `.catch(() => [] as { checkedAt: Date; place: string; isAuto: boolean }[]),
  ])

  // Sources that used to live only in the /api/stats mini-engine (music, money,
  // focus) or nowhere at all (standalone mood logs, Strava, fasting).
  const [moodRows, stravaRows, focusRows, lastfmRows, txRows, fastPref, symptomRows, customMetricRows, customLogRows, locPoints, travelSpans, rescueRows, bpRows, bodyRows] = await Promise.all([
    prisma.moodLog.findMany({
      where: { userId, date: { gte: since60 } },
      select: { date: true, mood: true },
    }).catch(() => [] as { date: Date; mood: number }[]),

    prisma.stravaActivity.findMany({
      where: { userId, day: { gte: since60str } },
      select: { day: true, movingTimeSec: true },
    }).catch(() => [] as { day: string; movingTimeSec: number }[]),

    prisma.focusSession.findMany({
      where: { userId, type: "focus", endedAt: { gte: since60 } },
      select: { endedAt: true, durationMin: true },
    }).catch(() => [] as { endedAt: Date; durationMin: number }[]),

    // Last.fm lives in a raw-DDL table with no Prisma model
    prisma.$queryRaw<{ date: string; listeningMin: number; lateTracks: number | null; topArtist: string | null; artistPlays: Record<string, number> | null }[]>`
      SELECT "date", "listeningMin", "lateTracks", "topArtist", "artistPlays" FROM "LastfmLog"
      WHERE "userId" = ${userId} AND "date" >= ${since60str}
    `.catch(() => [] as { date: string; listeningMin: number; lateTracks: number | null; topArtist: string | null; artistPlays: Record<string, number> | null }[]),

    prisma.transaction.findMany({
      where: { userId, date: { gte: since60 }, isTransfer: false, amount: { lt: 0 } },
      select: { date: true, amount: true },
    }).catch(() => [] as { date: Date; amount: number }[]),

    prisma.userPreference.findUnique({
      where: { userId_key: { userId, key: "fast:history" } },
    }).catch(() => null),

    prisma.symptomLog.findMany({
      where: { userId, day: { gte: since60str } },
      select: { day: true, name: true, severity: true },
    }).catch(() => [] as { day: string; name: string; severity: number }[]),

    // Custom trackers also live in raw-DDL tables with no Prisma model
    prisma.$queryRaw<{ id: string; name: string; emoji: string; type: string }[]>`
      SELECT "id", "name", "emoji", "type" FROM "CustomMetric" WHERE "userId" = ${userId}
    `.catch(() => [] as { id: string; name: string; emoji: string; type: string }[]),

    prisma.$queryRaw<{ metricId: string; date: string; value: number }[]>`
      SELECT "metricId", "date"::text as "date", "value" FROM "CustomMetricLog"
      WHERE "userId" = ${userId} AND "date" >= ${since60str}
    `.catch(() => [] as { metricId: string; date: string; value: number }[]),

    // GPS fixes, thinned to one per source per quarter hour — enough to say
    // home / in town / away and where the night was spent (lib/day-location),
    // which is the grain sleep and mood are recorded at anyway.
    loadCoarsePoints(userId, since60).catch(() => ({ points: [], countsBySource: {}, truncated: false })),

    // Recognised movement spans. All modes are loaded, not just walking: a day
    // with spans but no walk is a real zero-walking day, while a day with no
    // spans at all just wasn't tracked — and only the spans themselves can
    // tell those apart.
    prisma.activitySpan.findMany({
      where: { userId, start: { gte: since60 } },
      select: { start: true, end: true, mode: true },
    }).catch(() => [] as { start: Date; end: Date; mode: string }[]),

    prisma.rescuetimeLog.findMany({
      where: { userId, date: { gte: since60str } },
      select: { date: true, productiveH: true, distractingH: true },
    }).catch(() => [] as { date: string; productiveH: number | null; distractingH: number | null }[]),

    prisma.bloodPressureLog.findMany({
      where: { userId, loggedAt: { gte: since60 } },
      select: { loggedAt: true, systolic: true },
    }).catch(() => [] as { loggedAt: Date; systolic: number }[]),

    prisma.bodyMeasurement.findMany({
      where: { userId, date: { gte: since60 } },
      orderBy: { date: "asc" },
      select: { date: true, weightKg: true, waistCm: true },
    }).catch(() => [] as { date: Date; weightKg: number | null; waistCm: number | null }[]),
  ])

  // Genres for the artists this user's days were topped by — the ArtistGenre
  // table is global (an artist is the same band for everyone), filled in by
  // the Last.fm sync and the YT Music import.
  // The whole tagged table, not just this user's day-toppers: a day's genre
  // is decided by the share of ALL its plays now, and the artists that swing
  // a majority are precisely the ones that never topped a day. The table is
  // one small global row per artist ever seen — cheaper to load whole than to
  // join against JSON keys.
  const genreRows = await prisma.$queryRaw<{ artist: string; genre: string }[]>`
    SELECT "artist", "genre" FROM "ArtistGenre" WHERE "genre" IS NOT NULL
  `.catch(() => [] as { artist: string; genre: string }[])

  const dayMap = new Map<string, DayData>()

  function getOrCreate(dateStr: string): DayData {
    if (!dayMap.has(dateStr)) dayMap.set(dateStr, { date: dateStr })
    return dayMap.get(dateStr)!
  }

  // Days the diary was actually open. Set by every source the user types in —
  // never by a sync, never by an automatic check-in, both of which happen
  // whether or not anyone was paying attention. See DayData.logged.
  const markLogged = (dateStr: string) => { getOrCreate(dateStr).logged = true }

  for (const l of healthLogs) {
    const dateStr = l.date.toISOString().slice(0, 10)
    const d = getOrCreate(dateStr)
    if (l.sleepScore != null) d.sleepScore = l.sleepScore
    if (l.sleepDuration != null) d.sleepDuration = l.sleepDuration / 60
    if (l.readinessScore != null) d.readiness = l.readinessScore
    if (l.restingHR != null) d.restingHR = l.restingHR
    if (l.stressHigh != null) d.stressHighMin = l.stressHigh
    if (l.hrv != null) d.hrv = l.hrv
    if (l.steps != null) d.steps = l.steps
    if (l.activityScore != null) d.activityScore = l.activityScore
    if (l.deepSleep != null) d.deepSleepMin = l.deepSleep
    if (l.remSleep != null) d.remSleepMin = l.remSleep
    if (l.sleepLatency != null) d.sleepLatencyMin = l.sleepLatency
    if (l.sleepEfficiency != null) d.sleepEfficiency = l.sleepEfficiency
    if (l.restlessPeriods != null) d.restlessPeriods = l.restlessPeriods
    // Bedtime as a number the engine can correlate on, wrapped past midnight so
    // 01:20 reads as later than 23:08 rather than twenty-two hours earlier.
    // Without the wrap, a run of late nights straddling midnight averages out
    // to the middle of the afternoon.
  }

  for (const c of checkIns) {
    const d = getOrCreate(c.date)
    d.energy = c.energy
    d.mood = c.mood
    d.logged = true
  }

  // Standalone mood logs (the mood button, Emergy's log_mood tool). The engine
  // only ever read morning-checkin mood, so these moods correlated with
  // nothing. Check-in mood wins when both exist on a day.
  for (const m of moodRows) {
    const dateStr = m.date.toISOString().slice(0, 10)
    const d = getOrCreate(dateStr)
    if (d.mood == null) d.mood = m.mood
    d.logged = true
  }

  for (const cl of customLogRows) {
    const d = getOrCreate(cl.date.slice(0, 10))
    if (!d.custom) d.custom = {}
    d.custom[cl.metricId] = Number(cl.value)
    d.logged = true
  }

  const habitCountByDay: Record<string, number> = {}
  for (const hc of habitCompletions) {
    const dateStr = hc.date instanceof Date ? hc.date.toISOString().slice(0, 10) : String(hc.date).slice(0, 10)
    habitCountByDay[dateStr] = (habitCountByDay[dateStr] ?? 0) + 1
  }
  for (const [dateStr, count] of Object.entries(habitCountByDay)) {
    getOrCreate(dateStr).habitCount = count
    markLogged(dateStr)
  }


  for (const w of weatherLogs) {
    const d = getOrCreate(w.date)
    if (w.precipMm != null) d.precipMm = w.precipMm
    if (w.tempMaxC != null) d.tempMaxC = w.tempMaxC
    if (w.weatherCode != null) d.weatherCode = w.weatherCode
    if (w.uvIndex != null) d.uvIndex = w.uvIndex
  }

  for (const s of (screenRows as { date: string; totalMin: number; firstUnlockMin: number | null }[])) {
    if (s.totalMin != null) getOrCreate(s.date).screenTimeMin = s.totalMin
    if (s.firstUnlockMin != null) getOrCreate(s.date).firstUnlockMin = s.firstUnlockMin
  }

  for (const pref of tagPrefs) {
    const dateStr = pref.key.slice("daily_tags:".length)
    if (dateStr < since60str) continue
    try {
      const tags = JSON.parse(pref.value)
      if (Array.isArray(tags) && tags.length > 0) {
        getOrCreate(dateStr).tags = tags as string[]
      }
    } catch {
      // malformed JSON — skip
    }
  }

  // Which day a timestamp belongs to, in the user's own time.
  //
  // Date-only columns are safe to slice out of an ISO string — Prisma returns
  // them at UTC midnight, which is exactly how they were stored. Timestamps are
  // not: slicing one buckets it by UTC day, so for anyone ahead of UTC
  // everything logged between local midnight and their offset was filed under
  // the previous day.
  //
  // That matters more here than anywhere else in the app. This engine joins
  // sources by day and then tests whether one moves another. A drink logged at
  // 00:30 landing on the day before is not a missing number — it is a number
  // attached to the wrong night, which is how an association nobody lived gets
  // published as a pattern.
  const tz = tzRow?.value || "UTC"

  // Bedtime needs the user's clock, which only resolves here — so it is filled
  // in a second pass rather than in the loop above. Late is always a bigger
  // number (see bedtimeMinutesLate), or a week straddling midnight correlates
  // against nonsense.
  for (const l of healthLogs) {
    if (l.sleepStart == null) continue
    getOrCreate(l.date.toISOString().slice(0, 10)).bedtimeMin = bedtimeMinutesLate(l.sleepStart, tz)
  }
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz })
  const localDay = (d: Date): string => dayFmt.format(d)

  const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false })
  const localMinutes = (date: Date): number => {
    const [h, m] = timeFmt.format(date).split(":").map(Number)
    return (h % 24) * 60 + m
  }

  // The earliest synced event marks where calendar knowledge begins. A day
  // with no events after that point is a genuinely quiet day; a day before it
  // is simply unknown, and the calendar-load family must not file it under
  // "quiet" — that turned every pre-sync day into the control group.
  let calendarFrom: string | null = null
  for (const ev of (deviceEvents as { title: string; start: Date }[])) {
    const dateStr = localDay(ev.start)
    const d = getOrCreate(dateStr)
    d.eventCount = (d.eventCount ?? 0) + 1
    ;(d.eventTitles ??= []).push((ev.title ?? "").trim())
    if (calendarFrom == null || dateStr < calendarFrom) calendarFrom = dateStr
  }
  const calendarCovers = (date: string): boolean => calendarFrom != null && date >= calendarFrom

  for (const w of waterRows) {
    const dateStr = localDay(w.loggedAt)
    const d = getOrCreate(dateStr)
    d.waterMl = (d.waterMl ?? 0) + hydrationMl(w.type, w.amountMl)
    d.logged = true
  }

  for (const c of caffeineRows) {
    const d = getOrCreate(localDay(c.loggedAt))
    d.caffeineMg = (d.caffeineMg ?? 0) + Number(c.caffeineMg)
    // Timing is its own lever and the timestamps have carried it all along.
    // A 200mg day that finished at 09:00 and a 200mg day whose second cup was
    // at 18:30 are the same number and not the same night.
    if (localMinutes(c.loggedAt) >= LATE_CAFFEINE_MIN) {
      d.lateCaffeineMg = (d.lateCaffeineMg ?? 0) + Number(c.caffeineMg)
    }
    d.logged = true
  }

  for (const a of alcoholRows) {
    const d = getOrCreate(localDay(a.loggedAt))
    d.alcoholG = (d.alcoholG ?? 0) + ethanolGrams(a.type, Number(a.amountMl), a.note ?? undefined)
    d.logged = true
  }

  // Places, folded so one café is one place. This account checks in at
  // "Kaviareň Vták", "Kaviaren Vtak" and "Kaviareň vták" — eleven days that
  // read as three places of nine, one and one, two of which are too small to
  // test and the third of which is missing a fifth of its evidence.
  const placeLabels = new Map<string, string>()
  for (const c of placeCheckIns) {
    const raw = (c.place ?? "").trim()
    if (!raw) continue
    const key = foldPlace(raw)
    if (!key) continue
    if (!placeLabels.has(key)) placeLabels.set(key, raw)
    const d = getOrCreate(localDay(c.checkedAt))
    if (!d.places) d.places = []
    if (!d.places.includes(key)) d.places.push(key)
    // A check-in you tapped is a diary entry; one the phone filed for you is not.
    if (!c.isAuto) d.logged = true
  }

  // Food-tab meals: day totals, plus the local clock time of the day's last
  // meal (meal *timing* is a sleep lever the timestamps give us for free)
  for (const f of foodRows) {
    const dateStr = localDay(f.loggedAt)
    const d = getOrCreate(dateStr)
    d.calories = (d.calories ?? 0) + f.calories
    if (f.proteinG != null) d.proteinG = (d.proteinG ?? 0) + f.proteinG
    if (f.sugarG != null) d.sugarG = (d.sugarG ?? 0) + f.sugarG
    const min = localMinutes(f.loggedAt)
    if (d.lastMealMin == null || min > d.lastMealMin) d.lastMealMin = min
    d.logged = true
  }

  for (const t of ouraTagRows) {
    const label = ((t.tagName ?? t.text) ?? "").trim()
    if (!label || classifyOuraTag(label).kind !== "med") continue
    // cleanLabel, not the raw text: "Frontin 0,5 mg" and "Frontin" have to be
    // one substance or each half sits below the 5-day threshold and neither
    // ever produces an insight.
    const name = normalizeSupplement(label) ?? cleanLabel(label)
    const d = getOrCreate(t.day)
    d.supplements ??= []
    if (!d.supplements.includes(name)) d.supplements.push(name)
  }

  for (const sy of symptomRows) {
    const d = getOrCreate(sy.day)
    d.symptoms ??= {}
    if ((d.symptoms[sy.name] ?? 0) < sy.severity) d.symptoms[sy.name] = sy.severity
    d.logged = true
  }

  for (const a of stravaRows) {
    const d = getOrCreate(a.day)
    d.workoutMin = (d.workoutMin ?? 0) + Math.round(a.movingTimeSec / 60)
  }

  for (const f of focusRows) {
    const dateStr = localDay(f.endedAt)
    const d = getOrCreate(dateStr)
    d.focusMin = (d.focusMin ?? 0) + f.durationMin
  }

  const genreByArtist = new Map(genreRows.map(g => [g.artist, g.genre]))
  for (const l of lastfmRows) {
    if (l.listeningMin != null) getOrCreate(l.date).listeningMin = Number(l.listeningMin)
    if (l.lateTracks != null) getOrCreate(l.date).lateTracks = Number(l.lateTracks)
    // Full counts decide; the top artist speaks only for rows that predate
    // artistPlays. A day WITH counts but no majority stays unlabelled on
    // purpose — see dominantGenre.
    const genre = l.artistPlays != null
      ? dominantGenre(l.artistPlays, genreByArtist)
      : l.topArtist ? genreByArtist.get(l.topArtist.toLowerCase()) ?? null : null
    if (genre) getOrCreate(l.date).musicGenre = genre
  }

  for (const t of txRows) {
    const dateStr = t.date.toISOString().slice(0, 10)
    const d = getOrCreate(dateStr)
    d.spendEur = (d.spendEur ?? 0) + Math.abs(t.amount) / 100
  }

  // Completed fasts (fasting page history — a JSON blob in UserPreference).
  // Attributed to the day the fast ended.
  try {
    const fastHistory = JSON.parse(fastPref?.value ?? "[]") as { endedAt?: string; durationH?: number }[]
    if (Array.isArray(fastHistory)) {
      for (const rec of fastHistory) {
        if (!rec?.endedAt || typeof rec.durationH !== "number") continue
        const dateStr = rec.endedAt.slice(0, 10)
        if (dateStr < since60str) continue
        const d = getOrCreate(dateStr)
        if (d.fastH == null || rec.durationH > d.fastH) d.fastH = rec.durationH
      }
    }
  } catch { /* malformed blob — skip fasting */ }

  // Where each day was, coarsely. "unknown" days stay unset — silence is a gap
  // in tracking, never evidence of a day at home (see lib/day-location).
  const home = estimateHome(locPoints.points, tz)
  for (const dl of summariseDays(locPoints.points, tz, home)) {
    if (dl.date < since60str) continue
    const d = getOrCreate(dl.date)
    if (dl.presence !== "unknown") d.presence = dl.presence
    if (dl.slept !== "unknown") d.sleptAway = dl.slept === "away"
  }

  // Walking minutes — but only on days movement recognition was running at
  // all. A tracked day without a walk span is a genuine 0; an untracked day
  // is unknown and stays out of both groups.
  const walkByDay = new Map<string, number>()
  const movementTracked = new Set<string>()
  for (const s of travelSpans) {
    const dateStr = localDay(s.start)
    if (dateStr < since60str) continue
    movementTracked.add(dateStr)
    if (s.mode === "walk") {
      walkByDay.set(dateStr, (walkByDay.get(dateStr) ?? 0) + Math.max(0, (s.end.getTime() - s.start.getTime()) / 60_000))
    }
  }
  for (const dateStr of movementTracked) {
    getOrCreate(dateStr).walkMin = Math.round(walkByDay.get(dateStr) ?? 0)
  }

  for (const r of rescueRows) {
    const d = getOrCreate(r.date)
    if (r.productiveH != null) d.productiveH = r.productiveH
    if (r.distractingH != null) d.distractingH = r.distractingH
  }

  // Blood pressure: a day's average systolic. Multiple readings a day are
  // common (morning + evening cuffs) and averaging beats picking one.
  const bpAgg = new Map<string, { sum: number; n: number }>()
  for (const b of bpRows) {
    const dateStr = localDay(b.loggedAt)
    const a = bpAgg.get(dateStr) ?? { sum: 0, n: 0 }
    a.sum += b.systolic
    a.n += 1
    bpAgg.set(dateStr, a)
  }
  for (const [dateStr, a] of bpAgg) {
    getOrCreate(dateStr).systolic = Math.round(a.sum / a.n)
  }

  // A weigh-in is a date-only column, so the UTC slice is the day it was
  // recorded for — no timezone shift to undo.
  for (const b of bodyRows) {
    const d = getOrCreate(b.date.toISOString().slice(0, 10))
    if (b.weightKg != null) d.weightKg = b.weightKg
    if (b.waistCm != null) d.waistCm = b.waistCm
  }

  const allDays = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date))
  const totalDays = allDays.length

  // The whole insight battery, runnable on any subset of days — it runs twice:
  // once on everything, once on weekdays only (the weekend confounder guard).
  // Custom-tracker group definitions come from the FULL window, not from
  // whichever day-subset a pass happens to see: recomputing the median (or
  // the binary detection) on weekdays-only would make the weekend guard
  // compare two structurally different splits, and re-applying the 10-day
  // gate on the smaller weekday set would silently skip the guard for
  // exactly the weekend-clustered trackers it exists to catch. Qualification
  // happens here; inside each pass compareGroups' per-group minimums decide,
  // same as every built-in source.
  const customDefs = customMetricRows.flatMap(metric => {
    const vals = allDays.filter(d => d.custom?.[metric.id] != null).map(d => d.custom![metric.id])
    if (vals.length < 10) return []
    const isBinary = metric.type === "boolean" || vals.every(v => v === 0 || v === 1)
    const valMedian = median(vals)
    return [{
      id: metric.id,
      name: metric.name,
      emoji: metric.emoji,
      isHigh: (v: number) => (isBinary ? v >= 1 : v >= valMedian),
      // The chip carries the threshold because it is the only place a reader
      // can check what the split was; the phrase drops it, because
      // "(3+)" mid-sentence is a parenthesis nobody reads aloud.
      highLabel: isBinary
        ? { chip: `${metric.name} days`, phrase: `${metric.name} days` }
        : { chip: `higher ${metric.name} days (${r1(valMedian)}+)`, phrase: `higher ${metric.name} days` },
      lowLabel: isBinary
        ? { chip: `days without ${metric.name}`, phrase: "days without it" }
        : { chip: `lower ${metric.name} days`, phrase: "lower ones" },
    }]
  })

  // Water is the one source where the app already knows the right number and
  // wasn't using it: computeTargets() scales the daily goal to body mass
  // (35 ml/kg), the Intake screen shows that figure, and this engine used to
  // group days at a flat 2000. At 80kg the target is 2800, so a 2.1L day was
  // filed under "2L+ water days" on the same day Intake called it 700ml short.
  // One app, two answers, and this was the half drawing conclusions.
  //
  // Only the two sites that mean "hit your daily goal" move. The symptom
  // battery's "under 1.5L" is a dehydration marker, not a goal, and scaling it
  // would be inventing a rule nobody wrote down.
  const goals = await getGoals(userId).catch(() => null)
  const targets = computeTargets({
    weightKg: goals?.weightKg ?? null,
    heightCm: goals?.heightCm ?? null,
    birthYear: goals?.birthYear ?? null,
    sex: goals?.sex === "male" || goals?.sex === "female" ? goals.sex : null,
  })

  // Three sources are still cut at a borrowed number rather than a personal
  // one. Like customDefs above, the cut is decided on the FULL window and not
  // per-pass — recomputing it on weekdays-only would let the weekend guard
  // compare two structurally different splits.
  const cuts = {
    // The label already said "25°C+" while the code tested `> 25`; the cut is
    // inclusive on both sides now.
    heat: balancedCut(allDays.map(d => d.tempMaxC), 25),
    caffeine: balancedCut(allDays.map(d => d.caffeineMg), 200),
    stress: balancedCut(allDays.map(d => d.stressHighMin), 60),
    // The borrowed number here is your own target, so `personal` stays false
    // until even that fails to split the days and the median takes over.
    water: balancedCut(allDays.map(d => d.waterMl), targets.waterMl),
  }
  const waterLabel = cuts.water.at >= 1000
    ? `${(cuts.water.at / 1000).toFixed(cuts.water.at % 1000 === 0 ? 0 : 1)}L`
    : `${Math.round(cuts.water.at)}ml`
  const heatLabel = `${Math.round(cuts.heat.at)}°C+`
  const cafLabel = `${Math.round(cuts.caffeine.at)}mg+`
  const cafUnderLabel = `under ${Math.round(cuts.caffeine.at)}mg`
  const stressLabel = `${Math.round(cuts.stress.at)}+ min high stress`
  const stressMinLabel = `${Math.round(cuts.stress.at)}+ min`

  // ── What the sleep panel is allowed to ask about ─────────────────────────
  //
  // Decided on the full window and not per-pass, for the same reason the cuts
  // above are: the weekend guard re-runs the battery on weekdays only, and a
  // place that qualifies on one pass and not the other would have the guard
  // comparing two different questions.
  const placeVisitDays = new Map<string, number>()
  const placeCaffeineDays = new Map<string, number>()
  let caffeineDayCount = 0
  for (const d of allDays) {
    const hadCaffeine = (d.caffeineMg ?? 0) > 0
    if (hadCaffeine) caffeineDayCount++
    for (const key of d.places ?? []) {
      placeVisitDays.set(key, (placeVisitDays.get(key) ?? 0) + 1)
      if (hadCaffeine) placeCaffeineDays.set(key, (placeCaffeineDays.get(key) ?? 0) + 1)
    }
  }
  const loggedDayCount = allDays.filter(d => d.logged).length

  /** Places with days on both sides of the question, strongest first, capped. */
  const pickPlaces = (counts: Map<string, number>, universe: number, cap: number): string[] =>
    Array.from(counts.entries())
      .filter(([, n]) => n >= 5 && universe - n >= 5)
      .sort((a, b) => b[1] - a[1])
      .slice(0, cap)
      .map(([key]) => key)

  // A place you go to every day is not a place, it is the baseline — an
  // automatic check-in at city granularity ("Bratislava, Bratislava", 53 days
  // here) has no other side to compare against, and the filter drops it.
  const placesToTest = pickPlaces(placeVisitDays, allDays.length, 3)
  const caffeinePlaces = pickPlaces(placeCaffeineDays, caffeineDayCount, 2)
  const placeName = (key: string) => placeLabels.get(key) ?? key

  const deriveInsights = (days: DayData[]): InsightResult[] => {
  const insights: InsightResult[] = []
  const byDate = Object.fromEntries(days.map(d => [d.date, d]))

  // Oura's sleep record dated D is the night that ENDED on morning D — the
  // record, its resting HR, its deep/REM minutes, and the readiness derived
  // from it all describe the night before day D. So for anything that
  // happened DURING day D (a coffee, a workout, a stressful afternoon, an
  // evening of screens), "that night's sleep" is the record dated D+1. Ten
  // families used to read the record dated D instead, which scored the
  // afternoon coffee against the sleep that had already happened.
  const tonight = (d: DayData): DayData | undefined => byDate[nextDateStr(d.date)]

  // 1. Sleep duration → next-day energy / mood
  const sleepDurEnergy = new Split()
  const sleepDurMood = new Split()
  // The check-in dated D is the morning that the sleep record dated D ended
  // on — the same morning, not the next one. Reading the check-in from D+1
  // compared each night with how the user felt after the FOLLOWING night.
  for (const d of days) {
    if (d.sleepDuration == null) continue
    const isHigh = d.sleepDuration >= 7
    if (d.energy != null) { if (isHigh) sleepDurEnergy.add(true, d.energy); else sleepDurEnergy.add(false, d.energy) }
    if (d.mood != null) { if (isHigh) sleepDurMood.add(true, d.mood); else sleepDurMood.add(false, d.mood) }
  }
  const ins_sleepDur_energy = compareGroups({
    id: "sleep_duration_energy", category: "sleep", emoji: "🌙", title: "Sleep Duration & Morning Energy",
    highGroupLabel: "7h+ sleep nights", lowGroupLabel: "under 7h sleep nights",
    series: sleepDurEnergy,
    findingTemplate: (h, l) => `After 7h+ sleep, your morning energy averages ${h} vs ${l} on shorter nights`,
  })
  if (ins_sleepDur_energy) insights.push(ins_sleepDur_energy)
  const ins_sleepDur_mood = compareGroups({
    id: "sleep_duration_mood", category: "sleep", emoji: "😊", title: "Sleep Duration & Morning Mood",
    highGroupLabel: "7h+ sleep nights", lowGroupLabel: "under 7h sleep nights",
    series: sleepDurMood,
    findingTemplate: (h, l) => `After 7h+ sleep, your morning mood averages ${h} vs ${l} after shorter nights`,
  })
  if (ins_sleepDur_mood) insights.push(ins_sleepDur_mood)

  // 2. Sleep score → next-day energy & mood
  const sleepScoreEnergy = new Split()
  const sleepScoreMood = new Split()
  for (const d of days) {
    if (d.sleepScore == null) continue
    const isHigh = d.sleepScore >= 80
    if (d.energy != null) { if (isHigh) sleepScoreEnergy.add(true, d.energy); else sleepScoreEnergy.add(false, d.energy) }
    if (d.mood != null) { if (isHigh) sleepScoreMood.add(true, d.mood); else sleepScoreMood.add(false, d.mood) }
  }
  const ins_sleepScore_energy = compareGroups({
    id: "sleep_score_energy", category: "sleep", emoji: "⚡", title: "Sleep Score & Morning Energy",
    highGroupLabel: "80+ sleep score nights", lowGroupLabel: "below 80 sleep score nights",
    series: sleepScoreEnergy,
    findingTemplate: (h, l) => `On high sleep score nights (80+), morning energy averages ${h} vs ${l}`,
  })
  if (ins_sleepScore_energy) insights.push(ins_sleepScore_energy)
  const ins_sleepScore_mood = compareGroups({
    id: "sleep_score_mood", category: "sleep", emoji: "🌟", title: "Sleep Score & Morning Mood",
    highGroupLabel: "80+ sleep score nights", lowGroupLabel: "below 80 sleep score nights",
    series: sleepScoreMood,
    findingTemplate: (h, l) => `On high sleep score nights (80+), morning mood averages ${h} vs ${l}`,
  })
  if (ins_sleepScore_mood) insights.push(ins_sleepScore_mood)

  // 3. Stress → same-night sleep score & next-day mood
  const stressSleep = new Split()
  const stressMood = new Split()
  for (const d of days) {
    if (d.stressHighMin == null) continue
    const isHigh = d.stressHighMin >= cuts.stress.at
    const next = tonight(d)
    if (next?.sleepScore != null) { if (isHigh) stressSleep.add(true, next.sleepScore); else stressSleep.add(false, next.sleepScore) }
    if (next?.mood != null) { if (isHigh) stressMood.add(true, next.mood); else stressMood.add(false, next.mood) }
  }
  const ins_stress_sleep = compareGroups({
    id: "stress_sleep", category: "stress", emoji: "😤", title: "High Stress & Sleep Quality",
    highGroupLabel: `${stressLabel} days`, lowGroupLabel: "low stress days",
    series: stressSleep, higherIsBetter: true,
    findingTemplate: (h, l) => `On high-stress days (${stressMinLabel}), your sleep score averages ${h} vs ${l} on calmer days`,
  })
  if (ins_stress_sleep) insights.push(ins_stress_sleep)
  const ins_stress_mood = compareGroups({
    id: "stress_mood", category: "stress", emoji: "🧘", title: "High Stress & Next-Day Mood",
    highGroupLabel: `${stressLabel} days`, lowGroupLabel: "low stress days",
    series: stressMood, higherIsBetter: true,
    findingTemplate: (h, l) => `After high-stress days (${stressMinLabel}), next-day mood averages ${h} vs ${l} after calm days`,
  })
  if (ins_stress_mood) insights.push(ins_stress_mood)

  // 4. Habit count → same-day mood & energy
  const habitCounts = days.filter(d => d.habitCount != null).map(d => d.habitCount!)
  const habitMedian = habitCounts.length >= 3 ? median(habitCounts) : 3
  const habitThreshold = Math.max(3, habitMedian)
  const habitMood = new Split()
  const habitEnergy = new Split()
  for (const d of days) {
    if (d.habitCount == null) continue
    const isHigh = d.habitCount >= habitThreshold
    if (d.mood != null) { if (isHigh) habitMood.add(true, d.mood); else habitMood.add(false, d.mood) }
    if (d.energy != null) { if (isHigh) habitEnergy.add(true, d.energy); else habitEnergy.add(false, d.energy) }
  }
  const habitLabel = `${habitThreshold}+ habits completed`
  const ins_habit_mood = compareGroups({
    id: "habits_mood", category: "habits", emoji: "✅", title: "Habit Completion & Mood",
    highGroupLabel: habitLabel, lowGroupLabel: `fewer than ${habitThreshold} habits`,
    series: habitMood,
    findingTemplate: (h, l) => `On days you complete ${habitThreshold}+ habits, mood averages ${h} vs ${l} on lower-completion days`,
  })
  if (ins_habit_mood) insights.push(ins_habit_mood)
  const ins_habit_energy = compareGroups({
    id: "habits_energy", category: "habits", emoji: "🎯", title: "Habit Completion & Energy",
    highGroupLabel: habitLabel, lowGroupLabel: `fewer than ${habitThreshold} habits`,
    series: habitEnergy,
    findingTemplate: (h, l) => `On days you complete ${habitThreshold}+ habits, morning energy averages ${h} vs ${l}`,
  })
  if (ins_habit_energy) insights.push(ins_habit_energy)

  // 5. Caffeine → same-night sleep score
  const caffeineSleep = new Split()
  for (const d of days) {
    const night = tonight(d)
    if (d.caffeineMg == null || night?.sleepScore == null) continue
    if (d.caffeineMg >= cuts.caffeine.at) caffeineSleep.add(true, night.sleepScore)
    else caffeineSleep.add(false, night.sleepScore)
  }
  const ins_caffeine_sleep = compareGroups({
    id: "caffeine_sleep", category: "caffeine", emoji: "☕", title: "Caffeine Intake & Sleep Quality",
    highGroupLabel: `${cafLabel} caffeine days`, lowGroupLabel: `${cafUnderLabel} caffeine days`,
    series: caffeineSleep,
    // One sentence rather than two branches. The old negative branch opened
    // "Interestingly," — editorialising a null result, which is the case the
    // engine has least business having an opinion about. The two numbers say
    // which way it went without being told.
    findingTemplate: (h, l) => `Nights after ${cafLabel} of caffeine score ${h}; after less, ${l}`,
  })
  if (ins_caffeine_sleep) insights.push(ins_caffeine_sleep)

  // 6. Alcohol → next-day HRV and sleep
  const alcoholHrv = new Split()
  const alcoholSleepEff = new Split()
  for (const d of days) {
    const drank = (d.alcoholG ?? 0) >= STANDARD_DRINK_G
    const next = byDate[nextDateStr(d.date)]
    if (!next) continue
    if (next.hrv != null) { if (drank) alcoholHrv.add(true, next.hrv); else alcoholHrv.add(false, next.hrv) }
    if (next.sleepScore != null) { if (drank) alcoholSleepEff.add(true, next.sleepScore); else alcoholSleepEff.add(false, next.sleepScore) }
  }
  const ins_alcohol_hrv = compareGroups({
    id: "alcohol_hrv", category: "caffeine", emoji: "🍷", title: "Alcohol & Next-Day HRV",
    highGroupLabel: DRINKING_DAYS_LABEL, lowGroupLabel: "non-drinking days",
    series: alcoholHrv, higherIsBetter: false,
    findingTemplate: (h, l) =>
      h < l
        ? `After drinking, your HRV drops to ${h}ms vs ${l}ms on sober nights`
        : `Drinking days don't show an HRV penalty — ${h}ms vs ${l}ms baseline`,
  })
  if (ins_alcohol_hrv) insights.push(ins_alcohol_hrv)
  const ins_alcohol_sleep = compareGroups({
    id: "alcohol_sleep", category: "caffeine", emoji: "🍺", title: "Alcohol & Sleep Quality",
    highGroupLabel: DRINKING_DAYS_LABEL, lowGroupLabel: "non-drinking days",
    series: alcoholSleepEff, higherIsBetter: false,
    findingTemplate: (h, l) =>
      h < l
        ? `After drinking, sleep score averages ${h} vs ${l} on sober nights`
        : `Drinking days don't show a sleep penalty — score ${h} vs ${l}`,
  })
  if (ins_alcohol_sleep) insights.push(ins_alcohol_sleep)

  // 6a/6b. Sleep duration & alcohol → next-day resting HR
  const sleepRhr = new Split()
  const alcoholRhrDrinkSplit = new Split()
  for (const d of days) {
    // Resting HR on record D was measured during the night record D
    // describes — the same night as its sleep duration, not the one after.
    if (d.sleepDuration != null && d.restingHR != null) {
      if (d.sleepDuration >= 7) sleepRhr.add(true, d.restingHR)
      else sleepRhr.add(false, d.restingHR)
    }
    const next = tonight(d)
    if (!next || next.restingHR == null) continue
    if (d.alcoholG != null || d.sleepDuration != null) {
      const drank = (d.alcoholG ?? 0) >= STANDARD_DRINK_G
      if (drank) alcoholRhrDrinkSplit.add(true, next.restingHR)
      else alcoholRhrDrinkSplit.add(false, next.restingHR)
    }
  }
  const ins_sleep_rhr = compareGroups({
    id: "sleep_resting_hr", category: "recovery", emoji: "❤️", title: "Sleep Duration & Resting Heart Rate",
    highGroupLabel: "after 7h+ sleep", lowGroupLabel: "after under 7h",
    series: sleepRhr, higherIsBetter: false,
    findingTemplate: (h, l) =>
      h < l
        ? `After 7h+ sleep, your resting HR averages ${h} bpm vs ${l} bpm on shorter nights`
        : `Sleep length doesn't move your resting HR much — ${h} bpm vs ${l} bpm`,
  })
  if (ins_sleep_rhr) insights.push(ins_sleep_rhr)
  const ins_alcohol_rhr = compareGroups({
    id: "alcohol_resting_hr", category: "recovery", emoji: "🍷", title: "Alcohol & Resting Heart Rate",
    highGroupLabel: DRINKING_DAYS_LABEL, lowGroupLabel: "non-drinking days",
    series: alcoholRhrDrinkSplit, higherIsBetter: false,
    findingTemplate: (h, l) =>
      h > l
        ? `After drinking, your resting HR rises to ${h} bpm vs ${l} bpm on sober nights`
        : `Drinking days don't elevate your resting HR — ${h} bpm vs ${l} bpm`,
  })
  if (ins_alcohol_rhr) insights.push(ins_alcohol_rhr)

  // 6c. Activity (steps) → that-night sleep & next-day readiness
  const STEP_HIGH = 8000
  const activeSleep = new Split()
  const activeReadiness = new Split()
  for (const d of days) {
    if (d.steps == null) continue
    const isActive = d.steps >= STEP_HIGH
    const next = tonight(d)
    if (next?.sleepScore != null) { if (isActive) activeSleep.add(true, next.sleepScore); else activeSleep.add(false, next.sleepScore) }
    if (next?.readiness != null) { if (isActive) activeReadiness.add(true, next.readiness); else activeReadiness.add(false, next.readiness) }
  }
  const ins_active_sleep = compareGroups({
    id: "activity_sleep", category: "recovery", emoji: "🚶", title: "Activity Load & Sleep Quality",
    highGroupLabel: "active days (8k+ steps)", lowGroupLabel: "lower-activity days",
    series: activeSleep, higherIsBetter: true,
    findingTemplate: (h, l) =>
      h > l
        ? `On active days (8k+ steps), your sleep score averages ${h} vs ${l} on quieter days`
        : `More steps don't improve your sleep score — ${h} vs ${l}`,
  })
  if (ins_active_sleep) insights.push(ins_active_sleep)
  const ins_active_readiness = compareGroups({
    id: "activity_readiness", category: "recovery", emoji: "🔋", title: "Activity Load & Next-Day Readiness",
    highGroupLabel: "active days (8k+ steps)", lowGroupLabel: "lower-activity days",
    series: activeReadiness, higherIsBetter: true,
    findingTemplate: (h, l) =>
      h >= l
        ? `After active days (8k+ steps), next-day readiness averages ${h}; after quieter days, ${l}`
        : `After active days (8k+ steps), next-day readiness drops to ${h}; after quieter days, ${l}`,
  })
  if (ins_active_readiness) insights.push(ins_active_readiness)

  // 6d. High stress → same-day HRV
  const stressHrv = new Split()
  for (const d of days) {
    if (d.stressHighMin == null || d.hrv == null) continue
    if (d.stressHighMin >= cuts.stress.at) stressHrv.add(true, d.hrv)
    else stressHrv.add(false, d.hrv)
  }
  const ins_stress_hrv = compareGroups({
    id: "stress_hrv", category: "recovery", emoji: "💓", title: "High Stress & HRV",
    highGroupLabel: stressLabel, lowGroupLabel: "calmer days",
    series: stressHrv, higherIsBetter: true,
    findingTemplate: (h, l) =>
      h < l
        ? `On high-stress days, your HRV averages ${h}ms vs ${l}ms on calmer days`
        : `High-stress days don't suppress your HRV — ${h}ms vs ${l}ms`,
  })
  if (ins_stress_hrv) insights.push(ins_stress_hrv)

  // 6e. Caffeine → next-day readiness
  const caffeineReadiness = new Split()
  for (const d of days) {
    if (d.caffeineMg == null) continue
    const next = byDate[nextDateStr(d.date)]
    if (next?.readiness == null) continue
    if (d.caffeineMg >= cuts.caffeine.at) caffeineReadiness.add(true, next.readiness)
    else caffeineReadiness.add(false, next.readiness)
  }
  const ins_caffeine_readiness = compareGroups({
    id: "caffeine_readiness", category: "recovery", emoji: "☕", title: "Caffeine & Next-Day Readiness",
    highGroupLabel: `${cafLabel} caffeine days`, lowGroupLabel: `${cafUnderLabel} days`,
    series: caffeineReadiness, higherIsBetter: true,
    findingTemplate: (h, l) =>
      h < l
        ? `After ${cafLabel} caffeine, next-day readiness averages ${h} vs ${l} on lower-caffeine days`
        : `Higher caffeine days don't dent your readiness — ${h} vs ${l}`,
  })
  if (ins_caffeine_readiness) insights.push(ins_caffeine_readiness)

  // 7. Tag insights — top 5 most common tags
  const tagCounts: Record<string, number> = {}
  for (const d of days) {
    for (const tag of d.tags ?? []) tagCounts[tag] = (tagCounts[tag] ?? 0) + 1
  }
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([tag]) => tag)
  for (const tag of topTags) {
    const tagMood = new Split()
    const tagEnergy = new Split()
    for (const d of days) {
      const hasTag = (d.tags ?? []).includes(tag)
      if (d.mood != null) { if (hasTag) tagMood.add(true, d.mood); else tagMood.add(false, d.mood) }
      if (d.energy != null) { if (hasTag) tagEnergy.add(true, d.energy); else tagEnergy.add(false, d.energy) }
    }
    const safeTag = tag.toLowerCase().replace(/[^a-z0-9]/g, "_")
    const ins_tag_mood = compareGroups({
      id: `tag_${safeTag}_mood`, category: "tags", emoji: "🏷️", title: `"${tag}" Days & Mood`,
      highGroupLabel: `${tag} days`, lowGroupLabel: `non-${tag} days`,
      series: tagMood,
      findingTemplate: (h, l) => `On "${tag}" days, mood averages ${h} vs ${l} on other days`,
    })
    if (ins_tag_mood) insights.push(ins_tag_mood)
    const ins_tag_energy = compareGroups({
      id: `tag_${safeTag}_energy`, category: "tags", emoji: "⚡", title: `"${tag}" Days & Energy`,
      highGroupLabel: `${tag} days`, lowGroupLabel: `non-${tag} days`,
      series: tagEnergy,
      findingTemplate: (h, l) => `On "${tag}" days, morning energy averages ${h} vs ${l} on other days`,
    })
    if (ins_tag_energy) insights.push(ins_tag_energy)
  }

  // 8. Weather
  const daysWithWeather = days.filter(d => d.precipMm != null || d.tempMaxC != null)
  if (daysWithWeather.length >= 10) {
    const rainSleepSplit = new Split()
    const rainMoodSplit = new Split()
    for (const d of daysWithWeather) {
      if (d.precipMm == null) continue
      const isRainy = d.precipMm > 1
      const next = tonight(d)
      if (next?.sleepScore != null) { if (isRainy) rainSleepSplit.add(true, next.sleepScore); else rainSleepSplit.add(false, next.sleepScore) }
      if (next?.mood != null) { if (isRainy) rainMoodSplit.add(true, next.mood); else rainMoodSplit.add(false, next.mood) }
    }
    const ins_rain_sleep = compareGroups({
      id: "rain_sleep", category: "tags", emoji: "🌧️", title: "Rainy Days & Sleep Quality",
      highGroupLabel: "rainy days", lowGroupLabel: "dry days",
      series: rainSleepSplit, higherIsBetter: true,
      findingTemplate: (h, l) =>
        h > l
          ? `You sleep better on rainy nights — sleep score ${h} vs ${l} on dry nights`
          : `Rainy nights don't improve sleep — score ${h} vs ${l} on dry nights`,
    })
    if (ins_rain_sleep) insights.push(ins_rain_sleep)
    const ins_rain_mood = compareGroups({
      id: "rain_mood", category: "tags", emoji: "⛅", title: "Weather & Morning Mood",
      highGroupLabel: "rainy days", lowGroupLabel: "dry days",
      series: rainMoodSplit, higherIsBetter: false,
      findingTemplate: (h, l) =>
        h < l
          ? `After rainy days, morning mood averages ${h} vs ${l} after dry days`
          : `Rain doesn't dampen your mood — ${h} vs ${l} on dry days`,
    })
    if (ins_rain_mood) insights.push(ins_rain_mood)
    const hotStepsSplit = new Split()
    for (const d of daysWithWeather) {
      if (d.tempMaxC == null || d.steps == null) continue
      if (d.tempMaxC >= cuts.heat.at) hotStepsSplit.add(true, d.steps)
      else hotStepsSplit.add(false, d.steps)
    }
    const ins_heat_steps = compareGroups({
      id: "heat_steps", category: "tags", emoji: "🌡️", title: "Hot Days & Step Count",
      highGroupLabel: `hot days (${heatLabel})`, lowGroupLabel: "cooler days",
      series: hotStepsSplit, higherIsBetter: true,
      findingTemplate: (h, l) =>
        h > l
          ? `You walk more on hot days — ${Math.round(h).toLocaleString()} steps vs ${Math.round(l).toLocaleString()} on cooler days`
          : `You walk more on cooler days — ${Math.round(l).toLocaleString()} steps vs ${Math.round(h).toLocaleString()} when it's hot`,
    })
    if (ins_heat_steps) insights.push(ins_heat_steps)
  }

  // 9. Screen time → sleep & next-day energy/mood/readiness
  const screenVals = days.filter(d => d.screenTimeMin != null).map(d => d.screenTimeMin!)
  if (screenVals.length >= 10) {
    const screenMedian = median(screenVals)
    const fmtH = (min: number) => (min >= 60 ? `${(min / 60).toFixed(1)}h` : `${Math.round(min)}m`)
    const screenSleep = new Split()
    const screenEnergy = new Split()
    const screenMood = new Split()
    const screenReadiness = new Split()
    for (const d of days) {
      if (d.screenTimeMin == null) continue
      const isHigh = d.screenTimeMin >= screenMedian
      const next = tonight(d)
      if (next?.sleepScore != null) { if (isHigh) screenSleep.add(true, next.sleepScore); else screenSleep.add(false, next.sleepScore) }
      if (next?.energy != null) { if (isHigh) screenEnergy.add(true, next.energy); else screenEnergy.add(false, next.energy) }
      if (next?.mood != null) { if (isHigh) screenMood.add(true, next.mood); else screenMood.add(false, next.mood) }
      if (next?.readiness != null) { if (isHigh) screenReadiness.add(true, next.readiness); else screenReadiness.add(false, next.readiness) }
    }
    const ins_screen_sleep = compareGroups({
      id: "screen_sleep", category: "screen", emoji: "📱", title: "Screen Time & Sleep Quality",
      highGroupLabel: `high screen days (${fmtH(screenMedian)}+)`, lowGroupLabel: "lower screen days",
      series: screenSleep, higherIsBetter: true,
      findingTemplate: (h, l) =>
        h < l
          ? `On high screen-time days (${fmtH(screenMedian)}+), your sleep score averages ${h} vs ${l} on lighter days`
          : `More screen time doesn't hurt your sleep score — ${h} vs ${l}`,
    })
    if (ins_screen_sleep) insights.push(ins_screen_sleep)
    const ins_screen_energy = compareGroups({
      id: "screen_energy", category: "screen", emoji: "🔌", title: "Screen Time & Next-Day Energy",
      highGroupLabel: `high screen days (${fmtH(screenMedian)}+)`, lowGroupLabel: "lower screen days",
      series: screenEnergy, higherIsBetter: true,
      findingTemplate: (h, l) =>
        h < l
          ? `After high screen-time days, next-day energy averages ${h} vs ${l} after lighter days`
          : `Screen time doesn't dent your next-day energy — ${h} vs ${l}`,
    })
    if (ins_screen_energy) insights.push(ins_screen_energy)
    const ins_screen_mood = compareGroups({
      id: "screen_mood", category: "screen", emoji: "🙂", title: "Screen Time & Next-Day Mood",
      highGroupLabel: `high screen days (${fmtH(screenMedian)}+)`, lowGroupLabel: "lower screen days",
      series: screenMood, higherIsBetter: true,
      findingTemplate: (h, l) =>
        h < l
          ? `After high screen-time days, next-day mood averages ${h} vs ${l} after lighter days`
          : `Screen time doesn't dent your next-day mood — ${h} vs ${l}`,
    })
    if (ins_screen_mood) insights.push(ins_screen_mood)
    const ins_screen_readiness = compareGroups({
      id: "screen_readiness", category: "screen", emoji: "🔋", title: "Screen Time & Next-Day Readiness",
      highGroupLabel: `high screen days (${fmtH(screenMedian)}+)`, lowGroupLabel: "lower screen days",
      series: screenReadiness, higherIsBetter: true,
      findingTemplate: (h, l) =>
        h < l
          ? `After high screen-time days, next-day readiness averages ${h} vs ${l}`
          : `Screen time doesn't dent your next-day readiness — ${h} vs ${l}`,
    })
    if (ins_screen_readiness) insights.push(ins_screen_readiness)
  }

  // 10. Wake time (first phone unlock) → morning energy & mood
  const wakeVals = days.filter(d => d.firstUnlockMin != null).map(d => d.firstUnlockMin!)
  if (wakeVals.length >= 10) {
    const wakeMedian = median(wakeVals)
    const fmtClock = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`
    const earlyEnergySplit = new Split()
    const earlyMoodSplit = new Split()
    for (const d of days) {
      if (d.firstUnlockMin == null) continue
      const isEarly = d.firstUnlockMin < wakeMedian
      if (d.energy != null) { if (isEarly) earlyEnergySplit.add(true, d.energy); else earlyEnergySplit.add(false, d.energy) }
      if (d.mood != null) { if (isEarly) earlyMoodSplit.add(true, d.mood); else earlyMoodSplit.add(false, d.mood) }
    }
    const ins_wake_energy = compareGroups({
      id: "wake_energy", category: "screen", emoji: "🌅", title: "Wake Time & Morning Energy",
      highGroupLabel: `early starts (before ${fmtClock(wakeMedian)})`, lowGroupLabel: "later starts",
      series: earlyEnergySplit, higherIsBetter: true,
      findingTemplate: (h, l) =>
        h > l
          ? `On days you reach for your phone before ${fmtClock(wakeMedian)}, morning energy averages ${h} vs ${l} on later starts`
          : `Earlier starts don't boost your energy — ${h} vs ${l} on later starts`,
    })
    if (ins_wake_energy) insights.push(ins_wake_energy)
    const ins_wake_mood = compareGroups({
      id: "wake_mood", category: "screen", emoji: "☀️", title: "Wake Time & Morning Mood",
      highGroupLabel: `early starts (before ${fmtClock(wakeMedian)})`, lowGroupLabel: "later starts",
      series: earlyMoodSplit, higherIsBetter: true,
      findingTemplate: (h, l) =>
        h > l
          ? `On earlier starts (before ${fmtClock(wakeMedian)}), morning mood averages ${h} vs ${l} on later starts`
          : `Earlier starts don't lift your mood — ${h} vs ${l} on later starts`,
    })
    if (ins_wake_mood) insights.push(ins_wake_mood)
  }

  // 11. Calendar load → sleep & next-day energy/mood (busy vs quiet days)
  const loadVals = days.filter(d => d.eventCount != null).map(d => d.eventCount!)
  if (loadVals.length >= 10) {
    const loadMedian = Math.max(1, median(loadVals))
    const busySleepSplit = new Split()
    const busyEnergySplit = new Split()
    const busyMoodSplit = new Split()
    for (const d of days) {
      if (d.eventCount == null && !calendarCovers(d.date)) continue // unknown, not quiet
      const load = d.eventCount ?? 0
      const isBusy = load >= loadMedian && load > 0
      const next = tonight(d)
      if (next?.sleepScore != null) { if (isBusy) busySleepSplit.add(true, next.sleepScore); else busySleepSplit.add(false, next.sleepScore) }
      if (next?.energy != null) { if (isBusy) busyEnergySplit.add(true, next.energy); else busyEnergySplit.add(false, next.energy) }
      if (next?.mood != null) { if (isBusy) busyMoodSplit.add(true, next.mood); else busyMoodSplit.add(false, next.mood) }
    }
    const ins_load_sleep = compareGroups({
      id: "calendar_load_sleep", category: "calendar", emoji: "🗓️", title: "Busy Days & Sleep",
      highGroupLabel: `busy days (${loadMedian}+ events)`, lowGroupLabel: "quieter days",
      series: busySleepSplit, higherIsBetter: true,
      findingTemplate: (h, l) =>
        h < l
          ? `On busier days (${loadMedian}+ events), your sleep score averages ${h} vs ${l} on quieter days`
          : `A packed calendar doesn't hurt your sleep — ${h} vs ${l}`,
    })
    if (ins_load_sleep) insights.push(ins_load_sleep)
    const ins_load_energy = compareGroups({
      id: "calendar_load_energy", category: "calendar", emoji: "🗓️", title: "Busy Days & Next-Day Energy",
      highGroupLabel: `busy days (${loadMedian}+ events)`, lowGroupLabel: "quieter days",
      series: busyEnergySplit, higherIsBetter: true,
      findingTemplate: (h, l) =>
        h < l
          ? `After busy days, next-day energy averages ${h} vs ${l} after quieter ones`
          : `Busy days don't drain your next-day energy — ${h} vs ${l}`,
    })
    if (ins_load_energy) insights.push(ins_load_energy)
    const ins_load_mood = compareGroups({
      id: "calendar_load_mood", category: "calendar", emoji: "🗓️", title: "Busy Days & Next-Day Mood",
      highGroupLabel: `busy days (${loadMedian}+ events)`, lowGroupLabel: "quieter days",
      series: busyMoodSplit, higherIsBetter: true,
      findingTemplate: (h, l) =>
        h < l
          ? `After busy days, next-day mood averages ${h} vs ${l} after quieter ones`
          : `Busy days don't dent your next-day mood — ${h} vs ${l}`,
    })
    if (ins_load_mood) insights.push(ins_load_mood)
  }

  // 12. Per-activity — auto-discover recurring event titles (e.g. "Záhrada")
  // and compare days that have them vs days that don't. No hardcoded keywords:
  // the activities surface from whatever recurs on your own calendar.
  const dayCountByTitle = new Map<string, number>()
  for (const d of days) {
    for (const t of new Set((d.eventTitles ?? []).filter(Boolean))) {
      dayCountByTitle.set(t, (dayCountByTitle.get(t) ?? 0) + 1)
    }
  }
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "x"
  const frequentTitles = [...dayCountByTitle.entries()]
    .filter(([t, n]) => t.length >= 2 && n >= 5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([t]) => t)
  for (const title of frequentTitles) {
    const withStepsSplit = new Split()
    const withEnergySplit = new Split()
    for (const d of days) {
      const has = (d.eventTitles ?? []).some(t => t === title)
      if (d.steps != null) { if (has) withStepsSplit.add(true, d.steps); else withStepsSplit.add(false, d.steps) }
      const next = byDate[nextDateStr(d.date)]
      if (next?.energy != null) { if (has) withEnergySplit.add(true, next.energy); else withEnergySplit.add(false, next.energy) }
    }
    const ins_act_steps = compareGroups({
      id: `calendar_${slug(title)}_steps`, category: "calendar", emoji: "📅", title: `"${title}" days & Steps`,
      highGroupLabel: `"${title}" days`, lowGroupLabel: "other days",
      series: withStepsSplit, higherIsBetter: true,
      findingTemplate: (h, l) =>
        `You average ${Math.round(h).toLocaleString()} steps on "${title}" days; ${Math.round(l).toLocaleString()} on other days`,
    })
    if (ins_act_steps) insights.push(ins_act_steps)
    const ins_act_energy = compareGroups({
      id: `calendar_${slug(title)}_energy`, category: "calendar", emoji: "📅", title: `"${title}" days & Next-Day Energy`,
      highGroupLabel: `"${title}" days`, lowGroupLabel: "other days",
      series: withEnergySplit, higherIsBetter: true,
      findingTemplate: (h, l) =>
        h > l
          ? `The day after "${title}", energy averages ${h} vs ${l} otherwise`
          : `"${title}" days don't lift your next-day energy — ${h} vs ${l}`,
    })
    if (ins_act_energy) insights.push(ins_act_energy)
  }

  // 13. Food (photo-logged meals) — timing, protein, calories, sugar
  const foodDays = days.filter(d => d.calories != null)
  if (foodDays.length >= 10) {
    // 13a. Late eating → that night's sleep
    const LATE_MEAL_MIN = 20 * 60
    const lateSleepSplit = new Split()
    for (const d of foodDays) {
      if (d.lastMealMin == null) continue
      const night = byDate[nextDateStr(d.date)]
      if (night?.sleepScore == null) continue
      if (d.lastMealMin >= LATE_MEAL_MIN) lateSleepSplit.add(true, night.sleepScore)
      else lateSleepSplit.add(false, night.sleepScore)
    }
    const ins_late_meal = compareGroups({
      id: "food_late_meal_sleep", category: "food", emoji: "🌙", title: "Late Meals & Sleep Quality",
      highGroupLabel: "last meal after 20:00", lowGroupLabel: "earlier dinners",
      series: lateSleepSplit, higherIsBetter: true,
      findingTemplate: (h, l) =>
        h < l
          ? `When your last meal is after 20:00, that night's sleep score averages ${h} vs ${l} after earlier dinners`
          : `Late dinners don't hurt your sleep — score ${h} vs ${l} after earlier meals`,
    })
    if (ins_late_meal) insights.push(ins_late_meal)

    // 13b. Protein → next-day energy
    const proteinVals = foodDays.filter(d => d.proteinG != null).map(d => d.proteinG!)
    if (proteinVals.length >= 10) {
      const proteinMedian = median(proteinVals)
      const highProtEnergySplit = new Split()
      for (const d of foodDays) {
        if (d.proteinG == null) continue
        const next = byDate[nextDateStr(d.date)]
        if (next?.energy == null) continue
        if (d.proteinG >= proteinMedian) highProtEnergySplit.add(true, next.energy)
        else highProtEnergySplit.add(false, next.energy)
      }
      const ins_protein_energy = compareGroups({
        id: "food_protein_energy", category: "food", emoji: "🥩", title: "Protein & Next-Day Energy",
        highGroupLabel: `${Math.round(proteinMedian)}g+ protein days`, lowGroupLabel: "lower-protein days",
        series: highProtEnergySplit,
        findingTemplate: (h, l) =>
          h > l
            ? `After higher-protein days (${Math.round(proteinMedian)}g+), morning energy averages ${h} vs ${l}`
            : `More protein doesn't move your morning energy — ${h} vs ${l}`,
      })
      if (ins_protein_energy) insights.push(ins_protein_energy)
    }

    // 13c. Calories → that night's sleep
    const calMedian = median(foodDays.map(d => d.calories!))
    const highCalSleepSplit = new Split()
    for (const d of foodDays) {
      const night = byDate[nextDateStr(d.date)]
      if (night?.sleepScore == null) continue
      if (d.calories! >= calMedian) highCalSleepSplit.add(true, night.sleepScore)
      else highCalSleepSplit.add(false, night.sleepScore)
    }
    const ins_cal_sleep = compareGroups({
      id: "food_calories_sleep", category: "food", emoji: "🔥", title: "Calorie Load & Sleep Quality",
      highGroupLabel: `${Math.round(calMedian)}+ kcal days`, lowGroupLabel: "lighter days",
      series: highCalSleepSplit, higherIsBetter: true,
      findingTemplate: (h, l) =>
        h < l
          ? `After heavier days (${Math.round(calMedian)}+ kcal), sleep score averages ${h} vs ${l} after lighter days`
          : `Bigger eating days don't hurt your sleep — ${h} vs ${l}`,
    })
    if (ins_cal_sleep) insights.push(ins_cal_sleep)

    // 13d. Sugar → next-day energy & mood
    const sugarVals = foodDays.filter(d => d.sugarG != null).map(d => d.sugarG!)
    if (sugarVals.length >= 10) {
      const sugarMedian = median(sugarVals)
      const highSugarEnergySplit = new Split()
      const highSugarMoodSplit = new Split()
      for (const d of foodDays) {
        if (d.sugarG == null) continue
        const next = byDate[nextDateStr(d.date)]
        if (!next) continue
        const isHigh = d.sugarG >= sugarMedian
        if (next.energy != null) { if (isHigh) highSugarEnergySplit.add(true, next.energy); else highSugarEnergySplit.add(false, next.energy) }
        if (next.mood != null) { if (isHigh) highSugarMoodSplit.add(true, next.mood); else highSugarMoodSplit.add(false, next.mood) }
      }
      const ins_sugar_energy = compareGroups({
        id: "food_sugar_energy", category: "food", emoji: "🍬", title: "Sugar & Next-Day Energy",
        highGroupLabel: `${Math.round(sugarMedian)}g+ sugar days`, lowGroupLabel: "lower-sugar days",
        series: highSugarEnergySplit,
        findingTemplate: (h, l) =>
          h < l
            ? `After higher-sugar days (${Math.round(sugarMedian)}g+), morning energy averages ${h} vs ${l}`
            : `Sugar days don't dent your next-day energy — ${h} vs ${l}`,
      })
      if (ins_sugar_energy) insights.push(ins_sugar_energy)
      const ins_sugar_mood = compareGroups({
        id: "food_sugar_mood", category: "food", emoji: "🍭", title: "Sugar & Next-Day Mood",
        highGroupLabel: `${Math.round(sugarMedian)}g+ sugar days`, lowGroupLabel: "lower-sugar days",
        series: highSugarMoodSplit,
        findingTemplate: (h, l) =>
          h < l
            ? `After higher-sugar days (${Math.round(sugarMedian)}g+), morning mood averages ${h} vs ${l}`
            : `Sugar days don't dent your next-day mood — ${h} vs ${l}`,
      })
      if (ins_sugar_mood) insights.push(ins_sugar_mood)
    }
  }

  // 14. Hydration → next-day energy & readiness (the app has always tracked
  // water; this is the first time it checks whether it matters)
  const hydratedEnergySplit = new Split()
  const hydratedReadinessSplit = new Split()
  for (const d of days) {
    if (d.waterMl == null) continue
    const next = byDate[nextDateStr(d.date)]
    if (!next) continue
    const hydrated = d.waterMl >= cuts.water.at
    if (next.energy != null) { if (hydrated) hydratedEnergySplit.add(true, next.energy); else hydratedEnergySplit.add(false, next.energy) }
    if (next.readiness != null) { if (hydrated) hydratedReadinessSplit.add(true, next.readiness); else hydratedReadinessSplit.add(false, next.readiness) }
  }
  const ins_water_energy = compareGroups({
    id: "water_energy", category: "food", emoji: "💧", title: "Hydration & Next-Day Energy",
    highGroupLabel: `${waterLabel}+ water days`, lowGroupLabel: `under ${waterLabel} days`,
    series: hydratedEnergySplit,
    findingTemplate: (h, l) =>
      h > l
        ? `After ${waterLabel}+ water days, morning energy averages ${h} vs ${l} after drier days`
        : `Hitting ${waterLabel} doesn't move your morning energy — ${h} vs ${l}`,
  })
  if (ins_water_energy) insights.push(ins_water_energy)
  const ins_water_readiness = compareGroups({
    id: "water_readiness", category: "food", emoji: "🚰", title: "Hydration & Next-Day Readiness",
    highGroupLabel: `${waterLabel}+ water days`, lowGroupLabel: `under ${waterLabel} days`,
    series: hydratedReadinessSplit,
    findingTemplate: (h, l) =>
      h > l
        ? `After ${waterLabel}+ water days, next-day readiness averages ${h} vs ${l}`
        : `Hydration doesn't show up in your readiness — ${h} vs ${l}`,
  })
  if (ins_water_readiness) insights.push(ins_water_readiness)

  // 15. Supplements (Oura tags) → next-morning sleep score & HRV. Evening
  // supplements affect the night that follows, so both use the next day's
  // recordings. Auto-discovers whatever the user actually takes.
  const suppDayCount = new Map<string, number>()
  for (const d of days) {
    for (const s of d.supplements ?? []) suppDayCount.set(s, (suppDayCount.get(s) ?? 0) + 1)
  }
  const topSupps = [...suppDayCount.entries()]
    .filter(([, n]) => n >= 5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([s]) => s)
  const suppSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "x"

  // Presence isn't binary for anything with a long half-life. Elicea sits at
  // ~30 h and Mirzaten ~26 h, so the night after one missed dose still has
  // most of the drug on board — calling that an "off" day compares a
  // three-quarters-medicated night against a fully-medicated one and finds
  // nothing. Where the half-life is known, days are scored by how much is
  // estimated to still be circulating (a dose decayed across the preceding
  // days) and split at the median, which turns a real multi-day gap into a
  // genuine off-period and leaves single misses where they belong: mostly on.
  // Substances without a meaningful single half-life — vitamin D, omega-3,
  // anything stored — keep the honest binary comparison.
  const RESIDUAL_LOOKBACK_DAYS = 10
  const NEGLIGIBLE_LEVEL = 0.15 // in dose-units; below this it's effectively gone

  function residualLevels(supp: string, halfLifeH: number): number[] {
    return days.map((_, i) => {
      let level = 0
      for (let back = 0; back <= RESIDUAL_LOOKBACK_DAYS && i - back >= 0; back++) {
        if ((days[i - back].supplements ?? []).includes(supp)) {
          level += Math.pow(0.5, (back * 24) / halfLifeH)
        }
      }
      return level
    })
  }

  for (const supp of topSupps) {
    const halfLifeH = supplementInfoFor(supp)?.halfLifeH
    let onBoard: (dayIndex: number) => boolean = () => false
    let highLabel = `${supp} days`
    let lowLabel = `days without ${supp}`
    let levelBased = false

    if (halfLifeH) {
      const levels = residualLevels(supp, halfLifeH)
      const sorted = [...levels].sort((a, b) => a - b)
      const lowQ = sorted[Math.floor(sorted.length * 0.25)]
      const highQ = sorted[Math.floor(sorted.length * 0.75)]
      // Only worth doing when the level actually varies — someone with perfect
      // adherence has no off-period to compare against, and splitting a flat
      // line at its median just manufactures two identical groups.
      if (highQ > Math.max(lowQ * 1.5, NEGLIGIBLE_LEVEL)) {
        const cut = Math.max(median(levels), NEGLIGIBLE_LEVEL)
        onBoard = i => levels[i] >= cut
        highLabel = `${supp} still on board`
        lowLabel = `after it cleared`
        levelBased = true
      }
    }
    if (!levelBased) {
      onBoard = i => (days[i].supplements ?? []).includes(supp)
    }

    const withSleepSplit = new Split()
    const withHrvSplit = new Split()
    const withDeepSplit = new Split()
    const withRemSplit = new Split()
    for (let i = 0; i < days.length; i++) {
      const d = days[i]
      const took = onBoard(i)
      const next = byDate[nextDateStr(d.date)]
      if (!next) continue
      if (next.sleepScore != null) { if (took) withSleepSplit.add(true, next.sleepScore); else withSleepSplit.add(false, next.sleepScore) }
      if (next.hrv != null) { if (took) withHrvSplit.add(true, next.hrv); else withHrvSplit.add(false, next.hrv) }
      if (next.deepSleepMin != null) { if (took) withDeepSplit.add(true, next.deepSleepMin); else withDeepSplit.add(false, next.deepSleepMin) }
      if (next.remSleepMin != null) { if (took) withRemSplit.add(true, next.remSleepMin); else withRemSplit.add(false, next.remSleepMin) }
    }
    const ins_supp_sleep = compareGroups({
      id: `supplement_${suppSlug(supp)}_sleep`, category: "supplements", emoji: "💊", title: `${supp} & Sleep Quality`,
      highGroupLabel: highLabel, lowGroupLabel: lowLabel,
      series: withSleepSplit,
      findingTemplate: (h, l) =>
        h > l
          ? `${levelBased ? `While ${supp} was still circulating` : `On nights after taking ${supp}`}, sleep score averages ${h} vs ${l} ${levelBased ? "once it cleared" : "without it"}`
          : `${supp} doesn't show a sleep benefit yet — ${h} vs ${l} ${levelBased ? "once it cleared" : "without it"}`,
    })
    if (ins_supp_sleep) insights.push(ins_supp_sleep)
    const ins_supp_hrv = compareGroups({
      id: `supplement_${suppSlug(supp)}_hrv`, category: "supplements", emoji: "💓", title: `${supp} & HRV`,
      highGroupLabel: highLabel, lowGroupLabel: lowLabel,
      series: withHrvSplit,
      findingTemplate: (h, l) =>
        h > l
          ? `Mornings after ${supp}, HRV averages ${h}ms vs ${l}ms without it`
          : `${supp} doesn't move your HRV — ${h}ms vs ${l}ms without it`,
    })
    if (ins_supp_hrv) insights.push(ins_supp_hrv)

    // Sleep architecture, not just the score. Sedatives are the reason this
    // matters: several of them buy sleep *time* while cutting deep and REM,
    // so a night can feel fine, score fine, and still leave the restorative
    // stages short. The stage minutes are the only place that shows up.
    const ins_supp_deep = compareGroups({
      id: `supplement_${suppSlug(supp)}_deep`, category: "supplements", emoji: "🌊", title: `${supp} & Deep Sleep`,
      highGroupLabel: highLabel, lowGroupLabel: lowLabel,
      series: withDeepSplit,
      findingTemplate: (h, l) =>
        h > l
          ? `Nights after ${supp}, deep sleep averages ${Math.round(h)}min vs ${Math.round(l)}min without it`
          : `Nights after ${supp}, deep sleep drops to ${Math.round(h)}min vs ${Math.round(l)}min without it`,
    })
    if (ins_supp_deep) insights.push(ins_supp_deep)
    const ins_supp_rem = compareGroups({
      id: `supplement_${suppSlug(supp)}_rem`, category: "supplements", emoji: "🌀", title: `${supp} & REM Sleep`,
      highGroupLabel: highLabel, lowGroupLabel: lowLabel,
      series: withRemSplit,
      findingTemplate: (h, l) =>
        h > l
          ? `Nights after ${supp}, REM averages ${Math.round(h)}min vs ${Math.round(l)}min without it`
          : `Nights after ${supp}, REM drops to ${Math.round(h)}min vs ${Math.round(l)}min without it`,
    })
    if (ins_supp_rem) insights.push(ins_supp_rem)
  }

  // 15b. Interactions — the same substance on a drinking day vs a sober one.
  // Every other section compares "did X vs didn't"; this asks whether X lands
  // differently depending on what else was on board. Sedatives and alcohol are
  // the case that matters: both suppress the restorative stages, and the
  // pharmacology text can warn about it but only the user's own nights can
  // show it. Restricted to the three most-logged substances, and every cell
  // still has to clear the 5-day minimum, so it stays quiet until there's
  // genuinely enough overlap.
  const MODIFIERS: { key: string; label: string; test: (d: DayData) => boolean }[] = [
    { key: "alcohol",  label: "alcohol",          test: d => (d.alcoholG ?? 0) >= STANDARD_DRINK_G },
    { key: "caffeine", label: `${cafLabel} caffeine`, test: d => (d.caffeineMg ?? 0) >= cuts.caffeine.at },
  ]
  for (const supp of topSupps.slice(0, 3)) {
    for (const mod of MODIFIERS) {
      const bothSleepSplit = new Split()
      const bothDeepSplit = new Split()
      for (const d of days) {
        if (!(d.supplements ?? []).includes(supp)) continue // only that substance's days
        const next = byDate[nextDateStr(d.date)]
        if (!next) continue
        const alsoHad = mod.test(d)
        if (next.sleepScore != null) { bothSleepSplit.add(alsoHad, next.sleepScore) }
        if (next.deepSleepMin != null) { bothDeepSplit.add(alsoHad, next.deepSleepMin) }
      }
      const ins_int_sleep = compareGroups({
        id: `interaction_${suppSlug(supp)}_${mod.key}_sleep`, category: "interactions", emoji: "🔀",
        title: `${supp} + ${mod.label} & Sleep`,
        highGroupLabel: `${supp} + ${mod.label}`, lowGroupLabel: `${supp} alone`,
        series: bothSleepSplit,
        findingTemplate: (h, l) =>
          `${supp} nights with ${mod.label} score ${h}; ${supp} nights without, ${l}`,
      })
      if (ins_int_sleep) insights.push(ins_int_sleep)
      const ins_int_deep = compareGroups({
        id: `interaction_${suppSlug(supp)}_${mod.key}_deep`, category: "interactions", emoji: "🌊",
        title: `${supp} + ${mod.label} & Deep Sleep`,
        highGroupLabel: `${supp} + ${mod.label}`, lowGroupLabel: `${supp} alone`,
        series: bothDeepSplit,
        findingTemplate: (h, l) =>
          h < l
            ? `${supp} plus ${mod.label} leaves ${Math.round(h)}min of deep sleep vs ${Math.round(l)}min on ${supp} alone`
            : `Adding ${mod.label} to ${supp} doesn't cut your deep sleep — ${Math.round(h)}min vs ${Math.round(l)}min`,
      })
      if (ins_int_deep) insights.push(ins_int_deep)
    }
  }

  // 15c. Symptoms — the only section where the thing being explained is how the
  // user *felt* rather than what their body scored. Runs the other way round to
  // everything above: each symptom is the outcome, and the factors are the
  // suspects. A day with no entry for a symptom is a genuine zero, not missing
  // data — that's what makes "headache severity on drinking days vs sober days"
  // a fair comparison rather than one computed only over days it hurt.
  const symptomDayCount = new Map<string, number>()
  for (const d of days) {
    for (const name of Object.keys(d.symptoms ?? {})) {
      symptomDayCount.set(name, (symptomDayCount.get(name) ?? 0) + 1)
    }
  }
  const topSymptoms = [...symptomDayCount.entries()]
    .filter(([, n]) => n >= 4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([s]) => s)

  if (topSymptoms.length > 0) {
    // Suspects worth testing. Sleep and alcohol look at the *previous* day —
    // a hangover headache belongs to last night's drinking, not this morning's.
    // Three names each, because one could not do the job. `chip` heads the
    // stat column, `phrase` sits inside the finding, `short` goes in the title.
    //
    // The single `label` these replace was written as a sentence fragment and
    // then used everywhere, which produced "Headache runs at 2.4/5 150mg+
    // caffeine days" (no preposition, two numbers colliding) and — from the
    // branch that capitalised it into a subject — "The day after drinking
    // don't bring more headache", which was ungrammatical for five of the
    // eight suspects below.
    const SUSPECTS: {
      key: string
      chip: string
      phrase: string
      short: string
      test: (d: DayData, prev?: DayData) => boolean | null
    }[] = [
      { key: "alcohol", chip: "days after drinking", phrase: "the day after drinking", short: "drinking", test: (_d, prev) => prev ? (prev.alcoholG ?? 0) >= STANDARD_DRINK_G : null },
      { key: "caffeine", chip: `${cafLabel} caffeine days`, phrase: `on ${cafLabel} caffeine days`, short: "caffeine", test: d => d.caffeineMg != null ? d.caffeineMg >= cuts.caffeine.at : null },
      { key: "short_sleep", chip: "days after a short night", phrase: "after a night under 7h", short: "short sleep", test: d => d.sleepDuration != null ? d.sleepDuration < 7 : null },
      { key: "poor_sleep", chip: "days after a poor night", phrase: "after a night scoring under 70", short: "a poor night", test: d => d.sleepScore != null ? d.sleepScore < 70 : null },
      { key: "late_meal", chip: "days after a late dinner", phrase: "the day after a late dinner", short: "late dinners", test: (_d, prev) => prev?.lastMealMin != null ? prev.lastMealMin >= 20 * 60 : null },
      { key: "high_screen", chip: "days after heavy screen time", phrase: "the day after heavy screen time", short: "heavy screen time", test: (_d, prev) => prev?.screenTimeMin != null ? prev.screenTimeMin >= 300 : null },
      { key: "workout", chip: "days after training", phrase: "the day after training", short: "training", test: (_d, prev) => prev ? (prev.workoutMin ?? 0) >= 20 : null },
      // "less than 1.5L", not "under 1.5L" — "after under" stacks two prepositions.
      { key: "low_water", chip: "days after low water", phrase: "the day after less than 1.5L of water", short: "low water", test: (_d, prev) => prev?.waterMl != null ? prev.waterMl < 1500 : null },
    ]

    const prevDateStr = (dateStr: string): string => {
      const dt = new Date(dateStr + "T12:00:00Z")
      dt.setUTCDate(dt.getUTCDate() - 1)
      return dt.toISOString().slice(0, 10)
    }

    for (const symptom of topSymptoms) {
      const symSlug = suppSlug(symptom)
      for (const suspect of SUSPECTS) {
        const exposedSplit = new Split()
        for (const d of days) {
          const prev = byDate[prevDateStr(d.date)]
          const verdict = suspect.test(d, prev)
          if (verdict == null) continue // that factor wasn't recorded — not a zero
          const severity = d.symptoms?.[symptom] ?? 0
          if (verdict) exposedSplit.add(true, severity); else exposedSplit.add(false, severity)
        }
        const ins_symptom = compareGroups({
          id: `symptom_${symSlug}_${suspect.key}`, category: "symptoms", emoji: "🩹",
          title: `${symptom} & ${suspect.short}`,
          highGroupLabel: { chip: suspect.chip, phrase: suspect.phrase },
          lowGroupLabel: "other days",
          series: exposedSplit,
          higherIsBetter: false, // more symptom is worse, so a rise reads as negative
          // One sentence. The old second branch existed to turn the label into
          // a subject, which is where the grammar broke; the two numbers say
          // which way it went without a clause claiming it.
          findingTemplate: (h, l, lab) =>
            `${symptom} runs at ${h}/5 ${lab.high}, and ${l}/5 otherwise`,
        })
        if (ins_symptom) insights.push(ins_symptom)
      }

      // Meds are suspects too — this is the side-effect question, and it's the
      // reason symptom tracking earns its place next to the pharmacology work.
      for (const supp of topSupps.slice(0, 3)) {
        const onDaysSplit = new Split()
        for (const d of days) {
          const took = (d.supplements ?? []).includes(supp)
          const severity = d.symptoms?.[symptom] ?? 0
          if (took) onDaysSplit.add(true, severity); else onDaysSplit.add(false, severity)
        }
        const ins_symptom_med = compareGroups({
          id: `symptom_${symSlug}_med_${suppSlug(supp)}`, category: "symptoms", emoji: "💊",
          title: `${symptom} & ${supp}`,
          highGroupLabel: `${supp} days`, lowGroupLabel: `days without it`,
          series: onDaysSplit,
          higherIsBetter: false,
          findingTemplate: (h, l) =>
            h > l
              ? `On ${supp} days, ${symptom.toLowerCase()} averages ${h}/5 vs ${l}/5 without it`
              : `${symptom} is no worse on ${supp} days — ${h}/5 vs ${l}/5`,
        })
        if (ins_symptom_med) insights.push(ins_symptom_med)
      }
    }
  }

  // 16. Workouts (Strava) — the classic wearable questions: does training help
  // you sleep, and what does it cost (or pay) in next-day recovery?
  const workoutSleepSplit = new Split()
  const workoutReadinessSplit = new Split()
  const workoutHrvSplit = new Split()
  for (const d of days) {
    const trained = (d.workoutMin ?? 0) >= 20
    const next = tonight(d)
    if (!next) continue
    if (next.sleepScore != null) { if (trained) workoutSleepSplit.add(true, next.sleepScore); else workoutSleepSplit.add(false, next.sleepScore) }
    if (next.readiness != null) { if (trained) workoutReadinessSplit.add(true, next.readiness); else workoutReadinessSplit.add(false, next.readiness) }
    if (next.hrv != null) { if (trained) workoutHrvSplit.add(true, next.hrv); else workoutHrvSplit.add(false, next.hrv) }
  }
  const ins_workout_sleep = compareGroups({
    id: "workout_sleep", category: "fitness", emoji: "🏃", title: "Workouts & Sleep Quality",
    highGroupLabel: "workout days (20min+)", lowGroupLabel: "rest days",
    series: workoutSleepSplit, higherIsBetter: true,
    findingTemplate: (h, l) =>
      h > l
        ? `On workout days, your sleep score averages ${h} vs ${l} on rest days`
        : `Workouts don't lift your sleep score — ${h} vs ${l} on rest days`,
  })
  if (ins_workout_sleep) insights.push(ins_workout_sleep)
  const ins_workout_readiness = compareGroups({
    id: "workout_readiness", category: "fitness", emoji: "🔋", title: "Workouts & Next-Day Readiness",
    highGroupLabel: "workout days (20min+)", lowGroupLabel: "rest days",
    series: workoutReadinessSplit, higherIsBetter: true,
    findingTemplate: (h, l) =>
      h >= l
        ? `After a workout, next-day readiness averages ${h}; after a rest day, ${l}`
        : `After a workout, next-day readiness drops to ${h}; after a rest day, ${l}`,
  })
  if (ins_workout_readiness) insights.push(ins_workout_readiness)
  const ins_workout_hrv = compareGroups({
    id: "workout_hrv", category: "fitness", emoji: "💓", title: "Workouts & Next-Day HRV",
    highGroupLabel: "workout days (20min+)", lowGroupLabel: "rest days",
    series: workoutHrvSplit, higherIsBetter: true,
    findingTemplate: (h, l) =>
      h >= l
        ? `Mornings after workouts, HRV averages ${h}ms vs ${l}ms after rest days`
        : `Mornings after workouts, HRV dips to ${h}ms vs ${l}ms after rest days`,
  })
  if (ins_workout_hrv) insights.push(ins_workout_hrv)

  // 17. Music (Last.fm) — ported from the /api/stats mini-engine so it reaches
  // the Insights page and the watch cron
  const listenVals = days.filter(d => d.listeningMin != null).map(d => d.listeningMin!)
  if (listenVals.length >= 10) {
    const listenMedian = median(listenVals)
    const musicMood = new Split()
    const musicSleep = new Split()
    const musicFocus = new Split()
    for (const d of days) {
      if (d.listeningMin == null) continue
      const isHigh = d.listeningMin >= listenMedian
      if (d.mood != null) { if (isHigh) musicMood.add(true, d.mood); else musicMood.add(false, d.mood) }
      const night = tonight(d)
      if (night?.sleepScore != null) { if (isHigh) musicSleep.add(true, night.sleepScore); else musicSleep.add(false, night.sleepScore) }
      if (d.focusMin != null) { if (isHigh) musicFocus.add(true, d.focusMin); else musicFocus.add(false, d.focusMin) }
    }
    const fmtListen = listenMedian >= 60 ? `${(listenMedian / 60).toFixed(1)}h` : `${Math.round(listenMedian)}min`
    const ins_music_mood = compareGroups({
      id: "music_mood", category: "music", emoji: "🎵", title: "Music & Mood",
      highGroupLabel: `heavy-listening days (${fmtListen}+)`, lowGroupLabel: "quieter days",
      series: musicMood,
      findingTemplate: (h, l) =>
        h > l
          ? `On heavy-listening days (${fmtListen}+), mood averages ${h} vs ${l} on quieter days`
          : `More music doesn't lift your mood — ${h} vs ${l} on quieter days`,
    })
    if (ins_music_mood) insights.push(ins_music_mood)
    const ins_music_sleep = compareGroups({
      id: "music_sleep", category: "music", emoji: "🎧", title: "Music & Sleep Quality",
      highGroupLabel: `heavy-listening days (${fmtListen}+)`, lowGroupLabel: "quieter days",
      series: musicSleep,
      findingTemplate: (h, l) =>
        h > l
          ? `On heavy-listening days, sleep score averages ${h} vs ${l} on quieter days`
          : `Heavy-listening days link to a sleep score of ${h} vs ${l} on quieter days`,
    })
    if (ins_music_sleep) insights.push(ins_music_sleep)
    const ins_music_focus = compareGroups({
      id: "music_focus", category: "music", emoji: "🎯", title: "Music & Focus Time",
      highGroupLabel: `heavy-listening days (${fmtListen}+)`, lowGroupLabel: "quieter days",
      series: musicFocus,
      findingTemplate: (h, l) =>
        `You log ${Math.round(h)}min of focus on heavy-listening days; ${Math.round(l)}min on quieter ones`,
    })
    if (ins_music_focus) insights.push(ins_music_focus)
  }

  // 17b. Late-night listening → the night that follows.
  //
  // The other three music insights split on how MUCH was played, which is a
  // daytime fact. This one is about WHEN: scrobbles after 22:00 belong to the
  // night, and the night is the thing sleep is measured over. Compared against
  // the NEXT day's numbers, because a night is reported on the morning it ends.
  //
  // Days with one to four late tracks are deliberately in neither group — a
  // couple of songs while brushing your teeth is not a late night, and lumping
  // them either way is what turns a real effect into noise.
  const lateDays = days.filter(d => d.lateTracks != null)
  if (lateDays.length >= 10) {
    const lateSleep = new Split()
    const lateDur = new Split()
    const lateReady = new Split()
    for (const d of lateDays) {
      const late = d.lateTracks as number
      if (late > 0 && late < 5) continue
      const isLate = late >= 5
      const next = byDate[nextDateStr(d.date)]
      if (next?.sleepScore != null) { if (isLate) lateSleep.add(true, next.sleepScore); else lateSleep.add(false, next.sleepScore) }
      if (next?.sleepDuration != null) { if (isLate) lateDur.add(true, next.sleepDuration); else lateDur.add(false, next.sleepDuration) }
      if (next?.readiness != null) { if (isLate) lateReady.add(true, next.readiness); else lateReady.add(false, next.readiness) }
    }
    const ins_late_music_sleep = compareGroups({
      id: "late_music_sleep", category: "music", emoji: "🌙", title: "Late-night music & sleep",
      highGroupLabel: "nights you listened past 22:00", lowGroupLabel: "quiet evenings",
      series: lateSleep,
      findingTemplate: (h, l) =>
        `Nights after music past 22:00 score ${h}; after a quiet evening, ${l}`,
    })
    if (ins_late_music_sleep) insights.push(ins_late_music_sleep)
    const ins_late_music_dur = compareGroups({
      id: "late_music_duration", category: "music", emoji: "🎧", title: "Late-night music & sleep length",
      highGroupLabel: "nights you listened past 22:00", lowGroupLabel: "quiet evenings",
      series: lateDur,
      findingTemplate: (h, l) =>
        h < l
          ? `You sleep ${h}h after listening past 22:00, against ${l}h after quiet evenings`
          : `Listening past 22:00 goes with ${h}h of sleep, against ${l}h after quiet evenings`,
    })
    if (ins_late_music_dur) insights.push(ins_late_music_dur)
    const ins_late_music_ready = compareGroups({
      id: "late_music_readiness", category: "music", emoji: "🔋", title: "Late-night music & next-day readiness",
      highGroupLabel: "mornings after late listening", lowGroupLabel: "mornings after quiet evenings",
      series: lateReady,
      findingTemplate: (h, l) =>
        h < l
          ? `Readiness comes in at ${h} after a late-listening evening, ${l} otherwise`
          : `Readiness holds at ${h} after late listening, against ${l} otherwise`,
    })
    if (ins_late_music_ready) insights.push(ins_late_music_ready)
  }

  // 17c. Genre — not how much music, but what KIND. Each day is labelled with
  // its top artist's genre (community tags via ArtistGenre), and the user's
  // own most-common genres are auto-discovered, like calendar activities and
  // supplements are. Compared against OTHER listening days, never against
  // silent ones — otherwise every genre would just rediscover "listened at
  // all", which the volume insights above already test.
  const genreDayCount = new Map<string, number>()
  for (const d of days) {
    if (d.musicGenre) genreDayCount.set(d.musicGenre, (genreDayCount.get(d.musicGenre) ?? 0) + 1)
  }
  const topGenres = [...genreDayCount.entries()]
    .filter(([, n]) => n >= 5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([g]) => g)
  for (const genre of topGenres) {
    const gSlug = suppSlug(genre)
    const gMoodSplit = new Split()
    const gSleepSplit = new Split()
    for (const d of days) {
      if (d.listeningMin == null || d.musicGenre == null) continue
      const hit = d.musicGenre === genre
      if (d.mood != null) { if (hit) gMoodSplit.add(true, d.mood); else gMoodSplit.add(false, d.mood) }
      const night = tonight(d)
      if (night?.sleepScore != null) { if (hit) gSleepSplit.add(true, night.sleepScore); else gSleepSplit.add(false, night.sleepScore) }
    }
    const ins_genre_mood = compareGroups({
      id: `music_genre_${gSlug}_mood`, category: "music", emoji: "🎼", title: `${genre} days & Mood`,
      highGroupLabel: `days topped by ${genre}`, lowGroupLabel: "other listening days",
      series: gMoodSplit,
      findingTemplate: (h, l) =>
        h > l
          ? `On days your listening leans ${genre}, mood averages ${h} vs ${l} on other music days`
          : `${genre} days run a mood of ${h} vs ${l} on other music days`,
    })
    if (ins_genre_mood) insights.push(ins_genre_mood)
    const ins_genre_sleep = compareGroups({
      id: `music_genre_${gSlug}_sleep`, category: "music", emoji: "🎚️", title: `${genre} days & Sleep`,
      highGroupLabel: `days topped by ${genre}`, lowGroupLabel: "other listening days",
      series: gSleepSplit,
      findingTemplate: (h, l) =>
        h > l
          ? `On ${genre} days, sleep score averages ${h} vs ${l} on other music days`
          : `${genre} days link to a sleep score of ${h} vs ${l} on other music days`,
    })
    if (ins_genre_sleep) insights.push(ins_genre_sleep)
  }

  // 18. Spending — also ported from /api/stats. Only days with transactions
  // count (a day with no synced card activity isn't a €0 day, just unknown).
  const spendVals = days.filter(d => d.spendEur != null).map(d => d.spendEur!)
  if (spendVals.length >= 10) {
    const spendMedian = median(spendVals)
    const spendMood = new Split()
    const spendMoodNext = new Split()
    for (const d of days) {
      if (d.spendEur == null) continue
      const isHigh = d.spendEur >= spendMedian
      if (d.mood != null) { if (isHigh) spendMood.add(true, d.mood); else spendMood.add(false, d.mood) }
      const next = byDate[nextDateStr(d.date)]
      if (next?.mood != null) { if (isHigh) spendMoodNext.add(true, next.mood); else spendMoodNext.add(false, next.mood) }
    }
    const ins_spend_mood = compareGroups({
      id: "spend_mood", category: "money", emoji: "💸", title: "Spending & Mood",
      highGroupLabel: `bigger-spend days (€${Math.round(spendMedian)}+)`, lowGroupLabel: "lighter-spend days",
      series: spendMood,
      findingTemplate: (h, l) =>
        h > l
          ? `On bigger-spend days (€${Math.round(spendMedian)}+), mood averages ${h} vs ${l} on lighter days`
          : `Spending more doesn't come with better mood — ${h} vs ${l} on lighter days`,
    })
    if (ins_spend_mood) insights.push(ins_spend_mood)
    const ins_spend_mood_next = compareGroups({
      id: "spend_mood_next", category: "money", emoji: "💳", title: "Spending & Next-Day Mood",
      highGroupLabel: `bigger-spend days (€${Math.round(spendMedian)}+)`, lowGroupLabel: "lighter-spend days",
      series: spendMoodNext,
      findingTemplate: (h, l) =>
        h < l
          ? `The morning after bigger-spend days, mood averages ${h} vs ${l} after lighter days`
          : `Bigger-spend days don't dent the next morning's mood — ${h} vs ${l}`,
    })
    if (ins_spend_mood_next) insights.push(ins_spend_mood_next)
  }

  // 19. UV — the one weather column nothing consumed
  const uvDays = days.filter(d => d.uvIndex != null)
  if (uvDays.length >= 10) {
    const uvReadiness = new Split()
    for (const d of uvDays) {
      if (d.readiness == null) continue
      if (d.uvIndex! >= 5) uvReadiness.add(true, d.readiness)
      else uvReadiness.add(false, d.readiness)
    }
    const ins_uv_readiness = compareGroups({
      id: "uv_readiness", category: "tags", emoji: "☀️", title: "Sunny Days & Readiness",
      highGroupLabel: "high-UV days (index 5+)", lowGroupLabel: "low-UV days",
      series: uvReadiness,
      findingTemplate: (h, l) =>
        h > l
          ? `On sunny high-UV days, readiness averages ${h} vs ${l} on grey days`
          : `Sunny days don't show up in your readiness — ${h} vs ${l}`,
    })
    if (ins_uv_readiness) insights.push(ins_uv_readiness)
  }

  // 20. Focus sessions — do focus days feel better, and does sleep buy focus?
  const focusDayCount = days.filter(d => (d.focusMin ?? 0) > 0).length
  if (focusDayCount >= 5) {
    const focusMoodSplit = new Split()
    const goodSleepFocusSplit = new Split()
    for (const d of days) {
      const focused = (d.focusMin ?? 0) > 0
      if (d.mood != null) { if (focused) focusMoodSplit.add(true, d.mood); else focusMoodSplit.add(false, d.mood) }
      // sleepDuration on day d is last night's sleep; no-session days are real
      // 0-minute focus days for this question
      if (d.sleepDuration != null) {
        if (d.sleepDuration >= 7) goodSleepFocusSplit.add(true, d.focusMin ?? 0)
        else goodSleepFocusSplit.add(false, d.focusMin ?? 0)
      }
    }
    const ins_focus_mood = compareGroups({
      id: "focus_mood", category: "focus", emoji: "🎯", title: "Focus Sessions & Mood",
      highGroupLabel: "focus-session days", lowGroupLabel: "days without deep work",
      series: focusMoodSplit,
      findingTemplate: (h, l) =>
        h > l
          ? `On days with a focus session, mood averages ${h} vs ${l} on days without`
          : `Focus-session days don't show a mood lift — ${h} vs ${l}`,
    })
    if (ins_focus_mood) insights.push(ins_focus_mood)
    const ins_sleep_focus = compareGroups({
      id: "sleep_focus", category: "focus", emoji: "🧠", title: "Sleep & Deep Work",
      highGroupLabel: "after 7h+ sleep", lowGroupLabel: "after shorter nights",
      series: goodSleepFocusSplit,
      findingTemplate: (h, l) =>
        h > l
          ? `After 7h+ nights you log ${Math.round(h)}min of focus vs ${Math.round(l)}min after short sleep`
          : `Short nights don't reduce your focus time — ${Math.round(h)}min vs ${Math.round(l)}min`,
    })
    if (ins_sleep_focus) insights.push(ins_sleep_focus)
  }

  // 21. Fasting — completed fasts vs ordinary days, next morning's readings
  const fastDays = days.filter(d => d.fastH != null)
  if (fastDays.length >= 5) {
    const fastedSleepSplit = new Split()
    const fastedEnergySplit = new Split()
    for (const d of days) {
      const fasted = (d.fastH ?? 0) >= 14
      const next = byDate[nextDateStr(d.date)]
      if (!next) continue
      if (next.sleepScore != null) { if (fasted) fastedSleepSplit.add(true, next.sleepScore); else fastedSleepSplit.add(false, next.sleepScore) }
      if (next.energy != null) { if (fasted) fastedEnergySplit.add(true, next.energy); else fastedEnergySplit.add(false, next.energy) }
    }
    const ins_fast_sleep = compareGroups({
      id: "fasting_sleep", category: "fasting", emoji: "⏳", title: "Fasting & Sleep Quality",
      highGroupLabel: "14h+ fast days", lowGroupLabel: "non-fasting days",
      series: fastedSleepSplit,
      findingTemplate: (h, l) =>
        h > l
          ? `Nights after a 14h+ fast, sleep score averages ${h} vs ${l} on ordinary days`
          : `Fasting days don't improve your sleep — ${h} vs ${l} on ordinary days`,
    })
    if (ins_fast_sleep) insights.push(ins_fast_sleep)
    const ins_fast_energy = compareGroups({
      id: "fasting_energy", category: "fasting", emoji: "⚡", title: "Fasting & Next-Day Energy",
      highGroupLabel: "14h+ fast days", lowGroupLabel: "non-fasting days",
      series: fastedEnergySplit,
      findingTemplate: (h, l) =>
        h > l
          ? `Mornings after a 14h+ fast, energy averages ${h} vs ${l} after ordinary days`
          : `Fasting doesn't boost your next-morning energy — ${h} vs ${l}`,
    })
    if (ins_fast_energy) insights.push(ins_fast_energy)
  }

  // 22. Sleep architecture — deep/REM minutes were synced for months and never
  // fed into a single insight
  const caffeineDeep = new Split()
  const alcoholRemDrinkSplit = new Split()
  for (const d of days) {
    const next = tonight(d)
    if (d.caffeineMg != null && next?.deepSleepMin != null) {
      if (d.caffeineMg >= cuts.caffeine.at) caffeineDeep.add(true, next.deepSleepMin)
      else caffeineDeep.add(false, next.deepSleepMin)
    }
    if (next?.remSleepMin != null && (d.alcoholG != null || d.caffeineMg != null)) {
      if ((d.alcoholG ?? 0) >= STANDARD_DRINK_G) alcoholRemDrinkSplit.add(true, next.remSleepMin)
      else alcoholRemDrinkSplit.add(false, next.remSleepMin)
    }
  }
  const ins_caffeine_deep = compareGroups({
    id: "caffeine_deep_sleep", category: "recovery", emoji: "🌊", title: "Caffeine & Deep Sleep",
    highGroupLabel: `${cafLabel} caffeine days`, lowGroupLabel: `${cafUnderLabel} days`,
    series: caffeineDeep,
    findingTemplate: (h, l) =>
      h < l
        ? `On ${cafLabel} caffeine days you get ${Math.round(h)}min of deep sleep vs ${Math.round(l)}min on lighter days`
        : `Caffeine isn't eating your deep sleep — ${Math.round(h)}min vs ${Math.round(l)}min`,
  })
  if (ins_caffeine_deep) insights.push(ins_caffeine_deep)
  const ins_alcohol_rem = compareGroups({
    id: "alcohol_rem_sleep", category: "recovery", emoji: "🌀", title: "Alcohol & REM Sleep",
    highGroupLabel: DRINKING_DAYS_LABEL, lowGroupLabel: "non-drinking days",
    series: alcoholRemDrinkSplit, higherIsBetter: false,
    findingTemplate: (h, l) =>
      h < l
        ? `Nights after drinking you get ${Math.round(h)}min of REM vs ${Math.round(l)}min sober`
        : `Drinking isn't cutting your REM sleep — ${Math.round(h)}min vs ${Math.round(l)}min`,
  })
  if (ins_alcohol_rem) insights.push(ins_alcohol_rem)

  // 23. Places — the coarse GPS day-facts, finally in the same battery as
  // everything else (per-place comparisons stay on the Insights page's own
  // "By place" section; these are the whole-day facts with the full
  // permutation + FDR treatment).
  //
  // slept joins to the SAME day's sleep record — both describe the night that
  // ended that morning. presence describes the waking day, so its sleep
  // consequence is the night that follows (the next day's record).
  const sleptAwaySleepSplit = new Split()
  const sleptAwayDurSplit = new Split()
  const awayDayMoodSplit = new Split()
  const awayDaySleepSplit = new Split()
  for (const d of days) {
    if (d.sleptAway != null) {
      if (d.sleepScore != null) { if (d.sleptAway) sleptAwaySleepSplit.add(true, d.sleepScore); else sleptAwaySleepSplit.add(false, d.sleepScore) }
      if (d.sleepDuration != null) { if (d.sleptAway) sleptAwayDurSplit.add(true, d.sleepDuration); else sleptAwayDurSplit.add(false, d.sleepDuration) }
    }
    if (d.presence != null) {
      const isAway = d.presence === "away"
      if (d.mood != null) { if (isAway) awayDayMoodSplit.add(true, d.mood); else awayDayMoodSplit.add(false, d.mood) }
      const next = byDate[nextDateStr(d.date)]
      if (next?.sleepScore != null) { if (isAway) awayDaySleepSplit.add(true, next.sleepScore); else awayDaySleepSplit.add(false, next.sleepScore) }
    }
  }
  const ins_slept_away = compareGroups({
    id: "slept_away_sleep", category: "places", emoji: "🛏️", title: "Sleeping Away & Sleep Quality",
    highGroupLabel: "nights away from your own bed", lowGroupLabel: "nights at home",
    series: sleptAwaySleepSplit,
    findingTemplate: (h, l) =>
      `Nights away from your own bed score ${h}; nights in it, ${l}`,
  })
  if (ins_slept_away) insights.push(ins_slept_away)
  const ins_slept_away_dur = compareGroups({
    id: "slept_away_duration", category: "places", emoji: "⏰", title: "Sleeping Away & Sleep Length",
    highGroupLabel: "nights away from your own bed", lowGroupLabel: "nights at home",
    series: sleptAwayDurSplit,
    findingTemplate: (h, l) =>
      h < l
        ? `Away from home you sleep ${h}h vs ${l}h in your own bed`
        : `You sleep ${h}h away from home, against ${l}h in your own bed`,
  })
  if (ins_slept_away_dur) insights.push(ins_slept_away_dur)
  const ins_away_mood = compareGroups({
    id: "away_day_mood", category: "places", emoji: "🧳", title: "Days Away & Mood",
    highGroupLabel: `days away from home (${AWAY_KM}km+)`, lowGroupLabel: "days in your own town",
    series: awayDayMoodSplit,
    findingTemplate: (h, l) =>
      h > l
        ? `On days away from home, mood averages ${h} vs ${l} in your own town`
        : `Days away don't lift your mood — ${h} vs ${l} at home`,
  })
  if (ins_away_mood) insights.push(ins_away_mood)
  const ins_away_sleep = compareGroups({
    id: "away_day_sleep", category: "places", emoji: "🗺️", title: "Days Away & That Night's Sleep",
    highGroupLabel: `days away from home (${AWAY_KM}km+)`, lowGroupLabel: "days in your own town",
    series: awayDaySleepSplit,
    findingTemplate: (h, l) =>
      `Nights that end a day away score ${h}; nights after an ordinary day, ${l}`,
  })
  if (ins_away_sleep) insights.push(ins_away_sleep)

  // 23b. Walking — recognised walking minutes, not steps: this is time actually
  // spent moving through the world, and it exists for imported history too.
  const walkVals = days.filter(d => d.walkMin != null).map(d => d.walkMin!)
  if (walkVals.length >= 10) {
    const walkMedian = median(walkVals)
    const fmtWalk = walkMedian >= 60 ? `${(walkMedian / 60).toFixed(1)}h` : `${Math.round(walkMedian)}min`
    const walkMood = new Split()
    const walkSleep = new Split()
    for (const d of days) {
      if (d.walkMin == null) continue
      const isHigh = d.walkMin >= walkMedian
      if (d.mood != null) { if (isHigh) walkMood.add(true, d.mood); else walkMood.add(false, d.mood) }
      const next = byDate[nextDateStr(d.date)]
      if (next?.sleepScore != null) { if (isHigh) walkSleep.add(true, next.sleepScore); else walkSleep.add(false, next.sleepScore) }
    }
    const ins_walk_mood = compareGroups({
      id: "walking_mood", category: "places", emoji: "🚶", title: "Walking & Mood",
      highGroupLabel: `bigger walking days (${fmtWalk}+)`, lowGroupLabel: "less-walked days",
      series: walkMood,
      findingTemplate: (h, l) =>
        h > l
          ? `On days you walk ${fmtWalk}+, mood averages ${h} vs ${l} on less-walked days`
          : `Bigger walking days don't show a mood lift — ${h} vs ${l}`,
    })
    if (ins_walk_mood) insights.push(ins_walk_mood)
    const ins_walk_sleep = compareGroups({
      id: "walking_sleep", category: "places", emoji: "🌆", title: "Walking & That Night's Sleep",
      highGroupLabel: `bigger walking days (${fmtWalk}+)`, lowGroupLabel: "less-walked days",
      series: walkSleep,
      findingTemplate: (h, l) =>
        h > l
          ? `Nights after ${fmtWalk}+ of walking score ${h} vs ${l} after stiller days`
          : `Walking more doesn't move your sleep score — ${h} vs ${l}`,
    })
    if (ins_walk_sleep) insights.push(ins_walk_sleep)
  }

  // 24. Work (RescueTime) — synced daily for months and never correlated with
  // anything. Productive hours and distracting hours are separate questions:
  // a deep-work day and a doomscrolling day can have the same screen total.
  const prodVals = days.filter(d => d.productiveH != null).map(d => d.productiveH!)
  if (prodVals.length >= 10) {
    const prodMedian = median(prodVals)
    const prodMood = new Split()
    const prodSleep = new Split()
    for (const d of days) {
      if (d.productiveH == null) continue
      const isHigh = d.productiveH >= prodMedian
      if (d.mood != null) { if (isHigh) prodMood.add(true, d.mood); else prodMood.add(false, d.mood) }
      const next = byDate[nextDateStr(d.date)]
      if (next?.sleepScore != null) { if (isHigh) prodSleep.add(true, next.sleepScore); else prodSleep.add(false, next.sleepScore) }
    }
    const ins_prod_mood = compareGroups({
      id: "work_productive_mood", category: "work", emoji: "💼", title: "Productive Hours & Mood",
      highGroupLabel: `${r1(prodMedian)}h+ productive days`, lowGroupLabel: "lighter work days",
      series: prodMood,
      findingTemplate: (h, l) =>
        h > l
          ? `On ${r1(prodMedian)}h+ productive days, mood averages ${h} vs ${l} on lighter days`
          : `Big work days don't come with better mood — ${h} vs ${l}`,
    })
    if (ins_prod_mood) insights.push(ins_prod_mood)
    const ins_prod_sleep = compareGroups({
      id: "work_productive_sleep", category: "work", emoji: "🌜", title: "Productive Hours & That Night's Sleep",
      highGroupLabel: `${r1(prodMedian)}h+ productive days`, lowGroupLabel: "lighter work days",
      series: prodSleep,
      findingTemplate: (h, l) =>
        `Nights after ${r1(prodMedian)}h+ of productive work score ${h}; after a lighter day, ${l}`,
    })
    if (ins_prod_sleep) insights.push(ins_prod_sleep)
  }
  const distVals = days.filter(d => d.distractingH != null).map(d => d.distractingH!)
  if (distVals.length >= 10) {
    const distMedian = median(distVals)
    const distMood = new Split()
    for (const d of days) {
      if (d.distractingH == null || d.mood == null) continue
      if (d.distractingH >= distMedian) distMood.add(true, d.mood)
      else distMood.add(false, d.mood)
    }
    const ins_dist_mood = compareGroups({
      id: "work_distracting_mood", category: "work", emoji: "🕳️", title: "Distracting Hours & Mood",
      highGroupLabel: `${r1(distMedian)}h+ distracted days`, lowGroupLabel: "more focused days",
      series: distMood,
      findingTemplate: (h, l) =>
        h < l
          ? `On ${r1(distMedian)}h+ distracted days, mood averages ${h} vs ${l} on more focused days`
          : `Distracted days don't show up in your mood — ${h} vs ${l}`,
    })
    if (ins_dist_mood) insights.push(ins_dist_mood)
  }

  // 25. Blood pressure — the one log where the OUTCOME is the number itself.
  // Systolic against the classic levers: last night's sleep, yesterday's
  // alcohol, today's caffeine. Only days with a cuff reading count.
  const bpDays = days.filter(d => d.systolic != null)
  if (bpDays.length >= 10) {
    const bpShortSleepSplit = new Split()
    const bpAfterDrinksSplit = new Split()
    const bpCaf = new Split()
    const prevDateStr2 = (dateStr: string): string => {
      const dt = new Date(dateStr + "T12:00:00Z")
      dt.setUTCDate(dt.getUTCDate() - 1)
      return dt.toISOString().slice(0, 10)
    }
    for (const d of bpDays) {
      const sys = d.systolic!
      if (d.sleepDuration != null) { if (d.sleepDuration < 7) bpShortSleepSplit.add(true, sys); else bpShortSleepSplit.add(false, sys) }
      const prev = byDate[prevDateStr2(d.date)]
      if (prev) { if ((prev.alcoholG ?? 0) >= STANDARD_DRINK_G) bpAfterDrinksSplit.add(true, sys); else bpAfterDrinksSplit.add(false, sys) }
      if (d.caffeineMg != null) { if (d.caffeineMg >= cuts.caffeine.at) bpCaf.add(true, sys); else bpCaf.add(false, sys) }
    }
    const ins_bp_sleep = compareGroups({
      id: "bp_short_sleep", category: "heart", emoji: "🩺", title: "Short Sleep & Blood Pressure",
      highGroupLabel: "after under 7h sleep", lowGroupLabel: "after 7h+ sleep",
      series: bpShortSleepSplit, higherIsBetter: false,
      findingTemplate: (h, l) =>
        h > l
          ? `After short nights, systolic averages ${Math.round(h)} vs ${Math.round(l)} after 7h+ sleep`
          : `Short nights don't raise your systolic — ${Math.round(h)} vs ${Math.round(l)}`,
    })
    if (ins_bp_sleep) insights.push(ins_bp_sleep)
    const ins_bp_alcohol = compareGroups({
      id: "bp_alcohol", category: "heart", emoji: "🍷", title: "Alcohol & Next-Day Blood Pressure",
      highGroupLabel: "the day after drinking", lowGroupLabel: "after sober days",
      series: bpAfterDrinksSplit, higherIsBetter: false,
      findingTemplate: (h, l) =>
        h > l
          ? `The day after drinking, systolic averages ${Math.round(h)} vs ${Math.round(l)} after sober days`
          : `Drinking doesn't show in your next-day systolic — ${Math.round(h)} vs ${Math.round(l)}`,
    })
    if (ins_bp_alcohol) insights.push(ins_bp_alcohol)
    const ins_bp_caffeine = compareGroups({
      id: "bp_caffeine", category: "heart", emoji: "☕", title: "Caffeine & Blood Pressure",
      highGroupLabel: `${cafLabel} caffeine days`, lowGroupLabel: `${cafUnderLabel} days`,
      series: bpCaf, higherIsBetter: false,
      findingTemplate: (h, l) =>
        h > l
          ? `On ${cafLabel} caffeine days, systolic averages ${Math.round(h)} vs ${Math.round(l)} on lighter days`
          : `Caffeine doesn't show in your systolic — ${Math.round(h)} vs ${Math.round(l)}`,
    })
    if (ins_bp_caffeine) insights.push(ins_bp_caffeine)
  }

  // 26. The week itself — weekends vs weekdays, straight from the calendar.
  // Every other family treats the weekend as a CONFOUNDER to guard against;
  // this one asks the plain question directly. Sleep records dated Sat/Sun
  // describe the nights ending those mornings — Friday and Saturday night,
  // which is exactly what "weekend nights" means. This family has no
  // weekday-only twin by construction (that pass has one empty group), so it
  // can never carry its own weekend flag.
  const weSleepSplit = new Split()
  const weDurSplit = new Split()
  const weMoodSplit = new Split()
  const weStepsSplit = new Split()
  for (const d of days) {
    const we = isWeekendDate(d.date)
    if (d.sleepScore != null) { if (we) weSleepSplit.add(true, d.sleepScore); else weSleepSplit.add(false, d.sleepScore) }
    if (d.sleepDuration != null) { if (we) weDurSplit.add(true, d.sleepDuration); else weDurSplit.add(false, d.sleepDuration) }
    if (d.mood != null) { if (we) weMoodSplit.add(true, d.mood); else weMoodSplit.add(false, d.mood) }
    if (d.steps != null) { if (we) weStepsSplit.add(true, d.steps); else weStepsSplit.add(false, d.steps) }
  }
  const ins_weekend_sleep = compareGroups({
    id: "weekend_sleep_score", category: "week", emoji: "🛋️", title: "Weekend Nights & Sleep Quality",
    highGroupLabel: "Friday & Saturday nights", lowGroupLabel: "school nights",
    series: weSleepSplit,
    findingTemplate: (h, l) =>
      `Friday and Saturday nights score ${h}; weeknights, ${l}`,
  })
  if (ins_weekend_sleep) insights.push(ins_weekend_sleep)
  const ins_weekend_dur = compareGroups({
    id: "weekend_sleep_duration", category: "week", emoji: "⏰", title: "Weekend Nights & Sleep Length",
    highGroupLabel: "Friday & Saturday nights", lowGroupLabel: "school nights",
    series: weDurSplit,
    findingTemplate: (h, l) =>
      h > l
        ? `You sleep ${h}h on weekend nights vs ${l}h on school nights`
        : `Weekend nights run ${h}h vs ${l}h on school nights`,
  })
  if (ins_weekend_dur) insights.push(ins_weekend_dur)
  const ins_weekend_mood = compareGroups({
    id: "weekend_mood", category: "week", emoji: "📆", title: "Weekends & Mood",
    highGroupLabel: "weekend days", lowGroupLabel: "weekdays",
    series: weMoodSplit,
    findingTemplate: (h, l) =>
      h > l
        ? `Weekend mood averages ${h} vs ${l} on weekdays`
        : `Weekends don't lift your mood — ${h} vs ${l} on weekdays`,
  })
  if (ins_weekend_mood) insights.push(ins_weekend_mood)
  const ins_weekend_steps = compareGroups({
    id: "weekend_steps", category: "week", emoji: "🚶", title: "Weekends & Movement",
    highGroupLabel: "weekend days", lowGroupLabel: "weekdays",
    series: weStepsSplit,
    findingTemplate: (h, l) =>
      h > l
        ? `You walk ${Math.round(h).toLocaleString()} steps on weekends vs ${Math.round(l).toLocaleString()} on weekdays`
        : `Weekdays move you more — ${Math.round(l).toLocaleString()} steps vs ${Math.round(h).toLocaleString()} on weekends`,
  })
  if (ins_weekend_steps) insights.push(ins_weekend_steps)

  // 22. Custom trackers — the one family the retired Pearson card on Trends
  // had that this engine didn't. Same treatment as every built-in source:
  // group split (did/didn't for boolean trackers, personal-median otherwise —
  // see customDefs above), permutation test, FDR across the run. Only logged
  // days count (an unlogged day is unknown, not zero), and the targets are
  // fixed up front — mood that day, sleep that night, next-morning energy —
  // instead of cherry-picking whichever pairing happens to score highest.
  for (const metric of customDefs) {
    const logged = days.filter(d => d.custom?.[metric.id] != null)
    const { isHigh, highLabel, lowLabel } = metric

    const cMood = new Split()
    const cSleep = new Split()
    const cEnergy = new Split()
    for (const d of logged) {
      const high = isHigh(d.custom![metric.id])
      if (d.mood != null) { if (high) cMood.add(true, d.mood); else cMood.add(false, d.mood) }
      const next = byDate[nextDateStr(d.date)]
      if (next?.sleepScore != null) { if (high) cSleep.add(true, next.sleepScore); else cSleep.add(false, next.sleepScore) }
      if (next?.energy != null) { if (high) cEnergy.add(true, next.energy); else cEnergy.add(false, next.energy) }
    }

    const ins_custom_mood = compareGroups({
      id: `custom_${metric.id}_mood`, category: "custom", emoji: metric.emoji, title: `${metric.name} & Mood`,
      highGroupLabel: highLabel, lowGroupLabel: lowLabel,
      series: cMood,
      // The two branches used to differ only in "averages" against "runs",
      // which told a reader nothing about which case they were looking at.
      findingTemplate: (h, l, lab) =>
        `Your mood averages ${h} on ${lab.high}, and ${l} on ${lab.low}`,
    })
    if (ins_custom_mood) insights.push(ins_custom_mood)

    const ins_custom_sleep = compareGroups({
      id: `custom_${metric.id}_sleep`, category: "custom", emoji: metric.emoji, title: `${metric.name} & Sleep`,
      highGroupLabel: highLabel, lowGroupLabel: lowLabel,
      series: cSleep,
      findingTemplate: (h, l, lab) =>
        `Nights after ${lab.high} score ${h}; after ${lab.low}, ${l}`,
    })
    if (ins_custom_sleep) insights.push(ins_custom_sleep)

    const ins_custom_energy = compareGroups({
      id: `custom_${metric.id}_energy`, category: "custom", emoji: metric.emoji, title: `${metric.name} & Next-Day Energy`,
      highGroupLabel: highLabel, lowGroupLabel: lowLabel,
      series: cEnergy,
      findingTemplate: (h, l, lab) =>
        `The morning after ${lab.high}, energy averages ${h}; after ${lab.low}, ${l}`,
    })
    if (ins_custom_energy) insights.push(ins_custom_energy)
  }

  // ── The sleep panel ───────────────────────────────────────────────────────
  //
  // Seven things happen to a night — it gets longer or shorter, it scores
  // better or worse, it takes longer to start, it wastes more time awake, it
  // loses deep sleep, it loses REM, it gets more restless — and the engine
  // was asking about them one at a time, each competing with every other test
  // in the run.
  //
  // That is the wrong shape, and a dry run of this account's own ninety days
  // showed exactly how wrong. Caffeine after 16:00 comes back at p=0.008 on
  // the sleep score and p=0.012 on how long it takes to fall asleep. Both are
  // real by any ordinary reading. Both were rejected: with thirty-five tests
  // in one Benjamini-Hochberg family the rank-one bar sits at 0.0029, so the
  // engine's own answer was "could be chance" — not because the evidence was
  // weak but because the engine had also asked about music, spending and the
  // weather. Zero strong, five suggestive, thirty noise.
  //
  // So the panel asks in two stages, which is a pre-registration and not a
  // second attempt at the same data:
  //
  //   The GATE is one test per cause, on the night's own summary score, and
  //   it lives in the main battery with everything else. It has to earn its
  //   place against all ninety-odd tests, at p ≤ 0.05.
  //
  //   Only a cause that clears the gate gets its six ASPECTS run, and those
  //   six are corrected among themselves (see InsightResult.pool). Six tests
  //   you were licensed to run are a smaller family than ninety you might
  //   have. The rank-one bar inside a pool of six is 0.0167, which is a bar
  //   late caffeine clears on merit rather than one it is let through.
  //
  // The gate is the sleep score and the aspects are its components, so no
  // question is asked twice.
  //
  // A cause returns `null` for a day that cannot answer. That is the whole of
  // the coverage problem: this account logs caffeine on 26 days, logs
  // something-but-no-caffeine on 6, and logs nothing at all on 58. Reading
  // those 58 as caffeine-free days makes the comparison "days I used the app
  // against days I didn't", which is a fact about the diary and not about
  // coffee. They are excluded, and the gate card says how many.

  type SleepCause = {
    key: string
    emoji: string
    title: string
    highLabel: GroupLabel
    lowLabel: GroupLabel
    /** true = the cause was present, false = a genuine control, null = this day cannot say. */
    test: (d: DayData) => boolean | null
    /** Shown on the gate card when days had to be set aside as unknown. */
    coverage?: string
  }

  const SLEEP_ASPECTS: {
    key: string
    label: string
    emoji: string
    higherIsBetter: boolean
    value: (n: DayData) => number | undefined
    fmt: (v: number) => string
  }[] = [
    { key: "duration", label: "sleep length", emoji: "⏰", higherIsBetter: true,
      value: n => n.sleepDuration, fmt: v => `${Math.floor(v)}h ${Math.round((v % 1) * 60)}m` },
    { key: "latency", label: "time to fall asleep", emoji: "⏳", higherIsBetter: false,
      value: n => n.sleepLatencyMin, fmt: v => `${Math.round(v)} min` },
    { key: "efficiency", label: "sleep efficiency", emoji: "⚡", higherIsBetter: true,
      value: n => n.sleepEfficiency, fmt: v => `${Math.round(v)}%` },
    { key: "deep", label: "deep sleep", emoji: "🌊", higherIsBetter: true,
      value: n => n.deepSleepMin, fmt: v => `${Math.round(v)} min` },
    { key: "rem", label: "REM sleep", emoji: "🌀", higherIsBetter: true,
      value: n => n.remSleepMin, fmt: v => `${Math.round(v)} min` },
    { key: "restless", label: "restless periods", emoji: "🌪️", higherIsBetter: false,
      value: n => n.restlessPeriods, fmt: v => `${Math.round(v)}` },
  ]

  /** A gate has to clear this in the main battery before its aspects are run. */
  const SLEEP_GATE_P = 0.05

  /**
   * Bedtimes this far apart make the two sides two different nights, whatever
   * else is being compared. Forty-five minutes is where it stops being noise:
   * across this account's 78 timed nights the earlier half scores 73.9 and the
   * later half 62.9, so roughly five points an hour — enough that an hour of
   * drift accounts for a third of a typical panel gap.
   */
  const BEDTIME_CONFOUND_MIN = 45

  const unknownCaffeineDays = allDays.length - loggedDayCount
  // Takes the noun, because the same count is attached to the caffeine card
  // and the alcohol one. It used to end "a day without it", where "it" was
  // whatever the reader guessed — and on the alcohol card the guess was wrong.
  const coverageNote = (what: string) => unknownCaffeineDays >= 5
    ? `${unknownCaffeineDays} of ${allDays.length} days had nothing logged at all. ` +
      `They are left out: a silent day is not a day without ${what}.`
    : undefined

  const sleepCauses: SleepCause[] = [
    {
      key: "caffeine",
      emoji: "☕",
      title: "Caffeine",
      highLabel: { chip: `${cafLabel} of caffeine`, phrase: `${cafLabel} of caffeine` },
      // "less", not "under 150mg" — the sentence frame already supplies a
      // preposition, and "with under 150mg" stacks two of them.
      lowLabel: { chip: cafUnderLabel, phrase: "less" },
      coverage: coverageNote("caffeine"),
      test: d => {
        if (!d.logged) return null
        return (d.caffeineMg ?? 0) >= cuts.caffeine.at
      },
    },
    {
      // Timing, with the amount held still: both sides had caffeine, only one
      // side had it late. Comparing late-caffeine days against no-caffeine
      // days would answer the first question again in different words.
      key: "late_caffeine",
      emoji: "🌙",
      title: "Caffeine After 16:00",
      highLabel: { chip: "caffeine after 16:00", phrase: "caffeine after 16:00" },
      lowLabel: { chip: "all caffeine before 16:00", phrase: "none after 16:00" },
      test: d => {
        if ((d.caffeineMg ?? 0) <= 0) return null
        return (d.lateCaffeineMg ?? 0) > 0
      },
    },
    {
      key: "alcohol",
      emoji: "🍷",
      title: "Alcohol",
      highLabel: { chip: "days with a drink", phrase: "a drink" },
      lowLabel: { chip: "days without", phrase: "none" },
      coverage: coverageNote("a drink"),
      test: d => {
        if (!d.logged) return null
        return (d.alcoholG ?? 0) > 0
      },
    },
    // Place as a moderator, not as a cause. "Every time I was at Kaviareň Vták
    // I had coffee" is the reason: a plain place-vs-elsewhere test on that café
    // is a caffeine test wearing a different hat, and would credit the room
    // with what the cup did. Both sides of this one had caffeine.
    ...caffeinePlaces.map((key): SleepCause => ({
      key: `caffeine_at_${key.replace(/\s+/g, "_")}`,
      emoji: "📍",
      title: `Caffeine At ${placeName(key)}`,
      highLabel: { chip: `caffeine at ${placeName(key)}`, phrase: `caffeine at ${placeName(key)}` },
      lowLabel: { chip: "caffeine anywhere else", phrase: "caffeine somewhere else" },
      test: d => {
        if ((d.caffeineMg ?? 0) <= 0) return null
        return (d.places ?? []).includes(key)
      },
    })),
  ]

  for (const cause of sleepCauses) {
    const gate = new Split()
    for (const d of days) {
      const side = cause.test(d)
      if (side == null) continue
      const night = byDate[nextDateStr(d.date)]
      if (night?.sleepScore == null) continue
      gate.add(side, night.sleepScore)
    }

    const gateIns = compareGroups({
      id: `sleep_panel_${cause.key}`,
      category: "sleep",
      emoji: cause.emoji,
      title: `${cause.title} & Sleep`,
      highGroupLabel: cause.highLabel,
      lowGroupLabel: cause.lowLabel,
      series: gate,
      // "Nights with X" rather than "After X": every cause is a thing a night
      // had or did not have, and the old frame stacked its own "After" on top
      // of a label that already carried one.
      findingTemplate: (hi, lo, l) =>
        `Nights with ${l.high} score ${hi}; nights with ${l.low}, ${lo}`,
    })
    if (!gateIns) continue
    if (cause.coverage) gateIns.coverage = cause.coverage

    // What else separates these two sides? Bedtime, usually — and it is the
    // biggest single lever on a sleep score this account has, so a panel card
    // that ignores it can hand the credit to the wrong thing entirely.
    const bedHi: number[] = []
    const bedLo: number[] = []
    for (const d of days) {
      const side = cause.test(d)
      if (side == null) continue
      const night = byDate[nextDateStr(d.date)]
      if (night?.bedtimeMin == null) continue
      ;(side ? bedHi : bedLo).push(night.bedtimeMin)
    }
    let confounded: string | undefined
    if (bedHi.length >= 5 && bedLo.length >= 5) {
      const gap = avg(bedHi) - avg(bedLo)
      if (Math.abs(gap) >= BEDTIME_CONFOUND_MIN) {
        const later = phraseOf(gap > 0 ? cause.highLabel : cause.lowLabel)
        confounded = `Bedtime does not hold still here. Nights with ${later} typically began ` +
          `${Math.round(Math.abs(gap))} minutes later, so some of this gap is bedtime.`
      }
    }
    if (confounded) gateIns.confounded = confounded
    insights.push(gateIns)

    // The gate is the licence to look closer. On the weekday-only guard pass
    // permutations are off and every p-value is 1, so the gate is held open —
    // that pass exists for its deltas, and a panel the guard could never see
    // would be a panel the weekend could quietly explain.
    if (permutationsOn && gateIns.pValue > SLEEP_GATE_P) continue

    for (const aspect of SLEEP_ASPECTS) {
      const series = new Split()
      for (const d of days) {
        const side = cause.test(d)
        if (side == null) continue
        const night = byDate[nextDateStr(d.date)]
        const v = night ? aspect.value(night) : undefined
        if (v == null) continue
        series.add(side, v)
      }
      const ins = compareGroups({
        id: `sleep_panel_${cause.key}_${aspect.key}`,
        category: "sleep",
        emoji: aspect.emoji,
        title: `${cause.title} & ${aspect.label[0].toUpperCase()}${aspect.label.slice(1)}`,
        highGroupLabel: cause.highLabel,
        lowGroupLabel: cause.lowLabel,
        series,
        higherIsBetter: aspect.higherIsBetter,
        findingTemplate: (hi, lo, l) =>
          `With ${l.high}, ${aspect.label} averages ${aspect.fmt(hi)}; with ${l.low}, ${aspect.fmt(lo)}`,
      })
      if (!ins) continue
      ins.pool = `sleep_panel_${cause.key}`
      if (cause.coverage) ins.coverage = cause.coverage
      if (confounded) ins.confounded = confounded
      insights.push(ins)
    }
  }

  // ── Places, on their own terms ────────────────────────────────────────────
  //
  // The places page has had its own answer to this since long before the
  // engine did, computed from a Google Timeline import that stopped being
  // written to in August, and reported as a bare difference of averages with
  // no test behind it at all. These are the live check-ins, and they face the
  // same four gates as everything else here: five days a side, ten for
  // "confident", a block permutation for the p-value, and the same
  // false-discovery correction.
  for (const key of placesToTest) {
    const label = placeName(key)
    const nightSeries = new Split()
    const moodSeries = new Split()
    for (const d of days) {
      // A day with no check-in at all is not a day you were elsewhere — the
      // phone was off, or the place was never saved. Counting it as "elsewhere"
      // is the same mistake as reading a silent day as decaf, and the control
      // group is the one that would quietly absorb it.
      if (d.places == null) continue
      const there = d.places.includes(key)
      const night = byDate[nextDateStr(d.date)]
      if (night?.sleepScore != null) nightSeries.add(there, night.sleepScore)
      if (d.mood != null) moodSeries.add(there, d.mood)
    }

    const insSleep = compareGroups({
      id: `place_sleep_${key.replace(/\s+/g, "_")}`,
      category: "places",
      emoji: "📍",
      title: `${label} & That Night's Sleep`,
      highGroupLabel: `days at ${label}`,
      lowGroupLabel: "other days",
      series: nightSeries,
      findingTemplate: (hi, lo) =>
        `The night after a day at ${label} scores ${hi}; other nights, ${lo}`,
    })
    if (insSleep) insights.push(insSleep)

    const insMood = compareGroups({
      id: `place_mood_${key.replace(/\s+/g, "_")}`,
      category: "places",
      emoji: "🙂",
      title: `${label} & Mood`,
      highGroupLabel: `days at ${label}`,
      lowGroupLabel: "other days",
      series: moodSeries,
      findingTemplate: (hi, lo) => `Mood averages ${hi} on days at ${label}, ${lo} on other days`,
    })
    if (insMood) insights.push(insMood)
  }

  return insights
  } // end deriveInsights

  const insights = deriveInsights(allDays)

  // ── Consistency, streaks & absence ─────────────────────────────────
  //
  // Three families deliberately kept OUTSIDE deriveInsights, because that
  // function is re-run on weekday-only days as the weekend guard — a filter
  // that shreds every notion of "consecutive nights" or "last 14 days".
  // Their ids are unique, so the guard below no-ops on them (`wk` undefined),
  // which is what we want: these are already time-aware, they don't need a
  // weekend twin.
  //
  // Consistency asks whether a metric being close to its usual value beats
  // a scattered version of the same metric. Streaks ask whether the third
  // short night hurts differently than the first. Absence notices what you
  // used to do and haven't recently, and reports how that period reads
  // against the days when you did do it. Onset (first weeks of a new habit)
  // and withdrawal (weeks after stopping one) need pre-window history to be
  // done honestly, so they wait for a future pass.

  if (allDays.length >= 21) {
    const byDate = new Map(allDays.map(d => [d.date, d]))
    const firstDate = allDays[0].date
    const lastDate = allDays[allDays.length - 1].date
    const dense: DayData[] = []
    for (
      let ts = Date.parse(firstDate + "T12:00:00Z");
      ts <= Date.parse(lastDate + "T12:00:00Z");
      ts += 86400000
    ) {
      const dateStr = new Date(ts).toISOString().slice(0, 10)
      dense.push(byDate.get(dateStr) ?? { date: dateStr })
    }

    // ── Consistency ────────────────────────────────────────────────
    // Compare next-day energy/mood on days close to the personal median for
    // a rhythm metric against days far from it. Uses median rather than mean
    // for robustness — one outlier week shouldn't move the yardstick.
    const consistencyFamily = (
      id: string,
      label: string,
      emoji: string,
      accessor: (d: DayData) => number | null | undefined,
      regularWithin: number,
      scatteredBeyond: number,
    ) => {
      const vals = dense.map(accessor).filter((v): v is number => v != null && Number.isFinite(v))
      if (vals.length < 14) return
      const centre = median(vals)
      const regEnergySplit = new Split()
      const regMoodSplit = new Split()
      for (let i = 0; i < dense.length - 1; i++) {
        const v = accessor(dense[i])
        if (v == null || !Number.isFinite(v)) continue
        const off = Math.abs(v - centre)
        const isReg = off <= regularWithin
        const isScat = off > scatteredBeyond
        if (!isReg && !isScat) continue
        const next = dense[i + 1]
        if (next.energy != null) regEnergySplit.add(isReg, next.energy)
        if (next.mood != null) regMoodSplit.add(isReg, next.mood)
      }
      const eIns = compareGroups({
        id: `consistency_${id}_energy`, category: "consistency", emoji,
        title: `${label} Consistency & Next-Day Energy`,
        highGroupLabel: `regular ${label.toLowerCase()}`,
        lowGroupLabel: `scattered ${label.toLowerCase()}`,
        series: regEnergySplit,
        findingTemplate: (h, l) =>
          `Close to your usual ${label.toLowerCase()}, next-day energy averages ${h}; on scattered days, ${l}`,
      })
      if (eIns) insights.push(eIns)
      const mIns = compareGroups({
        id: `consistency_${id}_mood`, category: "consistency", emoji,
        title: `${label} Consistency & Next-Day Mood`,
        highGroupLabel: `regular ${label.toLowerCase()}`,
        lowGroupLabel: `scattered ${label.toLowerCase()}`,
        series: regMoodSplit,
        findingTemplate: (h, l) =>
          h > l
            ? `Close to your usual ${label.toLowerCase()}, next-day mood averages ${h} vs ${l} on scattered days`
            : `Consistent ${label.toLowerCase()} doesn't lift your mood — ${h} vs ${l} on scattered days`,
      })
      if (mIns) insights.push(mIns)
    }

    // Sleep length in hours; wake time / meal time in minutes after midnight.
    consistencyFamily("sleep_duration", "Sleep Length", "🌙",
      d => d.sleepDuration, 0.5, 1.5)
    consistencyFamily("wake_time", "Wake Time", "☀️",
      d => d.firstUnlockMin, 30, 90)
    consistencyFamily("meal_time", "Last-Meal Time", "🍽️",
      d => d.lastMealMin, 60, 120)

    // ── Streaks ────────────────────────────────────────────────────
    // Count how many consecutive days a predicate held true, ending at each
    // index. Then compare "the day after a long streak" with "the day after
    // an isolated one" — a comparison invisible to the single-day families.
    const streakLen = (predicate: (d: DayData) => boolean): number[] => {
      const out = new Array<number>(dense.length).fill(0)
      let run = 0
      for (let i = 0; i < dense.length; i++) {
        run = predicate(dense[i]) ? run + 1 : 0
        out[i] = run
      }
      return out
    }

    const shortSleep = streakLen(d => d.sleepDuration != null && d.sleepDuration < 7)
    const singleESplit = new Split()
    const singleMSplit = new Split()
    for (let i = 0; i < dense.length - 1; i++) {
      const n = shortSleep[i]
      const next = dense[i + 1]
      if (n === 1) {
        if (next.energy != null) singleESplit.add(true, next.energy)
        if (next.mood != null) singleMSplit.add(true, next.mood)
      } else if (n >= 3) {
        if (next.energy != null) singleESplit.add(false, next.energy)
        if (next.mood != null) singleMSplit.add(false, next.mood)
      }
    }
    const shortE = compareGroups({
      id: "streak_short_sleep_energy", category: "streaks", emoji: "😩",
      title: "Short-Sleep Streaks & Morning Energy",
      highGroupLabel: "one short night", lowGroupLabel: "3+ short nights in a row",
      series: singleESplit,
      findingTemplate: (h, l) =>
        `Morning after one short night: energy ${h}. Morning after three or more in a row: ${l}`,
    })
    if (shortE) insights.push(shortE)
    const shortM = compareGroups({
      id: "streak_short_sleep_mood", category: "streaks", emoji: "🥀",
      title: "Short-Sleep Streaks & Mood",
      highGroupLabel: "one short night", lowGroupLabel: "3+ short nights in a row",
      series: singleMSplit,
      findingTemplate: (h, l) =>
        `Morning mood after one short night: ${h}. After three or more in a row: ${l}`,
    })
    if (shortM) insights.push(shortM)

    // Back-to-back drinking. The HRV recorded for the morning is the
    // consequence of the night before it — so day D+1 records the effect of
    // day D's alcohol.
    const alc = streakLen(d => (d.alcoholG ?? 0) > 0)
    const alcSingleSplit = new Split()
    for (let i = 0; i < dense.length - 1; i++) {
      const n = alc[i]
      const nextHrv = dense[i + 1].hrv
      if (nextHrv == null) continue
      if (n === 1) alcSingleSplit.add(true, nextHrv)
      else if (n >= 2) alcSingleSplit.add(false, nextHrv)
    }
    const alcIns = compareGroups({
      id: "streak_alcohol_hrv", category: "streaks", emoji: "🍷",
      title: "Back-to-Back Drinking Nights & HRV",
      highGroupLabel: "one drinking night", lowGroupLabel: "2+ nights in a row",
      series: alcSingleSplit,
      findingTemplate: (h, l) =>
        `Morning HRV after a single drinking night: ${Math.round(h)}. After two or more nights in a row: ${Math.round(l)}`,
    })
    if (alcIns) insights.push(alcIns)

    // ── Absence ────────────────────────────────────────────────────
    // What you used to do most weeks and haven't in 14+ days. Frame it as
    // "days you did it (older 90d)" vs "the recent gap": the card carries the
    // familiar delta shape, but the story it tells is about a change in
    // behaviour rather than a between-days comparison.
    const GAP_DAYS = 14
    const MIN_PRIOR = 8
    const recentStart = Math.max(0, dense.length - GAP_DAYS)
    const priorDays = dense.slice(0, recentStart)
    const gapDays = dense.slice(recentStart)
    if (gapDays.length >= 7) {
      const absenceCheck = (
        id: string, label: string, emoji: string,
        predicate: (d: DayData) => boolean,
        accessor: (d: DayData) => number | null | undefined,
        metricLabel: string,
      ) => {
        const priorPresent = priorDays.filter(predicate)
        if (priorPresent.length < MIN_PRIOR) return
        const gapPresent = gapDays.filter(predicate)
        // Absent = happened often before, barely at all in the recent window.
        if (gapPresent.length > 1) return
        // Prior days then gap days IS date order, so the labels form two
        // contiguous runs — and block permutation's null is then "any
        // similar chunk of the timeline vs the rest", which is exactly the
        // honest null for a did-the-level-recently-change claim. The old
        // day-shuffle was at its most optimistic on this family.
        const seq = new Split()
        for (const d of priorPresent) {
          const v = accessor(d)
          if (v != null && Number.isFinite(v)) seq.add(true, v)
        }
        for (const d of gapDays) {
          const v = accessor(d)
          if (v != null && Number.isFinite(v)) seq.add(false, v)
        }
        const ins = compareGroups({
          id: `absence_${id}`, category: "absence", emoji,
          title: `Missing: ${label}`,
          highGroupLabel: `days you did (past 3 months)`,
          lowGroupLabel: `the last ${GAP_DAYS} days without`,
          series: seq,
          findingTemplate: (h, l) =>
            `"${label}" has not come up in ${GAP_DAYS} days. When it did, ${metricLabel} averaged ${h}; since then, ${l}`,
        })
        if (ins) insights.push(ins)
      }

      // Concrete absences from data already in DayData. Habit/tag names
      // aren't in DayData (only counts), so the walker below picks tags.
      absenceCheck("walking", "walking 20+ min", "🚶",
        d => (d.walkMin ?? 0) >= 20, d => d.mood, "mood")
      absenceCheck("workout", "a workout", "💪",
        d => (d.workoutMin ?? 0) >= 20, d => d.energy, "morning energy")
      absenceCheck("focus", "a focus session", "🎯",
        d => (d.focusMin ?? 0) >= 25, d => d.mood, "mood")

      // Top tags by prior frequency — up to three, only if each is common
      // enough on its own to warrant a card.
      const tagCounts = new Map<string, number>()
      for (const d of priorDays) for (const t of d.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)
      const topTags = [...tagCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
      for (const [tag] of topTags) {
        absenceCheck(`tag_${tag}`, tag, "🏷️",
          d => (d.tags ?? []).includes(tag), d => d.mood, "mood")
      }
    }

    // ── Onset ──────────────────────────────────────────────────────
    // Tags that started appearing inside the window — nothing for the first
    // stretch, then a run of them. Compare the outcomes on the "new" days
    // to a matched-length baseline of days before it entered your life.
    // Withdrawal (the mirror — outcomes after you stop) needs pre-window
    // context we don't load, so it waits for a future pass.
    const ONSET_QUIET_HEAD = 14   // days that must be silent before the tag counts as new
    const ONSET_MIN_ADOPTIONS = 6 // occurrences after the first — otherwise it's a one-off
    const tagFirstIdx = new Map<string, number>()
    const tagOccurrences = new Map<string, number>()
    for (let i = 0; i < dense.length; i++) {
      for (const t of dense[i].tags ?? []) {
        if (!tagFirstIdx.has(t)) tagFirstIdx.set(t, i)
        tagOccurrences.set(t, (tagOccurrences.get(t) ?? 0) + 1)
      }
    }
    for (const [tag, firstIdx] of tagFirstIdx) {
      if (firstIdx < ONSET_QUIET_HEAD) continue
      if ((tagOccurrences.get(tag) ?? 0) < ONSET_MIN_ADOPTIONS) continue
      // "After" = from first appearance to end; "before" = an equal-length
      // window immediately preceding it (matched length keeps sample sizes
      // comparable and puts the seasons close together too).
      const afterDays = dense.slice(firstIdx)
      const beforeStart = Math.max(0, firstIdx - afterDays.length)
      const beforeDays = dense.slice(beforeStart, firstIdx)
      // Before-days precede after-days, so pushing them in that order keeps
      // the sequence chronological; same segmented-runs argument as the
      // absence family above.
      const onsetMood = new Split()
      const onsetEnergy = new Split()
      for (const d of beforeDays) {
        if (d.mood != null) onsetMood.add(false, d.mood)
        if (d.energy != null) onsetEnergy.add(false, d.energy)
      }
      for (const d of afterDays) {
        if (d.mood != null) onsetMood.add(true, d.mood)
        if (d.energy != null) onsetEnergy.add(true, d.energy)
      }
      const iMood = compareGroups({
        id: `onset_${tag}_mood`, category: "streaks", emoji: "🌱",
        title: `New in your life: ${tag} & Mood`,
        highGroupLabel: `since "${tag}" appeared`,
        lowGroupLabel: `before it started`,
        series: onsetMood,
        findingTemplate: (h, l) =>
          `Since "${tag}" appeared, mood averages ${h}; over the same stretch before, ${l}`,
      })
      if (iMood) insights.push(iMood)
      const iEnergy = compareGroups({
        id: `onset_${tag}_energy`, category: "streaks", emoji: "🌱",
        title: `New in your life: ${tag} & Energy`,
        highGroupLabel: `since "${tag}" appeared`,
        lowGroupLabel: `before it started`,
        series: onsetEnergy,
        findingTemplate: (h, l) =>
          `Since "${tag}" appeared, morning energy averages ${h}; over the same stretch before, ${l}`,
      })
      if (iEnergy) insights.push(iEnergy)
    }

    // ── Two-way interactions ──────────────────────────────────────
    //
    // A curated set on purpose. Testing every pair (predictor × moderator)
    // burns sample size (each split cuts n by roughly a quarter), fills the
    // page with variants of the same story, and gives false-discovery
    // control an impossible job. The tuples here are hypotheses worth
    // asking of most people's data — "does exercise soften alcohol's HRV
    // hit", "does a walk the next day rescue you from a short night".
    //
    // A card only appears when the moderator actually changes the story:
    // either it flips the effect's sign, or it changes the size of the
    // effect by at least a third. A finding that reproduces identically
    // with and without the moderator is not an interaction — it is the
    // main effect, which has its own card elsewhere.
    //
    // The lower-level "compareGroups" helper is deliberately not reused
    // here — that helper reports one delta between two groups, and the
    // story an interaction wants to tell is the difference between two
    // deltas. So the code below builds the four-cell cross-tab itself
    // and formats the finding around the contrast.

    interface InteractionDef {
      id: string
      title: string
      emoji: string
      /** The behaviour being studied — measured on day D. */
      predictor: { label: string; predicate: (d: DayData) => boolean }
      /**
       * Days this question can be asked of at all. Everything else is dropped
       * before the 2×2 is built rather than filed under "didn't do it".
       *
       * The caffeine interactions need it: a predicate is a boolean, and a day
       * with nothing logged answers `false` to "any caffeine day" in exactly
       * the same voice as a day you drank water and no coffee. One of those is
       * a control and the other is a day nobody wrote anything down.
       */
      eligible?: (d: DayData) => boolean
      /** The number being watched — measured on day D or D+1. */
      outcome: {
        label: string
        nextDay: boolean
        accessor: (d: DayData) => number | null | undefined
        higherIsBetter: boolean
      }
      /** The condition that might change the effect. Measured on the day of
       *  the predictor unless otherwise noted. */
      moderator: {
        key: string
        onLabel: string
        offLabel: string
        predicate: (d: DayData) => boolean
        /** false = moderator measured on the predictor day (D); true = on the outcome day (D+1). */
        onOutcomeDay?: boolean
      }
    }

    const INTERACTIONS: InteractionDef[] = [
      {
        id: "alcohol_hrv_by_workout",
        title: "Alcohol → HRV × Workout that day",
        emoji: "🍷",
        predictor: { label: "drinking day", predicate: d => (d.alcoholG ?? 0) > 0 },
        outcome: { label: "morning HRV", nextDay: true, accessor: d => d.hrv, higherIsBetter: true },
        moderator: { key: "workout", onLabel: "with a workout that day", offLabel: "without a workout",
                     predicate: d => (d.workoutMin ?? 0) >= 20 },
      },
      {
        id: "alcohol_sleep_by_early_dinner",
        title: "Alcohol → Sleep × Early dinner",
        emoji: "🌙",
        predictor: { label: "drinking day", predicate: d => (d.alcoholG ?? 0) > 0 },
        outcome: { label: "sleep score", nextDay: false, accessor: d => d.sleepScore, higherIsBetter: true },
        moderator: { key: "early_dinner", onLabel: "when dinner was before 8pm", offLabel: "when it was later",
                     predicate: d => d.lastMealMin != null && d.lastMealMin < 20 * 60 },
      },
      {
        id: "short_sleep_mood_by_next_workout",
        title: "Short sleep → Mood × Workout next day",
        emoji: "💪",
        predictor: { label: "night under 7h", predicate: d => d.sleepDuration != null && d.sleepDuration < 7 },
        outcome: { label: "next-day mood", nextDay: true, accessor: d => d.mood, higherIsBetter: true },
        moderator: { key: "workout_next", onLabel: "when you worked out that day",
                     offLabel: "when you didn't",
                     predicate: d => (d.workoutMin ?? 0) >= 20, onOutcomeDay: true },
      },
      {
        id: "short_sleep_energy_by_next_workout",
        title: "Short sleep → Energy × Workout next day",
        emoji: "🏃",
        predictor: { label: "night under 7h", predicate: d => d.sleepDuration != null && d.sleepDuration < 7 },
        outcome: { label: "next-day energy", nextDay: true, accessor: d => d.energy, higherIsBetter: true },
        moderator: { key: "workout_next", onLabel: "when you worked out that day",
                     offLabel: "when you didn't",
                     predicate: d => (d.workoutMin ?? 0) >= 20, onOutcomeDay: true },
      },
      {
        id: "caffeine_sleep_by_amount",
        // A silent day is not a decaf day — see InteractionDef.eligible.
        eligible: d => d.logged === true || d.caffeineMg != null,
        title: "Caffeine → Sleep × Heavy vs light",
        emoji: "☕",
        predictor: { label: "any caffeine day", predicate: d => (d.caffeineMg ?? 0) > 0 },
        outcome: { label: "sleep score", nextDay: false, accessor: d => d.sleepScore, higherIsBetter: true },
        moderator: { key: "heavy_caffeine", onLabel: `on ${cafLabel} days`, offLabel: "on lighter days",
                     predicate: d => (d.caffeineMg ?? 0) >= cuts.caffeine.at },
      },
      // Latency and efficiency have been stored on 91% of nights for months and
      // never read. These two are deliberately pre-registered rather than a
      // sweep: every family costs false-discovery budget for all the others, so
      // they are the two questions worth spending it on. "Does coffee keep me
      // lying there" is not answerable from sleep score, which mixes latency in
      // with six other things.
      {
        id: "caffeine_latency_by_amount",
        // A silent day is not a decaf day — see InteractionDef.eligible.
        eligible: d => d.logged === true || d.caffeineMg != null,
        title: "Caffeine → Time to fall asleep × Heavy vs light",
        emoji: "☕",
        predictor: { label: "any caffeine day", predicate: d => (d.caffeineMg ?? 0) > 0 },
        outcome: { label: "minutes to fall asleep", nextDay: false, accessor: d => d.sleepLatencyMin, higherIsBetter: false },
        moderator: { key: "heavy_caffeine", onLabel: `on ${cafLabel} days`, offLabel: "on lighter days",
                     predicate: d => (d.caffeineMg ?? 0) >= cuts.caffeine.at },
      },
      {
        id: "alcohol_efficiency_by_early_dinner",
        title: "Alcohol → Sleep efficiency × Early dinner",
        emoji: "🍷",
        predictor: { label: "drinking day", predicate: d => (d.alcoholG ?? 0) > 0 },
        outcome: { label: "sleep efficiency", nextDay: false, accessor: d => d.sleepEfficiency, higherIsBetter: true },
        moderator: { key: "early_dinner", onLabel: "when dinner was before 8pm", offLabel: "when it was later",
                     predicate: d => d.lastMealMin != null && d.lastMealMin < 20 * 60 },
      },
      {
        id: "long_calendar_sleep_by_workout",
        title: "Busy day → Sleep × Workout",
        emoji: "📅",
        predictor: { label: "busy day (5+ events)", predicate: d => (d.eventCount ?? 0) >= 5 },
        outcome: { label: "sleep score", nextDay: false, accessor: d => d.sleepScore, higherIsBetter: true },
        moderator: { key: "workout", onLabel: "with a workout that day", offLabel: "without one",
                     predicate: d => (d.workoutMin ?? 0) >= 20 },
      },
      {
        id: "workout_energy_by_sleep_prior",
        title: "Workout → Energy × Slept well the night before",
        emoji: "😴",
        predictor: { label: "workout day", predicate: d => (d.workoutMin ?? 0) >= 20 },
        outcome: { label: "same-day energy", nextDay: false, accessor: d => d.energy, higherIsBetter: true },
        moderator: { key: "slept_well_prior", onLabel: "on well-rested days", offLabel: "on tired ones",
                     predicate: d => (d.sleepDuration ?? 0) >= 7 },
      },
      {
        id: "screen_sleep_by_late_use",
        title: "Screen time → Sleep × Regular wake time",
        emoji: "📱",
        predictor: { label: "a heavy screen day", predicate: () => false /* set below */ },
        outcome: { label: "sleep score", nextDay: false, accessor: d => d.sleepScore, higherIsBetter: true },
        moderator: { key: "regular_wake", onLabel: "on days with a regular wake time",
                     offLabel: "on scattered ones", predicate: () => false /* set below */ },
      },
      {
        id: "alcohol_energy_by_water",
        title: "Alcohol → Next-day Energy × Water intake",
        emoji: "💧",
        predictor: { label: "drinking day", predicate: d => (d.alcoholG ?? 0) > 0 },
        outcome: { label: "next-day energy", nextDay: true, accessor: d => d.energy, higherIsBetter: true },
        moderator: { key: "hydrated", onLabel: `when you drank ${waterLabel}+ of fluid`,
                     offLabel: "when you didn't",
                     predicate: d => (d.waterMl ?? 0) >= cuts.water.at },
      },
      {
        id: "late_meal_sleep_by_alcohol",
        title: "Late meals → Sleep × Alcohol that day",
        emoji: "🍽️",
        predictor: { label: "late-meal day (after 9pm)",
                     predicate: d => d.lastMealMin != null && d.lastMealMin >= 21 * 60 },
        outcome: { label: "sleep score", nextDay: false, accessor: d => d.sleepScore, higherIsBetter: true },
        moderator: { key: "alcohol", onLabel: "when alcohol was also involved",
                     offLabel: "on dry late-meal days",
                     predicate: d => (d.alcoholG ?? 0) > 0 },
      },
    ]

    // Personal thresholds for the interactions that need them, computed once.
    const screenVals = dense.map(d => d.screenTimeMin).filter((v): v is number => v != null && v > 0)
    const screenP66 = screenVals.length >= 10
      ? [...screenVals].sort((a, b) => a - b)[Math.floor(screenVals.length * 0.66)]
      : Number.POSITIVE_INFINITY
    const wakeVals = dense.map(d => d.firstUnlockMin).filter((v): v is number => v != null)
    const wakeMedian = wakeVals.length >= 10 ? median(wakeVals) : 0
    // Point the two placeholders at the personal thresholds now they exist.
    for (const def of INTERACTIONS) {
      if (def.id === "screen_sleep_by_late_use") {
        def.predictor.predicate = d => (d.screenTimeMin ?? 0) >= screenP66
        def.moderator.predicate = d => d.firstUnlockMin != null &&
          Math.abs(d.firstUnlockMin - wakeMedian) <= 30
      }
    }

    const MIN_CELL = 4  // need this many days in each of the four cells
    const CHANGE_THRESHOLD = 0.35  // effect size must shift ≥35% or flip sign
    for (const def of INTERACTIONS) {
      const cells: { on: { yes: number[]; no: number[] }, off: { yes: number[]; no: number[] } } = {
        on:  { yes: [], no: [] },
        off: { yes: [], no: [] },
      }
      for (let i = 0; i < dense.length - (def.outcome.nextDay ? 1 : 0); i++) {
        const day = dense[i]
        if (def.eligible && !def.eligible(day)) continue
        if (!def.predictor.predicate(day)) {
          // Also need the "did NOT do predictor" side for comparison.
          const outcomeDay = def.outcome.nextDay ? dense[i + 1] : day
          const val = def.outcome.accessor(outcomeDay)
          if (val == null || !Number.isFinite(val)) continue
          const modDay = def.moderator.onOutcomeDay ? outcomeDay : day
          const mod = def.moderator.predicate(modDay)
          ;(mod ? cells.on : cells.off).no.push(val)
          continue
        }
        const outcomeDay = def.outcome.nextDay ? dense[i + 1] : day
        const val = def.outcome.accessor(outcomeDay)
        if (val == null || !Number.isFinite(val)) continue
        const modDay = def.moderator.onOutcomeDay ? outcomeDay : day
        const mod = def.moderator.predicate(modDay)
        ;(mod ? cells.on : cells.off).yes.push(val)
      }

      if (cells.on.yes.length < MIN_CELL || cells.on.no.length < MIN_CELL) continue
      if (cells.off.yes.length < MIN_CELL || cells.off.no.length < MIN_CELL) continue

      const onEffect = r1(avg(cells.on.yes) - avg(cells.on.no))
      const offEffect = r1(avg(cells.off.yes) - avg(cells.off.no))
      const swings = Math.sign(onEffect) !== Math.sign(offEffect)
      const shrinks = Math.abs(offEffect) > 0 &&
        Math.abs(offEffect - onEffect) / Math.abs(offEffect) >= CHANGE_THRESHOLD
      if (!swings && !shrinks) continue

      // Frame the story around whichever effect is larger — that's the story
      // that changes when the moderator is present.
      const dominant = Math.abs(offEffect) >= Math.abs(onEffect) ? "off" : "on"
      const dominantLabel = dominant === "off" ? def.moderator.offLabel : def.moderator.onLabel
      const otherLabel = dominant === "off" ? def.moderator.onLabel : def.moderator.offLabel
      const dominantEffect = dominant === "off" ? offEffect : onEffect
      const otherEffect = dominant === "off" ? onEffect : offEffect
      const direction = dominantEffect >= 0 ? "lifts" : "drops"
      const bigger = Math.abs(dominantEffect)
      const smaller = Math.abs(otherEffect)

      // A single "insight" value for the ordering: how much the moderator
      // moves the effect. Use the difference between the two effects as the
      // delta — that IS the interaction.
      const interactionDelta = ((offEffect - onEffect) / (Math.abs(offEffect) || 1)) * 100

      insights.push({
        id: `interaction_${def.id}`,
        category: "interactions",
        emoji: def.emoji,
        title: def.title,
        finding: swings
          ? `${def.predictor.label} ${direction} ${def.outcome.label} by ${bigger} ${dominantLabel} — but ${otherLabel} the effect flips to ${otherEffect > 0 ? "+" : ""}${otherEffect}`
          : `${def.predictor.label} ${direction} ${def.outcome.label} by ${bigger} ${dominantLabel}; ${otherLabel} the same change is only ${smaller}`,
        delta: Math.round(interactionDelta * 10) / 10,
        highGroupLabel: dominantLabel,
        lowGroupLabel: otherLabel,
        highGroupAvg: r1(avg(dominant === "off" ? cells.off.yes : cells.on.yes)),
        lowGroupAvg: r1(avg(dominant === "off" ? cells.on.yes : cells.off.yes)),
        highGroupN: (dominant === "off" ? cells.off.yes.length : cells.on.yes.length),
        lowGroupN: (dominant === "off" ? cells.on.yes.length : cells.off.yes.length),
        confident: cells.on.yes.length + cells.off.yes.length >= 20,
        // The effect-change threshold above says the moderator moved the
        // story enough to be worth a card; this says the move is bigger than
        // shuffling the same days around produces. Both are needed — with
        // four cells of four days, a 35% shift is well within what chance
        // manages, and this family used to ship those as findings.
        pValue: permutationsOn
          ? interactionPermutationP(cells.on.yes, cells.on.no, cells.off.yes, cells.off.no,
                                    `interaction_${def.id}`)
          : 1,
        tier: "noise",
      })
    }

    // ── Combinations: two and three things at once ────────────────
    //
    // The interactions above ask whether a moderator changes an effect. This
    // asks the blunter question people actually have: "when I do A AND B
    // (and C) on the same day, how do I wake up?" A conjunction is a single
    // predictor, so it gets the ordinary two-group comparison, the block
    // permutation test and the weekend guard like any other card.
    //
    // What keeps it from being a fishing trip: a combination has to EARN its
    // card by beating the best thing inside it. A pair must move the outcome
    // at least a third more than either ingredient alone; a triple a third
    // more than any of its pairs — otherwise the card would only restate a
    // main effect that already has one. Triples are grown only from pairs
    // that passed, so the search is apriori-shaped and the number of tests
    // stays small enough for the FDR step to mean something. Every outcome is
    // read the NEXT morning: the day's behaviour, then the night's verdict.
    interface ComboCondition {
      key: string
      /** Title form — "Alcohol", "Late meal". */
      short: string
      /** Sentence form — "alcohol", "a late meal". */
      label: string
      test: (d: DayData) => boolean
    }
    const COMBO_CONDITIONS: ComboCondition[] = [
      { key: "alcohol", short: "Alcohol", label: "alcohol", test: d => (d.alcoholG ?? 0) > 0 },
      { key: "caffeine", short: "Heavy caffeine", label: `${cafLabel} of caffeine`, test: d => (d.caffeineMg ?? 0) >= cuts.caffeine.at },
      { key: "late_meal", short: "Late meal", label: "a late meal", test: d => d.lastMealMin != null && d.lastMealMin >= 21 * 60 },
      { key: "short_night", short: "Short night", label: "a short night before", test: d => d.sleepDuration != null && d.sleepDuration < 7 },
      { key: "workout", short: "Workout", label: "a workout", test: d => (d.workoutMin ?? 0) >= 20 },
      { key: "hydrated", short: "Hydrated", label: `${waterLabel}+ of fluid`, test: d => (d.waterMl ?? 0) >= cuts.water.at },
      { key: "busy", short: "Busy day", label: "a busy calendar", test: d => (d.eventCount ?? 0) >= 5 },
      { key: "screen", short: "Heavy screen", label: "heavy screen time", test: d => (d.screenTimeMin ?? 0) >= screenP66 },
      { key: "stress", short: "High stress", label: stressLabel, test: d => (d.stressHighMin ?? 0) >= cuts.stress.at },
      { key: "away", short: "Away", label: "a day away from home", test: d => d.presence === "away" },
    ]
    const COMBO_OUTCOMES: { key: string; label: string; emoji: string; accessor: (d: DayData) => number | null | undefined }[] = [
      { key: "sleep", label: "sleep score", emoji: "😴", accessor: d => d.sleepScore },
      { key: "hrv", label: "morning HRV", emoji: "💓", accessor: d => d.hrv },
      { key: "readiness", label: "readiness", emoji: "🔋", accessor: d => d.readiness },
      { key: "energy", label: "next-day energy", emoji: "⚡", accessor: d => d.energy },
      { key: "mood", label: "next-day mood", emoji: "🙂", accessor: d => d.mood },
    ]

    // Fewer days than this on either side and the comparison cannot carry a
    // claim — the same footing the weekend guard demands.
    const MIN_COMBO_DAYS = 8
    // A third more than the best ingredient, in the same direction.
    const COMBO_GAIN = 1.34
    // Below this a "combination" is noise dressed up, whatever its parts did.
    const COMBO_MIN_ABS = 5
    // Per outcome; every extra card is FDR budget spent for everyone else.
    const COMBO_MAX_PER_OUTCOME = 3

    // A condition nobody's data ever meets (or always meets) can only make
    // empty cells; drop it before it multiplies through the pairs.
    const active = COMBO_CONDITIONS.filter(c => {
      const n = dense.filter(c.test).length
      return n >= MIN_COMBO_DAYS && dense.length - n >= MIN_COMBO_DAYS
    })

    // Day-ordered observations: the conjunction on day D against the next
    // morning's reading, so the block permutation sees the real sequence.
    const comboSeries = (conds: ComboCondition[], accessor: (d: DayData) => number | null | undefined): Split => {
      const s = new Split()
      for (let i = 0; i < dense.length - 1; i++) {
        const v = accessor(dense[i + 1])
        if (v == null || !Number.isFinite(v)) continue
        s.add(conds.every(c => c.test(dense[i])), v)
      }
      return s
    }
    // Effect size alone — the cheap read used to rank ingredients. The
    // permutation test runs once, on the card that survives.
    const comboDelta = (s: Split): number | null => {
      const hi = s.high, lo = s.low
      if (hi.length < MIN_COMBO_DAYS || lo.length < MIN_COMBO_DAYS) return null
      const h = avg(hi), l = avg(lo)
      const base = Math.abs(l) || Math.abs(h)
      return base ? ((h - l) / base) * 100 : null
    }
    // The strongest of the parts, signed — what the whole has to beat.
    const strongest = (parts: (number | undefined)[]): number =>
      parts.reduce<number>((best, p) => (p != null && Math.abs(p) > Math.abs(best) ? p : best), 0)
    const earns = (delta: number, best: number): boolean =>
      Math.abs(delta) >= COMBO_MIN_ABS &&
      (best === 0 || (Math.sign(delta) === Math.sign(best) && Math.abs(delta) >= Math.abs(best) * COMBO_GAIN))
    const andList = (labels: string[]) =>
      labels.length <= 2 ? labels.join(" and ") : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`

    for (const outcome of COMBO_OUTCOMES) {
      const single = new Map<string, number>()
      for (const c of active) {
        const d = comboDelta(comboSeries([c], outcome.accessor))
        if (d != null) single.set(c.key, d)
      }

      type Combo = { conds: ComboCondition[]; delta: number; series: Split; beats: { label: string; delta: number } }
      const pairDelta = new Map<string, number>()
      const pairs: Combo[] = []
      for (let a = 0; a < active.length; a++) {
        for (let b = a + 1; b < active.length; b++) {
          const conds = [active[a], active[b]]
          const series = comboSeries(conds, outcome.accessor)
          const delta = comboDelta(series)
          if (delta == null) continue
          pairDelta.set(`${active[a].key}+${active[b].key}`, delta)
          const sa = single.get(active[a].key), sb = single.get(active[b].key)
          const best = strongest([sa, sb])
          if (!earns(delta, best)) continue
          const beatsLabel = best === sa ? active[a].short : active[b].short
          pairs.push({ conds, delta, series, beats: { label: `${beatsLabel.toLowerCase()} alone`, delta: best } })
        }
      }

      const triples: Combo[] = []
      const seenTriple = new Set<string>()
      for (const pair of pairs) {
        for (const c of active) {
          if (pair.conds.includes(c)) continue
          const conds = [...pair.conds, c].sort((x, y) => active.indexOf(x) - active.indexOf(y))
          const key = conds.map(k => k.key).join("+")
          if (seenTriple.has(key)) continue
          seenTriple.add(key)
          const series = comboSeries(conds, outcome.accessor)
          const delta = comboDelta(series)
          if (delta == null) continue
          const subs = [[0, 1], [0, 2], [1, 2]].map(([x, y]) => ({
            label: `${conds[x].short} + ${conds[y].short}`.toLowerCase(),
            delta: pairDelta.get(`${conds[x].key}+${conds[y].key}`),
          }))
          const best = strongest(subs.map(s => s.delta))
          if (!earns(delta, best)) continue
          const beatsSub = subs.find(s => s.delta === best)
          triples.push({ conds, delta, series, beats: { label: beatsSub ? `${beatsSub.label} together` : "either pair", delta: best } })
        }
      }

      // A triple already tells its pairs' story better than they do, so a
      // pair inside an emitted triple steps aside for it.
      const coveredByTriple = (p: Combo) =>
        triples.some(t => p.conds.every(c => t.conds.includes(c)))
      const candidates = [...triples, ...pairs.filter(p => !coveredByTriple(p))]
        .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
        .slice(0, COMBO_MAX_PER_OUTCOME)

      for (const combo of candidates) {
        const labels = combo.conds.map(c => c.label)
        const ins = compareGroups({
          id: `combo_${outcome.key}_${combo.conds.map(c => c.key).join("_")}`,
          category: "interactions",
          emoji: outcome.emoji,
          title: `${combo.conds.map(c => c.short).join(" + ")} → ${outcome.label}`,
          highGroupLabel: `days with ${andList(labels)}`,
          lowGroupLabel: "all other days",
          series: combo.series,
          minN: MIN_COMBO_DAYS,
          // Two sentences. One ran to thirty-one words and ended on a bare
          // percentage whose base was never stated — the card's own delta
          // already shows the size, so the sentence only has to say which
          // combination it is and what it beat.
          findingTemplate: (hi, lo) =>
            `${andList(labels)} together: ${outcome.label} averaged ${hi}, against ${lo} after any other day. ` +
            `That is a wider gap than ${combo.beats.label} opens on its own.`,
        })
        if (ins) insights.push(ins)
      }
    }

    // ── Body measurements ─────────────────────────────────────────
    //
    // Weight is not a day-level number. It moves a kilo on salt, water and
    // the hour of the weigh-in, and today's reading is mostly yesterday's
    // reading — which is precisely the autocorrelation a permutation test
    // assumes away. Comparing weight LEVELS between two groups of days would
    // produce confident nonsense: the groups would differ because weeks
    // differ, not because the behaviour does.
    //
    // The question that survives is the other way round. Between two
    // weigh-ins the number either rose or fell, and those stretches can be
    // compared on what was going on during them. Each span is then one
    // observation, spans never overlap, and the thing being compared is an
    // ordinary behaviour average rather than a number carrying its own
    // history.
    //
    // Body fat percentage is left out on purpose. Consumer scales measure
    // impedance and infer the rest, and the inference tracks hydration more
    // closely than fat, so a family built on it would mostly be reporting how
    // much water someone had drunk that morning.

    const bodySpans = (accessor: (d: DayData) => number | undefined, noiseFloor: number) => {
      const MIN_GAP = 3   // any shorter and the change is the scale talking
      const MAX_GAP = 21  // any longer and "what you were doing" stops meaning much
      const marks: { i: number; v: number }[] = []
      dense.forEach((d, i) => {
        const v = accessor(d)
        if (v != null && Number.isFinite(v)) marks.push({ i, v })
      })
      const spans: { from: number; to: number; change: number }[] = []
      let anchor = marks[0]
      if (!anchor) return spans
      for (const m of marks.slice(1)) {
        const gap = m.i - anchor.i
        // Walking anchor to anchor keeps the spans non-overlapping, so no day
        // is counted twice however often the scale gets stepped on.
        if (gap < MIN_GAP) continue
        if (gap <= MAX_GAP) spans.push({ from: anchor.i, to: m.i, change: m.v - anchor.v })
        anchor = m
      }
      // A span inside the noise floor didn't rise or fall; it was the same
      // number twice. Forcing it onto one side would fill both groups with
      // days that belong to neither.
      return spans.filter(sp => Math.abs(sp.change) >= noiseFloor)
    }

    // The mean of a behaviour over the days between two weigh-ins. Those are
    // the days that could have moved the number; the anchor day already gave
    // up its reading.
    const spanMean = (
      sp: { from: number; to: number },
      per: (d: DayData) => number | null,
    ): number | null => {
      const vals: number[] = []
      for (let i = sp.from + 1; i <= sp.to; i++) {
        const v = per(dense[i])
        if (v != null && Number.isFinite(v)) vals.push(v)
      }
      // Half the days have to carry the number, or a single logged lunch ends
      // up standing in for a fortnight of eating. Behaviours that read absence
      // as zero — you logged no drinks, so you drank nothing — always pass.
      if (vals.length * 2 < sp.to - sp.from) return null
      return avg(vals)
    }

    const BODY_MEASURES: {
      key: string; label: string; emoji: string
      accessor: (d: DayData) => number | undefined
      /** Below this the two readings are the same number twice. */
      noiseFloor: number
    }[] = [
      { key: "weight", label: "weight", emoji: "⚖️", accessor: d => d.weightKg, noiseFloor: 0.4 },
      { key: "waist", label: "waist", emoji: "📏", accessor: d => d.waistCm, noiseFloor: 1 },
    ]

    // Curated for the same reason the interactions above are: every extra pair
    // costs the whole run some of its false-discovery budget.
    const BODY_BEHAVIOURS: {
      key: string; label: string; unit: string
      per: (d: DayData) => number | null
      fmt?: (v: number) => string
    }[] = [
      { key: "calories", label: "Calories", unit: "kcal a day", per: d => d.calories ?? null },
      { key: "protein", label: "Protein", unit: "g of protein a day", per: d => d.proteinG ?? null },
      { key: "alcohol", label: "Alcohol", unit: "g of alcohol a day", per: d => d.alcoholG ?? 0 },
      { key: "workout", label: "Workouts", unit: "minutes of exercise a day", per: d => d.workoutMin ?? 0 },
      { key: "steps", label: "Steps", unit: "steps a day", per: d => d.steps ?? null },
      { key: "sleep", label: "Sleep", unit: "hours of sleep a night", per: d => d.sleepDuration ?? null,
        fmt: v => v.toFixed(1) },
    ]

    for (const measure of BODY_MEASURES) {
      const spans = bodySpans(measure.accessor, measure.noiseFloor)
      if (spans.length < 10) continue
      for (const beh of BODY_BEHAVIOURS) {
        // Spans are walked anchor to anchor, so this sequence is
        // chronological too; blocks here are runs of adjacent stretches.
        const seq = new Split()
        for (const sp of spans) {
          const v = spanMean(sp, beh.per)
          if (v == null) continue
          seq.add(sp.change > 0, v)
        }
        const fmt = beh.fmt ?? ((v: number) => String(Math.round(v)))
        // "Rose" is the high group so the percentage reads as "this much more
        // of it on the stretches the number climbed" — a statement about the
        // association and not about whether climbing is good. This app takes
        // no view on that: healthyWeightRange has an under end as well as an
        // over one, and the finding text below says which way round it is.
        const ins = compareGroups({
          id: `body_${measure.key}_${beh.key}`,
          category: "body",
          emoji: measure.emoji,
          title: `${beh.label} & ${measure.label} change`,
          highGroupLabel: `stretches your ${measure.label} rose`,
          lowGroupLabel: "stretches it fell",
          series: seq,
          findingTemplate: (hi, lo) =>
            `Between weigh-ins where your ${measure.label} climbed you averaged ${fmt(hi)} ${beh.unit}; between the ones where it dropped, ${fmt(lo)}`,
        })
        if (ins) insights.push(ins)
      }
    }
  }

  // Re-tier once the lag families are folded in, so FDR is fair across all.
  assignTiers(insights)

  // Weekend guard: alcohol, late meals, spending, music and screen time all
  // cluster on weekends — and so does sleeping in. An effect that collapses or
  // flips once weekends are excluded is probably the weekend, not the habit.
  permutationsOn = false
  let weekdayVersions: Map<string, InsightResult>
  try {
    weekdayVersions = new Map(
      deriveInsights(allDays.filter(d => !isWeekendDate(d.date))).map(i => [i.id, i]),
    )
  } finally {
    permutationsOn = true
  }
  for (const ins of insights) {
    const wk = weekdayVersions.get(ins.id)
    // A handful of weekdays a side cannot call a collapse: with five values
    // per group, a 35% shrink is what shuffling the same numbers produces.
    // The flag claims "the weekend explains this", so it needs a footing of
    // its own — eight per group keeps it reachable on a 30-day window.
    if (!wk || wk.highGroupN < 8 || wk.lowGroupN < 8) continue
    if (Math.sign(wk.delta) !== Math.sign(ins.delta) || Math.abs(wk.delta) < Math.abs(ins.delta) * 0.35) {
      ins.weekendDriven = true
      // The weekday-only number was always computed and thrown away; keeping
      // it lets the card show how much of the effect the weekend was.
      ins.weekdayDelta = wk.delta
    }
  }

  insights.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  return { insights, totalDays }
}
