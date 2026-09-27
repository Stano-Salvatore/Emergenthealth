// The one parser for insights_cache:overall.
//
// The cache is written as an envelope — { at, v, payload: { insights, … } } —
// by the insights page and the watch cron alike. Two readers in claude.ts
// disagreed about that: the chat context read payload.insights and saw ten
// patterns; the get_analysis tool read parsed.insights, saw undefined, and
// told the user "the cached pattern run is empty" in the same conversation.
// Every reader goes through here now, so the shape can only be wrong once.

export interface CachedInsight {
  id?: string
  title?: string
  finding?: string
  tier?: string
  delta?: number
  weekendDriven?: boolean
  highGroupN?: number
  lowGroupN?: number
  coverage?: string
  confounded?: string
  confident?: boolean
  [key: string]: unknown
}

/**
 * One card as a line for a model to read, with the caveats the Insights page
 * shows under it. A card flagged as weekend-driven, confounded or thinly
 * covered is still a card, and it still reaches the model — but handed over
 * as `finding` alone it arrived as a plain established fact, and the brief
 * repeated it as one while the page beneath said otherwise.
 */
export function insightForModel(i: CachedInsight): string {
  const text = i.finding ?? i.title ?? ""
  const caveats: string[] = []
  if (i.weekendDriven) caveats.push("mostly weekends — the effect fades or flips on weekdays alone")
  if (i.confounded) caveats.push(i.confounded)
  if (i.coverage) caveats.push(i.coverage)
  return caveats.length > 0 ? `${text} (caveat: ${caveats.join("; ")})` : text
}

export function parseInsightsCache(raw: string | null | undefined): { insights: CachedInsight[]; at: number | null } {
  if (!raw) return { insights: [], at: null }
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return { insights: parsed, at: null }
    const insights = Array.isArray(parsed?.payload?.insights) ? parsed.payload.insights
      : Array.isArray(parsed?.insights) ? parsed.insights
      : []
    const at = typeof parsed?.at === "number" ? parsed.at : null
    return { insights, at }
  } catch {
    return { insights: [], at: null }
  }
}

/** Younger than this, a cached run is served as it is. */
const FRESH_MS = 6 * 60 * 60 * 1000
/**
 * Older than fresh but younger than this, a run is served at once and a new
 * one computed after the response. The watch cron writes the overall run once
 * a day in the late afternoon UTC, so it is about fourteen hours old by the
 * next morning's first open — which a plain six-hour TTL always found
 * expired, and made wait on the full engine.
 */
const STALE_MS = 36 * 60 * 60 * 1000

export type InsightsCacheState = "fresh" | "stale" | "unusable"

/**
 * Whether a cache envelope may be shown. A run from another engine version is
 * never shown, however new: it would hide families that were just added, and
 * carry labels for cuts the engine no longer applies.
 */
export function insightsCacheState(
  envelope: { at?: unknown; v?: unknown } | null | undefined,
  now: number,
  engineVersion: number,
): InsightsCacheState {
  if (!envelope || envelope.v !== engineVersion || typeof envelope.at !== "number") return "unusable"
  const age = now - envelope.at
  if (age < FRESH_MS) return "fresh"
  return age < STALE_MS ? "stale" : "unusable"
}

const inFlight = new Map<string, Promise<unknown>>()

/**
 * Join a computation already running under `key` rather than start a second.
 * Per server instance only — enough for the case that mattered, the Insights
 * page and its Watched panel asking for the same period in the same second.
 */
export function shareInFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key)
  if (running) return running as Promise<T>
  const p = run().finally(() => inFlight.delete(key))
  inFlight.set(key, p)
  return p
}
