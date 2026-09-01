// The single manifest of the app's destinations. The sidebar and the ⌘K
// command palette both render from this list — they used to keep separate
// copies that drifted until neither matched the app (the palette knew pages
// the sidebar didn't, under different names, in different groups).
//
// Lives outside both components because they import each other's UI helpers;
// a shared constants module keeps the dependency graph acyclic.

export type NavSection = "Today" | "Body" | "Life" | "Patterns"
export type NavItem = { href: string; label: string; emoji: string; section: NavSection }

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard",             label: "Overview",        emoji: "🏠", section: "Today" },
  { href: "/dashboard/brief",       label: "Brief",           emoji: "🗞️", section: "Today" },
  { href: "/dashboard/chat",        label: "Emergy",          emoji: "🌱", section: "Today" },
  { href: "/dashboard/checkin",     label: "Check-in",        emoji: "🌅", section: "Today" },
  { href: "/dashboard/habits",      label: "Habits",          emoji: "✅", section: "Today" },
  { href: "/dashboard/garden",      label: "Garden",          emoji: "🌻", section: "Today" },

  // One entry per destination. Medications, Caffeine ("In my body"), Weight,
  // Body composition and Blood work are TABS — their routes redirect into
  // /intake or /health — and listing them here meant five nav rows that led
  // nowhere new, each landing under a different name than the one clicked.
  { href: "/dashboard/intake",      label: "Intake & Meds",   emoji: "🥤", section: "Body" },
  { href: "/dashboard/health",      label: "Health & Body",   emoji: "❤️", section: "Body" },
  { href: "/dashboard/symptoms",    label: "Symptoms",        emoji: "🩹", section: "Body" },
  { href: "/dashboard/report",      label: "Health report",   emoji: "📄", section: "Body" },
  { href: "/dashboard/fasting",     label: "Fasting",         emoji: "⏳", section: "Body" },
  { href: "/dashboard/strava",      label: "Strava",          emoji: "🏃", section: "Body" },

  { href: "/dashboard/calendar",    label: "Calendar",        emoji: "🗓️", section: "Life" },
  { href: "/dashboard/reminders",   label: "Reminders",       emoji: "🔔", section: "Life" },
  { href: "/dashboard/focus",       label: "Focus",           emoji: "🎯", section: "Life" },
  { href: "/dashboard/toggl",       label: "Toggl",           emoji: "⏱️", section: "Life" },
  { href: "/dashboard/journal",     label: "Journal",         emoji: "📝", section: "Life" },
  { href: "/dashboard/location",    label: "Location",        emoji: "📍", section: "Life" },
  { href: "/dashboard/reading",     label: "Reading",         emoji: "📚", section: "Life" },
  { href: "/dashboard/finances",    label: "Finances",        emoji: "💰", section: "Life" },
  { href: "/dashboard/bills",       label: "Bills",           emoji: "🧾", section: "Life" },
  { href: "/dashboard/subscriptions", label: "Subscriptions", emoji: "🔄", section: "Life" },
  { href: "/dashboard/gmail",       label: "Gmail",           emoji: "📬", section: "Life" },
  { href: "/dashboard/home",        label: "Home",            emoji: "🏡", section: "Life" },

  // The correlation engine's own page had no nav entry at all — it was
  // reachable only through a small link on a dashboard card.
  // Place patterns is gone as a page: its per-place correlations live on
  // Insights, its trips and home/away history on Location.
  { href: "/dashboard/insights",    label: "Insights",        emoji: "🔍", section: "Patterns" },
  { href: "/dashboard/experiments",  label: "Experiments",     emoji: "🔬", section: "Patterns" },
  { href: "/dashboard/custom",      label: "Custom metrics",  emoji: "🧮", section: "Patterns" },
  { href: "/dashboard/week",        label: "This Week",       emoji: "📅", section: "Patterns" },
  { href: "/dashboard/timeline",    label: "Timeline",        emoji: "🕐", section: "Patterns" },
  { href: "/dashboard/stats",       label: "Trends",          emoji: "💡", section: "Patterns" },
  { href: "/dashboard/streaks",     label: "Streaks",         emoji: "🔥", section: "Patterns" },
  { href: "/dashboard/lastfm",      label: "Last.fm",         emoji: "🎵", section: "Patterns" },
  { href: "/dashboard/rescuetime",  label: "RescueTime",      emoji: "⏱️", section: "Patterns" },

  { href: "/dashboard/settings",    label: "Settings",        emoji: "⚙️", section: "Life" },
]

// Destinations that live as tabs inside a page. They earn no sidebar row —
// that's five rows the sidebar just lost — but search should still land a
// query like "weight" or "meds" directly on the right tab.
export const TAB_ITEMS: NavItem[] = [
  { href: "/dashboard/intake?tab=meds",   label: "Medications",      emoji: "💊", section: "Body" },
  { href: "/dashboard/intake?tab=body",   label: "In my body",       emoji: "☕", section: "Body" },
  { href: "/dashboard/intake?tab=food",   label: "Food",             emoji: "🍽️", section: "Body" },
  { href: "/dashboard/health?tab=weight", label: "Weight",           emoji: "⚖️", section: "Body" },
  { href: "/dashboard/health?tab=body",   label: "Body composition", emoji: "📐", section: "Body" },
  { href: "/dashboard/health?tab=labs",   label: "Blood work",       emoji: "🧪", section: "Body" },
]
