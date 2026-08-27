// What Emergy actually read, and how the chat screen is allowed to say so.
//
// The rule this file exists to enforce: the UI may only show a source Emergy
// genuinely had in front of him. Two things can put a chip on screen, and both
// are grounded server-side:
//
//   1. A tool he called this turn — observed from the stream, so it is a fact.
//   2. A section of the system prompt he *claims* to have leaned on, named in a
//      trailing `[sources: …]` marker. The claim is his; the count is ours, and
//      a section we never gave him is dropped rather than rendered.
//
// So a source he invents ("research", "places") cannot reach the screen: there
// is no manifest entry to back it, and it is discarded in `chipsFromClaim`.

/** Identity hue, per design/handoff/README.md. Never a status colour. */
export type SourceDomain = "sleep" | "heart" | "move" | "fuel" | "mind" | "life"

export type SourceKey =
  | "sleep" | "journal" | "checkin" | "tags" | "intake" | "habits"
  | "calendar" | "symptoms" | "labs" | "meds" | "workouts" | "patterns" | "memory"

export interface SourceChip {
  key: string
  label: string
  /** A real count from the prompt build ("30 nights"), or undefined for tools. */
  detail?: string
  domain: SourceDomain
}

// Labels stay short on purpose: at 390px one long one can't share a row with
// anything, and a four-source answer turns into four rows of chips.
const SOURCE_META: Record<SourceKey, { label: string; domain: SourceDomain }> = {
  sleep:    { label: "Sleep",       domain: "sleep" },
  journal:  { label: "Journal",     domain: "mind"  },
  checkin:  { label: "Check-ins",   domain: "mind"  },
  tags:     { label: "Oura tags",   domain: "fuel"  },
  intake:   { label: "Intake",      domain: "fuel"  },
  habits:   { label: "Habits",      domain: "life"  },
  calendar: { label: "Calendar",    domain: "life"  },
  symptoms: { label: "Symptoms",    domain: "heart" },
  labs:     { label: "Blood work",  domain: "heart" },
  meds:     { label: "Medications", domain: "fuel"  },
  workouts: { label: "Workouts",    domain: "move"  },
  patterns: { label: "Patterns",    domain: "mind"  },
  memory:   { label: "Memory",      domain: "life"  },
}

/** The vocabulary Emergy is told to pick from — kept in sync with SOURCE_META. */
export const SOURCE_KEYS = Object.keys(SOURCE_META) as SourceKey[]

/**
 * What a given turn's system prompt actually contained: key → the true count,
 * built alongside the prompt itself so the two cannot drift.
 */
export type SourceManifest = Partial<Record<SourceKey, string>>

/**
 * Turn Emergy's claimed sources into chips, dropping anything we did not give
 * him. Order follows SOURCE_META so two answers citing the same sources render
 * their chips in the same order.
 */
export function chipsFromClaim(claimed: string[], manifest: SourceManifest): SourceChip[] {
  const wanted = new Set(claimed.map(c => c.trim().toLowerCase()))
  return SOURCE_KEYS.filter(key => wanted.has(key) && manifest[key])
    .map(key => ({ key, label: SOURCE_META[key].label, detail: manifest[key], domain: SOURCE_META[key].domain }))
}

/**
 * Tools that READ. Calling one is proof he looked, so these chips need no
 * claim — the stream saw the call. Tools that write (log_*, create_*, remember)
 * are actions, not sources, and deliberately have no entry here.
 */
const TOOL_SOURCES: Record<string, { label: string; domain: SourceDomain }> = {
  get_health_range: { label: "Health history", domain: "sleep" },
  find_my_logs:     { label: "Logs",           domain: "life"  },
}

export function chipsFromTools(toolNames: string[]): SourceChip[] {
  const seen = new Set<string>()
  const chips: SourceChip[] = []
  for (const name of toolNames) {
    const meta = TOOL_SOURCES[name]
    if (!meta || seen.has(name)) continue
    seen.add(name)
    chips.push({ key: `tool:${name}`, label: meta.label, domain: meta.domain })
  }
  return chips
}

export function mergeChips(fromTools: SourceChip[], fromClaim: SourceChip[]): SourceChip[] {
  return [...fromTools, ...fromClaim]
}

/**
 * What to say while a tool is running. A blinking cursor tells the user nothing;
 * "reading your sleep" tells them why the wait is happening. Unknown tools fall
 * back to a neutral phrase rather than leaking a function name.
 */
const TOOL_ACTIVITY: Record<string, string> = {
  get_health_range:   "reading your health history",
  find_my_logs:       "looking through your logs",
  correct_log:        "fixing that entry",
  delete_log:         "checking what that would remove",
  create_habit:       "setting up that habit",
  complete_habit_today: "ticking that habit off",
  create_reminder:    "writing that reminder down",
  complete_reminder:  "closing that reminder",
  log_water:          "logging your water",
  log_coffee:         "logging your coffee",
  log_drink:          "logging that drink",
  log_food:           "logging that food",
  log_usual:          "logging your usual",
  log_mood:           "logging your mood",
  log_weight:         "logging your weight",
  log_dose:           "logging that dose",
  log_symptom:        "noting that symptom",
  log_focus:          "logging your focus session",
  log_custom_metric:  "logging that",
  log_moment:         "adding that to your timeline",
  log_morning_checkin: "saving your check-in",
  write_daily_note:   "writing that in your journal",
  remember:           "remembering that",
}

export function toolActivity(name: string): string {
  return TOOL_ACTIVITY[name] ?? "having a look"
}

// ── The sources marker ─────────────────────────────────────────────────────
// Emergy ends a data-backed answer with a line like `[sources: sleep, journal]`.
// It is plumbing, not prose, so it must never reach the screen — including for
// the split second between arriving and being recognised. The filter below runs
// server-side, over the token stream, and holds back only a partial line that
// could still turn out to be the marker. Ordinary text is never delayed.

const MARKER_PREFIX = "[sources:"
const MARKER_LINE = /^\s*\[sources:([^\]]*)\]\s*$/i
const MARKER_HEAD = /^\s*\[sources:([^\]]*)\]/i

function parseKeys(raw: string): string[] {
  return raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
}

/** Could this partial line still become the marker if more text arrived? */
function couldBeMarker(partial: string): boolean {
  const t = partial.trimStart().toLowerCase()
  return t.length === 0 || MARKER_PREFIX.startsWith(t) || t.startsWith(MARKER_PREFIX)
}

export interface FilterOutput {
  /** Text safe to forward to the client now. */
  text: string
  /** Present once the marker has been read. */
  keys?: string[]
}

export interface SourceFilter {
  push(chunk: string): FilterOutput
  /** Call once the stream ends, to resolve whatever is still held back. */
  flush(): FilterOutput
}

export function createSourceFilter(): SourceFilter {
  let pending = ""

  return {
    push(chunk: string): FilterOutput {
      let buf = pending + chunk
      let text = ""
      let keys: string[] | undefined

      // Complete lines can be judged immediately: a whole-line marker is
      // swallowed, anything else is forwarded.
      for (;;) {
        const nl = buf.indexOf("\n")
        if (nl === -1) break
        const line = buf.slice(0, nl + 1)
        const m = line.match(MARKER_LINE)
        if (m) keys = parseKeys(m[1])
        else text += line
        buf = buf.slice(nl + 1)
      }

      // Whatever is left is a partial line. Hold it only while it could still
      // be the marker; otherwise it goes out with everything else.
      if (couldBeMarker(buf)) {
        pending = buf
      } else {
        text += buf
        pending = ""
      }
      return keys ? { text, keys } : { text }
    },

    flush(): FilterOutput {
      const held = pending
      pending = ""
      const m = held.match(MARKER_HEAD)
      if (m) {
        // Anything the model wrote after a closing bracket is still prose.
        const rest = held.slice(m[0].length)
        return { text: rest, keys: parseKeys(m[1]) }
      }
      // A stream cut off mid-marker leaves a fragment that is plumbing too —
      // showing "[sources: sle" would be worse than showing nothing.
      if (couldBeMarker(held) && held.trim().length > 0) return { text: "" }
      return { text: held }
    },
  }
}
