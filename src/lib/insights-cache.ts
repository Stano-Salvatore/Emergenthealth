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
