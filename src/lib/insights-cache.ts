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
