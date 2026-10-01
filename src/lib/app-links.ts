// The places in the app Emergy can send someone, as tappable buttons.
//
// One list for both ends: the system prompt tells him which paths exist, and
// his own proactive messages carry the page their notification opens. Kept
// apart, the prompt listed /dashboard/medications and /dashboard/labs — both
// routes the proxy bounces into a tab — and the nudges in the chat carried no
// button at all, so "the rest are on your insights page" was a sentence to
// go and act on by hand.

export interface AppLink {
  /** Where the button lands — never a route the proxy redirects. */
  path: string
  /** The button's words. */
  label: string
  /** What is there, for the prompt. */
  what: string
}

export const APP_LINKS: AppLink[] = [
  { path: "/dashboard", label: "Home", what: "today at a glance, last night's vitals" },
  { path: "/dashboard/insights", label: "Patterns", what: "what generally affects what, and what is off their usual" },
  { path: "/dashboard/experiments", label: "Experiments", what: "on/off tests of one change" },
  { path: "/dashboard/health", label: "Health", what: "sleep and vitals history" },
  { path: "/dashboard/health?tab=labs", label: "Labs", what: "blood work and how each marker moved" },
  { path: "/dashboard/health?tab=weight", label: "Weight", what: "weight and body measurements" },
  { path: "/dashboard/intake", label: "Log", what: "today's drinks and food" },
  { path: "/dashboard/intake?tab=food", label: "Food", what: "meals and calories" },
  { path: "/dashboard/intake?tab=meds", label: "Medications", what: "schedules, today's doses, tick one off" },
  { path: "/dashboard/intake?tab=body", label: "In my body", what: "caffeine, alcohol and medicines still circulating" },
  { path: "/dashboard/symptoms", label: "Symptoms", what: "symptom log" },
  { path: "/dashboard/checkin", label: "Check-in", what: "morning and evening check-in" },
  { path: "/dashboard/journal", label: "Journal", what: "journal entries" },
  { path: "/dashboard/habits", label: "Habits", what: "habits and streaks" },
  { path: "/dashboard/reminders", label: "Reminders", what: "to-dos and reminders" },
  { path: "/dashboard/calendar", label: "Calendar", what: "events" },
  { path: "/dashboard/fasting", label: "Fasting", what: "the current fast and past fasts" },
  { path: "/dashboard/timeline", label: "Timeline", what: "where the day went, place by place" },
  { path: "/dashboard/brief", label: "Brief", what: "the morning brief" },
  { path: "/dashboard/week", label: "This week", what: "the weekly review" },
  { path: "/dashboard/stats", label: "Long view", what: "quarter vs quarter, monthly averages" },
  { path: "/dashboard/report", label: "Health report", what: "the printable report for a doctor" },
  { path: "/dashboard/settings", label: "Settings", what: "connections, notifications, goals" },
]

// Old routes the proxy folds into a tab, so a caller holding one still gets
// the button for the page it ends up on.
const ALIASES: Record<string, string> = {
  "/dashboard/medications": "/dashboard/intake?tab=meds",
  "/dashboard/caffeine": "/dashboard/intake?tab=body",
  "/dashboard/labs": "/dashboard/health?tab=labs",
  "/dashboard/weight": "/dashboard/health?tab=weight",
}

export function linkFor(href: string | null | undefined): AppLink | null {
  if (!href) return null
  const path = ALIASES[href] ?? href
  return APP_LINKS.find(l => l.path === path) ?? null
}

/**
 * The text with its page's button on the end. Nothing for the chat itself —
 * the message is already there — or for a path that is not a known page.
 */
export function withLink(text: string, href: string | null | undefined): string {
  const link = linkFor(href)
  return link ? `${text} [${link.label}](${link.path})` : text
}

/** The whitelist as the system prompt states it. */
export function linkPromptList(): string {
  return APP_LINKS.map(l => `${l.path} (${l.label}: ${l.what})`).join(", ")
}
