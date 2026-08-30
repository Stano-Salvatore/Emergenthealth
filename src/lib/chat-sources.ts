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
 * claim — the stream saw the call. Tools that write (log_*, create_*, remember,
 * forget)
 * are actions, not sources, and deliberately have no entry here.
 */
const TOOL_SOURCES: Record<string, { label: string; domain: SourceDomain }> = {
  get_health_range:    { label: "Health history", domain: "sleep" },
  find_my_logs:        { label: "Logs",           domain: "life"  },
  search_chat_history: { label: "Past chats",     domain: "life"  },
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
  search_chat_history: "looking back through our chats",
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
  forget:             "forgetting that",
}

export function toolActivity(name: string): string {
  return TOOL_ACTIVITY[name] ?? "having a look"
}

// ── Waiting on the first word ──────────────────────────────────────────────
// Before any token arrives there is nothing to say and nothing to show, and a
// lone blinking caret in an empty bubble reads as a stalled text field rather
// than someone thinking. Worse, it is identical every time and never changes,
// so a long wait looks exactly like a stuck one.
//
// Same voice as the tool lines above: lowercase, unhurried, a participle. Two
// of them lean on him being a plant, which he is, but only two — the joke wears
// out at the pace of a spinner.
const THINKING = [
  "thinking",
  "having a think",
  "turning that over",
  "gathering my thoughts",
  "checking what I know",
  "putting that together",
  "working through it",
  "finding the thread",
  "getting my roots around it",
  "letting that settle",
]

/**
 * The phrases for one wait, in an order that varies between messages.
 *
 * Seeded from the message so a re-render does not reshuffle mid-sentence, and
 * so two answers in a row do not open with the same word. Rotated rather than
 * randomly picked each tick: an order that never repeats within a wait reads as
 * progress, where random picks read as a machine flailing.
 */
export function thinkingPhrases(seed: string): string[] {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const start = Math.abs(h) % THINKING.length
  return [...THINKING.slice(start), ...THINKING.slice(0, start)]
}


// ── The sources marker ─────────────────────────────────────────────────────
// Emergy ends a data-backed answer with a line like `[sources: sleep, journal]`.
// It is plumbing, not prose, so it must never reach the screen — including for
// the split second between arriving and being recognised. The filter below runs
// server-side, over the token stream, and holds back only a partial line that
// could still turn out to be the marker. Ordinary text is never delayed.

const MARKER_PREFIX = "[sources:"

/** One complete marker, anywhere, with the whitespace hugging it. */
const MARKER_ANYWHERE = /\s*\[sources:([^\]]*)\]\s*/gi
/** A complete marker starting exactly at a "[", plus whatever follows it. */
const MARKER_HERE = /^\[sources:([^\]]*)\]([\s\S]*)$/i

function parseKeys(raw: string): string[] {
  return raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
}

/**
 * Take every complete marker out of a piece of text.
 *
 * Every one, not the first: "Hi [sources: sleep] and [sources: journal] bye"
 * used to lose the first and print the second, which is the same leak one
 * clause later. Prose either side of a removed marker is rejoined with a single
 * space, since the match eats the whitespace that was holding it apart.
 */
function stripMarkers(body: string): { text: string; keys?: string[] } {
  const re = new RegExp(MARKER_ANYWHERE.source, "gi")
  const parts: string[] = []
  let keys: string[] | undefined
  let last = 0
  for (let m: RegExpExecArray | null; (m = re.exec(body)); ) {
    keys = parseKeys(m[1])
    parts.push(body.slice(last, m.index))
    last = m.index + m[0].length
  }
  if (!keys) return { text: body }
  parts.push(body.slice(last))
  return { text: parts.filter(Boolean).join(" "), keys }
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

      // Complete lines can be judged immediately: every marker comes out and
      // whatever prose surrounded it is forwarded. A line that was nothing but
      // a marker leaves nothing — not even its newline.
      for (;;) {
        const nl = buf.indexOf("\n")
        if (nl === -1) break
        const { text: prose, keys: k } = stripMarkers(buf.slice(0, nl))
        if (k) keys = k
        if (prose) text += prose + "\n"
        else if (!k) text += "\n"
        buf = buf.slice(nl + 1)
      }

      // What is left is a partial line. Hold from the point a marker could
      // begin; everything before that goes out now.
      const start = markerStart(buf)
      if (start === -1) {
        text += buf
        pending = ""
        return keys ? { text, keys } : { text }
      }

      // A marker that is already complete AND has prose after it can be
      // resolved now. Holding it instead meant the rest of the sentence waited
      // for a newline that might be a paragraph away — the reply visibly
      // stalled mid-sentence and then arrived in one lump.
      const here = buf.slice(start).match(MARKER_HERE)
      if (here && here[2].trim() !== "") {
        const stripped = stripMarkers(buf)
        if (stripped.keys) keys = stripped.keys
        const next = markerStart(stripped.text)
        if (next === -1) {
          text += stripped.text
          pending = ""
        } else {
          text += stripped.text.slice(0, next)
          pending = stripped.text.slice(next)
        }
        return keys ? { text, keys } : { text }
      }

      // Still arriving, or nothing follows it yet. A marker at the end of a
      // line has to stay pending so that it keeps swallowing its own newline.
      text += buf.slice(0, start)
      pending = buf.slice(start)
      return keys ? { text, keys } : { text }
    },

    flush(): FilterOutput {
      const held = pending
      pending = ""
      const stripped = stripMarkers(held)
      if (stripped.keys) return { text: stripped.text, keys: stripped.keys }
      // Nothing complete was held. It always starts at a "[" that COULD have
      // become the marker, so this is a judgement call: drop it only when it is
      // unambiguously a truncated marker. A bare "[" or "[s" is far more likely
      // to be ordinary text he ended on, and swallowing real prose is worse
      // than showing one stray bracket on a stream that got cut off.
      if (/^\[sources/i.test(held)) return { text: "" }
      return { text: held }
    },
  }
}
