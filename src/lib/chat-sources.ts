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
/**
 * The marker anywhere in a line, not only at its end.
 *
 * Anchoring to the end covered "…go gently today. [sources: sleep]" but not
 * "…go gently today. [sources: sleep] Want me to look?" — which is the same
 * missing newline, one clause later, and went out verbatim.
 */
const MARKER_ANYWHERE = /\s*\[sources:([^\]]*)\]\s*/i
/** The marker at the very start, so prose written after it is still prose. */
const MARKER_HEAD = /^\s*\[sources:([^\]]*)\]/i

function parseKeys(raw: string): string[] {
  return raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
}

/**
 * Where a marker could begin in this partial line, or -1.
 *
 * He is asked to put it on a line of its own and usually does, but "…go gently
 * today. [sources: sleep]" is one missing newline away and used to sail
 * straight through to the screen — and into the stored transcript, where it
 * stayed. Anything from a candidate "[" onwards is held; everything before it
 * goes out immediately, so ordinary prose is never delayed.
 */
function markerStart(partial: string): number {
  // Left to right, so the EARLIEST candidate wins. Scanning from the end
  // released a marker already being held the moment any later bracket showed
  // up — "[sources: sleep]" then " See [" put the whole marker on screen.
  for (let i = 0; i < partial.length; i++) {
    if (partial[i] !== "[") continue
    const rest = partial.slice(i).toLowerCase()
    if (MARKER_PREFIX.startsWith(rest) || rest.startsWith(MARKER_PREFIX)) return i
  }
  return -1
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

      // Complete lines can be judged immediately: the marker is taken off the
      // end, and whatever prose came before it is forwarded. A line that was
      // nothing but the marker leaves nothing — not even its newline.
      for (;;) {
        const nl = buf.indexOf("\n")
        if (nl === -1) break
        const body = buf.slice(0, nl)
        const m = body.match(MARKER_ANYWHERE)
        if (m) {
          keys = parseKeys(m[1])
          // Keep whatever he wrote on either side of it. The match eats the
          // whitespace around the marker, so prose on both sides gets its one
          // space back rather than being run together.
          const before = body.slice(0, m.index)
          const after = body.slice((m.index ?? 0) + m[0].length)
          const prose = before && after ? `${before} ${after}` : before + after
          if (prose) text += prose + "\n"
        } else {
          text += body + "\n"
        }
        buf = buf.slice(nl + 1)
      }

      // Whatever is left is a partial line. Hold from the point a marker could
      // begin; everything before that goes out now.
      const start = markerStart(buf)
      if (start === -1) {
        text += buf
        pending = ""
      } else {
        text += buf.slice(0, start)
        pending = buf.slice(start)
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
      // Anything still held started at a "[" that could only have become the
      // marker, so a stream cut off mid-way leaves a fragment that is plumbing
      // too — showing "[sources: sle" would be worse than showing nothing.
      if (held.trim().length > 0) return { text: "" }
      return { text: held }
    },
  }
}
