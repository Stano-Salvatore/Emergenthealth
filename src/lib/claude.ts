/* eslint-disable @typescript-eslint/no-explicit-any */
import Anthropic from "@anthropic-ai/sdk"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { isRefKind, issueConfirmToken, makeRef, parseRef, verifyConfirmToken, type RefKind } from "@/lib/log-refs"
import { getEventsInRange } from "@/lib/google-calendar"
import { classifyOuraTag } from "@/lib/oura-tag-classify"
import { estimateCaffeine, activeFromDoses, HALF_LIFE_H } from "@/lib/caffeine"
import { getPersonalCaffeineProfile } from "@/lib/caffeine-profile"
import { normalizeSupplement, cleanLabel } from "@/lib/supplement-normalize"
import { hydrationMl, HYDRATION_FACTOR } from "@/lib/hydration"
import {
  chipsFromClaim, chipsFromTools, createSourceFilter, mergeChips, SOURCE_KEYS,
  type SourceChip, type SourceManifest,
} from "@/lib/chat-sources"
import { addDaysISO, localDateStr, localTimeStr, zonedDateTime, zonedDayRange } from "@/lib/local-date"
import { getUserTimezone, userDay } from "@/lib/user-timezone"
import { randomUUID } from "crypto"
import { rankRecallHits, recallTerms, RECALL_MAX_HITS, trimForRecall } from "@/lib/chat-recall"
import { addFact, forgetFact, MEMORY_KEY, parseFacts, renderFacts, serialiseFacts } from "@/lib/emergy-memory"
import { detectStops } from "@/lib/day-stops"
import { loadKnownModes } from "@/lib/journey-known"
import { applyKnownModes, buildJourney } from "@/lib/day-journeys"
import { matchSavedPlace, placeNameKey } from "@/lib/places"
import { DAILY_MAX_DAYS, renderWeek, rollupWeeks, type DailyMetrics } from "@/lib/health-rollup"
import { parseDose, formatDose } from "@/lib/dose"

/** Fold whatever the model called it onto a type the app stores. */
function normalizeDrinkType(raw: string): string {
  const t = raw.trim().toLowerCase()
  if (t in HYDRATION_FACTOR) return t
  if (/mate|yerba|guayusa/.test(t)) return "mate"
  if (/coffee|espresso|latte|americano/.test(t)) return "coffee"
  if (/tea/.test(t)) return "tea"
  if (/beer|lager|ale/.test(t)) return "beer"
  if (/wine/.test(t)) return "wine"
  if (/vodka|whisk|gin|rum|spirit/.test(t)) return "spirits"
  return "other"
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

/**
 * When something was actually had, from "1h ago".
 *
 * The intake tools took no time at all, so "add 100ml beer 1h ago" was logged
 * as now and Emergy had to explain the tool's own limitation back to the user
 * and offer to correct it. log_dose already accepted minutesAgo; the drinks
 * and meals simply never got it.
 *
 * Bounded at 48 hours for the same reason log_dose is: past that it is not a
 * correction to just-now, it is a memory, and a mistyped "600" should not file
 * a beer into last week's sleep analysis.
 */
function loggedAtFrom(input: Record<string, unknown>): { at: Date; minutesAgo: number } {
  const minutesAgo = clampInt(input.minutesAgo, 0, 48 * 60, 0)
  return { at: new Date(Date.now() - minutesAgo * 60_000), minutesAgo }
}

/** " , 60 min ago" / " , 2h 5m ago" — said back, so a misread time is visible. */
function agoSuffix(minutesAgo: number): string {
  if (minutesAgo <= 0) return ""
  if (minutesAgo < 60) return `, ${minutesAgo} min ago`
  const h = Math.floor(minutesAgo / 60)
  const m = minutesAgo % 60
  return `, ${h}h${m ? ` ${m}m` : ""} ago`
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const CACHE: Anthropic.CacheControlEphemeral = { type: "ephemeral" }

// Mark last tool as cacheable so the static tool definitions are cached together
const TOOLS: Anthropic.Tool[] = [
  {
    name: "create_habit",
    description: "Create a new daily habit for the user to track",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Name of the habit" },
        color: { type: "string", description: "Hex color e.g. #6366f1 (optional)" },
      },
      required: ["name"],
    },
  },
  {
    name: "complete_habit_today",
    description: "Mark a habit as completed for today",
    input_schema: {
      type: "object" as const,
      properties: {
        habitName: { type: "string", description: "Name of the habit to complete" },
      },
      required: ["habitName"],
    },
  },
  {
    name: "create_reminder",
    description: "Create a reminder for the user",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        dueDate: { type: "string", description: "Date in YYYY-MM-DD format (optional)" },
        priority: { type: "string", enum: ["low", "normal", "high"] },
      },
      required: ["title"],
    },
  },
  {
    name: "log_water",
    description: "Log water intake for the user (adds to today's total)",
    input_schema: {
      type: "object" as const,
      properties: {
        amountMl: { type: "number", description: "Amount in millilitres (e.g. 250, 500, 1000)" },
        minutesAgo: { type: "number", description: "How long ago they had it; 0 or omitted means just now" },
      },
      required: ["amountMl"],
    },
  },
  {
    name: "log_coffee",
    description: "Log coffee intake for the user (adds to today's coffee total)",
    input_schema: {
      type: "object" as const,
      properties: {
        amountMl: { type: "number", description: "Amount in ml (e.g. 30 espresso, 200 americano, 300 latte)" },
        minutesAgo: { type: "number", description: "How long ago they had it; 0 or omitted means just now" },
      },
      required: ["amountMl"],
    },
  },
  {
    // Named drinks — including branded ones the app has never heard of.
    // There's no product database and there doesn't need to be: the model
    // already knows roughly what's in a yerba mate or a can of Club-Mate, and
    // supplying that estimate here is more useful than a lookup table that
    // covers eight drinks and nothing local. Values are sanity-checked server
    // side, and the estimate is stated back so an implausible one is visible
    // rather than silently stored.
    name: "log_drink",
    description:
      "Log any drink by name, including branded or regional products (e.g. 'Maté by Mana Roots', 'Club-Mate', 'Kofola'). Use this instead of log_water/log_coffee whenever the user names a specific drink. Estimate the caffeine yourself from what you know of the product — do not ask the user for milligrams.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "What the user called it, e.g. 'Maté by Mana Roots'" },
        drinkType: {
          type: "string",
          description: "One of: water, sparkling, coffee, tea, matcha, mate, juice, soda, milk, beer, wine, spirits, alcohol, other",
        },
        amountMl: { type: "number", description: "Volume in millilitres. Estimate a typical serving if the user didn't say." },
        caffeineMg: {
          type: "number",
          description: "Estimated caffeine for this serving, 0 if none. Yerba mate is roughly 0.15 mg/ml (~80mg per 500ml) — well under coffee's 0.4.",
        },
        minutesAgo: { type: "number", description: "How long ago they had it; 0 or omitted means just now" },
      },
      required: ["name", "drinkType", "amountMl"],
    },
  },
  {
    name: "log_food",
    description:
      "Log something the user says they ate, by name. Estimate the calories and macros yourself from what you know of the dish — do not ask the user for numbers.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Short dish name, e.g. 'Chicken caesar salad'" },
        mealType: { type: "string", description: "breakfast | lunch | dinner | snack | other" },
        calories: { type: "number", description: "Estimated kcal for the portion described" },
        proteinG: { type: "number" },
        carbsG: { type: "number" },
        fatG: { type: "number" },
        minutesAgo: { type: "number", description: "How long ago they ate it; 0 or omitted means just now" },
      },
      required: ["name", "calories"],
    },
  },
  {
    name: "log_usual",
    description: "Log the user's usual order at one of their saved places — e.g. 'log my usual' or 'log my usual at Vták' logs the drink they've stored for that café, feeding the intake and caffeine trackers. Without a place name it uses the place they most recently checked in at that has a usual set.",
    input_schema: {
      type: "object" as const,
      properties: {
        placeName: { type: "string", description: "Saved place name or a part of it (optional)" },
        minutesAgo: { type: "number", description: "How long ago they had it; 0 or omitted means just now" },
      },
      required: [],
    },
  },
  {
    name: "log_mood",
    description: "Log the user's mood for today (1=awful, 2=bad, 3=ok, 4=good, 5=great)",
    input_schema: {
      type: "object" as const,
      properties: {
        mood: { type: "number", description: "Mood score 1-5" },
      },
      required: ["mood"],
    },
  },
  {
    name: "log_weight",
    description: "Log the user's body weight in kg for today",
    input_schema: {
      type: "object" as const,
      properties: {
        weightKg: { type: "number", description: "Weight in kilograms" },
      },
      required: ["weightKg"],
    },
  },
  {
    name: "write_daily_note",
    description: "Write or update the user's journal note for today",
    input_schema: {
      type: "object" as const,
      properties: {
        content: { type: "string", description: "The note content to save" },
      },
      required: ["content"],
    },
  },
  {
    name: "log_morning_checkin",
    description: "Log the user's morning check-in: energy level, mood, optional intention/focus, and water goal",
    input_schema: {
      type: "object" as const,
      properties: {
        energy: { type: "number", description: "Energy level 1-5 (1=exhausted, 3=ok, 5=amazing)" },
        mood: { type: "number", description: "Mood 1-5 (1=awful, 3=neutral, 5=great)" },
        intention: { type: "string", description: "Today's focus or intention (optional)" },
        waterGoalMl: { type: "number", description: "Water goal in ml (default 2000)" },
      },
      required: ["energy", "mood"],
    },
  },
  {
    name: "get_health_range",
    description: "Read the user's daily history: health metrics (sleep, resting HR, HRV, readiness, steps), Oura Ring tags (coffee, supplements, meds, alcohol — the user logs these in the Oura app), morning check-ins (energy/mood/intention), mood logs, journal notes, and logged water/coffee. Use this to answer questions about trends and causes — e.g. 'does coffee affect my sleep', 'how did I feel that week'. Reason over the returned data instead of guessing. Either pass `days` to look back from today, or `from`/`to` for a specific stretch — imported history goes back years, so a question about last autumn is answerable. Ranges longer than about four months come back as weekly averages instead of daily rows; narrow the window when you need a particular day.",
    input_schema: {
      type: "object" as const,
      properties: {
        days: { type: "number", description: "How many days back from today (1-365). Ignored if from/to are given." },
        from: { type: "string", description: "Start of a specific window, YYYY-MM-DD in the user's local time" },
        to: { type: "string", description: "End of that window, YYYY-MM-DD. Defaults to today." },
      },
      required: [],
    },
  },
  {
    name: "get_day_journey",
    description: "Retrace where the user actually spent a day: the places they stayed, how long at each, and how they travelled between them. The daily summaries you already have say only how far they moved and when tracking started and stopped — this says where. Use it when the day itself is the question ('what did I do on Saturday', 'was I out much last week'), and when somewhere they were might explain how they felt. Travel modes are inferred and some are guesses; they are marked, and a guess should not be stated as fact.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: { type: "string", description: "YYYY-MM-DD in the user's local time. Defaults to today." },
      },
      required: [],
    },
  },
  {
    name: "search_chat_history",
    description: "Search what the user and you have said to each other in PAST conversations. Emergy's own memory of talking to them. Use it whenever the user refers back to something you discussed before — 'do you remember when I told you about…', 'what did we say that day', 'you suggested something for my headaches' — and before ever saying you do not recall a conversation. Pass `query` with the distinctive words to look for (a name, a place, a symptom), and/or `date` to read a particular day back. Matching is on whole words, so a name the user spells differently now than they did then (Sofia/Sophia) will not match on its own — if nothing comes back, try again with other words from the same memory, or with a date, before telling them you cannot find it. Searching the current conversation is unnecessary; it is already in front of you.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Distinctive words to look for, e.g. 'church tower Sofia'. Common words are ignored. Omit to read a whole day." },
        date: { type: "string", description: "YYYY-MM-DD in the user's local time, to read one day back. Omit to search all time." },
        days: { type: "number", description: "Only look at the last N days. Omit for all time." },
      },
      required: [],
    },
  },
  {
    name: "remember",
    description: "Save a durable fact about the user (a goal, preference, or context) so you recall it in future conversations. Use when the user shares something worth remembering long-term, e.g. 'I'm training for a marathon' or 'I hate mornings'.",
    input_schema: {
      type: "object" as const,
      properties: {
        fact: { type: "string", description: "The fact to remember, in a short sentence" },
      },
      required: ["fact"],
    },
  },
  {
    name: "forget",
    description: "Remove something you remember about the user that is no longer true, or that they ask you to forget. Use it whenever a saved fact is contradicted — they stopped training, changed jobs, no longer avoids dairy — because a stale fact is not merely unhelpful, it keeps steering what you say. Pass enough of the fact to identify it. If several could match you are told which, and nothing is removed until you say which one.",
    input_schema: {
      type: "object" as const,
      properties: {
        fact: { type: "string", description: "The fact to forget, or enough of it to identify which one" },
      },
      required: ["fact"],
    },
  },
  {
    name: "complete_reminder",
    description: "Mark one of the user's open reminders/to-dos as done. Matches by title, case-insensitively.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "The reminder's title, or enough of it to identify it" },
      },
      required: ["title"],
    },
  },
  {
    name: "log_focus",
    description: "Record a completed deep-work/focus session, e.g. 'just did 50 minutes of writing'. Logs it as ending now.",
    input_schema: {
      type: "object" as const,
      properties: {
        durationMin: { type: "number", description: "Session length in minutes" },
        label: { type: "string", description: "Optional: what they worked on" },
      },
      required: ["durationMin"],
    },
  },
  {
    name: "log_custom_metric",
    description: "Log today's value for one of the user's custom trackers (the metrics they created themselves, e.g. 'stress', 'meditation', 'back pain'). Matches the tracker by name. For yes/no trackers use 1 (did) or 0 (didn't).",
    input_schema: {
      type: "object" as const,
      properties: {
        metricName: { type: "string", description: "The tracker's name, or enough of it to identify it" },
        value: { type: "number", description: "Today's value (1/0 for yes-no trackers)" },
        note: { type: "string", description: "Optional short note" },
      },
      required: ["metricName", "value"],
    },
  },
  {
    name: "log_symptom",
    description: "Record a symptom the user mentions — headache, sore throat, back pain — with a 1-5 severity (1=barely there, 5=severe). Infer a reasonable severity from how they describe it if they don't give a number.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Symptom name, e.g. 'Headache'" },
        severity: { type: "number", description: "1-5" },
        note: { type: "string", description: "Optional context, e.g. 'started after lunch'" },
      },
      required: ["name", "severity"],
    },
  },
  {
    name: "log_dose",
    description: "Record that the user took a medication or supplement — 'took my Atarax', 'half an Elicea', '400mg magnesium'. Pass the substance name on its own and the amount separately when they state one. Use this for pills, capsules and drops; use log_drink for drinks.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "The substance alone, e.g. 'Atarax' — no dose in this field" },
        doseAmount: { type: "number", description: "How much, when stated: 12.5 for 12.5mg, or 0.5 for half a tablet" },
        doseUnit: { type: "string", description: "'mg' for an absolute amount, 'tablet' for a share of a tablet" },
        minutesAgo: { type: "number", description: "How long ago they took it; 0 or omitted means just now" },
      },
      required: ["name"],
    },
  },
  {
    name: "log_moment",
    description: "Save a small life moment to the user's timeline — 'first swim of the year', 'dinner with mom'. Use when the user shares something worth marking that isn't a metric. Set occurredAt when it happened earlier than now — late-night messages about the evening just gone belong to that evening, not to the small hours of the next day.",
    input_schema: {
      type: "object" as const,
      properties: {
        label: { type: "string", description: "Short label for the moment" },
        emoji: { type: "string", description: "One fitting emoji (default 📌)" },
        note: { type: "string", description: "Optional detail" },
        occurredAt: {
          type: "string",
          description: "When it happened, in the user's local time: YYYY-MM-DD or YYYY-MM-DDTHH:MM. Omit only if it is happening right now.",
        },
      },
      required: ["label"],
    },
  },
  {
    name: "find_my_logs",
    description: "Look up the user's own recent entries so they can be corrected or removed. Returns each one with a `ref` — pass that ref verbatim to correct_log or delete_log. Use this first; never guess a ref.",
    input_schema: {
      type: "object" as const,
      properties: {
        kind: { type: "string", enum: ["dose", "intake", "moment"], description: "dose = medication/supplement, intake = water/coffee/drinks, moment = timeline entry" },
        date: { type: "string", description: "YYYY-MM-DD in the user's local time. Omit for the last few days." },
        name: { type: "string", description: "Filter by name, e.g. 'Atarax'. Omit for everything of that kind." },
      },
      required: ["kind"],
    },
  },
  {
    name: "delete_log",
    description: "Remove an entry the user asked to remove. TWO STEPS, always. Call it first with only the ref: nothing is deleted, and you get back a description of the entry plus a confirmation token. Show the user exactly what you are about to delete and wait for them to say yes. Only then call again with the same ref AND that token. You cannot delete in one step and must never claim something is deleted until the second call has returned.",
    input_schema: {
      type: "object" as const,
      properties: {
        ref: { type: "string", description: "The ref from find_my_logs" },
        confirm: { type: "string", description: "The token from the first call. Omit on the first call. Never invent one." },
      },
      required: ["ref"],
    },
  },
  {
    name: "correct_log",
    description: "Fix a detail of an existing entry rather than deleting it — a wrong time, a wrong amount, a moment filed on the wrong day. Say what changed when you report back, so the user can see it and correct again if needed.",
    input_schema: {
      type: "object" as const,
      properties: {
        ref: { type: "string", description: "The ref from find_my_logs" },
        occurredAt: { type: "string", description: "New local time: YYYY-MM-DD or YYYY-MM-DDTHH:MM" },
        amount: { type: "number", description: "New amount — dose quantity, or millilitres for intake" },
        label: { type: "string", description: "New label, moments only" },
      },
      required: ["ref"],
    },
  },
]


// ── Correcting and removing the user's own entries ──────────────────────────
//
// Three tables, named explicitly. A kind that isn't on this list cannot be
// reached at all, so a hallucinated ref has nowhere to land.

function fmtLocal(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d)
}

/** A day filter expressed in the user's timezone, not the server's. */
function zonedDayWhere(field: string, tz: string, dayISO: string): Record<string, unknown> {
  const { start, end } = zonedDayRange(tz, dayISO)
  return { [field]: { gte: start, lte: end } }
}

/** What this ref actually points at, in words the user will recognise. */
async function describeRef(userId: string, ref: { kind: RefKind; id: string }): Promise<string | null> {
  const tz = await getUserTimezone(userId)
  if (ref.kind === "dose") {
    const rows = await prisma.$queryRaw<{ timestamp: Date; tagName: string | null; doseAmount: number | null; doseUnit: string | null }[]>`
      SELECT "timestamp","tagName","doseAmount","doseUnit" FROM "OuraTag"
      WHERE "id" = ${ref.id} AND "userId" = ${userId} AND "id" LIKE 'manual_%' LIMIT 1
    `.catch(() => [])
    const r = rows[0]
    if (!r) return null
    const dose = formatDose(r.doseAmount, r.doseUnit)
    return `${r.tagName ?? "unnamed"}${dose ? ` ${dose}` : ""} logged at ${fmtLocal(r.timestamp, tz)}`
  }
  if (ref.kind === "intake") {
    const r = await prisma.intakeLog.findFirst({
      where: { id: ref.id, userId },
      select: { type: true, amountMl: true, note: true, loggedAt: true },
    }).catch(() => null)
    if (!r) return null
    return `${r.amountMl}ml ${r.type}${r.note ? ` (${r.note})` : ""} logged at ${fmtLocal(r.loggedAt, tz)}`
  }
  const r = await prisma.timelineEvent.findFirst({
    where: { id: ref.id, userId },
    select: { emoji: true, label: true, occurredAt: true },
  }).catch(() => null)
  if (!r) return null
  return `${r.emoji} "${r.label}" on ${fmtLocal(r.occurredAt, tz)}`
}

/** Every query carries userId: a ref alone must never reach another account's row. */
async function deleteRef(userId: string, ref: { kind: RefKind; id: string }): Promise<boolean> {
  try {
    if (ref.kind === "dose") {
      const n = await prisma.$executeRaw`
        DELETE FROM "OuraTag" WHERE "id" = ${ref.id} AND "userId" = ${userId} AND "id" LIKE 'manual_%'
      `
      return n > 0
    }
    if (ref.kind === "intake") {
      const { count } = await prisma.intakeLog.deleteMany({ where: { id: ref.id, userId } })
      return count > 0
    }
    const { count } = await prisma.timelineEvent.deleteMany({ where: { id: ref.id, userId } })
    return count > 0
  } catch {
    return false
  }
}

async function correctRef(
  userId: string,
  ref: { kind: RefKind; id: string },
  change: { at: Date | null; amount: number | null; label: string | null },
): Promise<boolean> {
  try {
    if (ref.kind === "dose") {
      if (change.at) {
        // "day" is what every by-date view groups on, so it has to move with
        // the timestamp or the entry lands under one date and reads as another.
        const tz = await getUserTimezone(userId)
        const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(change.at)
        await prisma.$executeRaw`
          UPDATE "OuraTag" SET "timestamp" = ${change.at}, "day" = ${day}
          WHERE "id" = ${ref.id} AND "userId" = ${userId} AND "id" LIKE 'manual_%'
        `
      }
      if (change.amount != null) {
        await prisma.$executeRaw`
          UPDATE "OuraTag" SET "doseAmount" = ${Math.min(100_000, change.amount)},
            "doseUnit" = COALESCE("doseUnit", 'tablet')
          WHERE "id" = ${ref.id} AND "userId" = ${userId} AND "id" LIKE 'manual_%'
        `
      }
      return true
    }
    if (ref.kind === "intake") {
      const { count } = await prisma.intakeLog.updateMany({
        where: { id: ref.id, userId },
        data: {
          ...(change.at ? { loggedAt: change.at } : {}),
          ...(change.amount != null ? { amountMl: Math.round(Math.min(100_000, change.amount)) } : {}),
        },
      })
      return count > 0
    }
    const { count } = await prisma.timelineEvent.updateMany({
      where: { id: ref.id, userId },
      data: {
        ...(change.at ? { occurredAt: change.at } : {}),
        ...(change.label ? { label: change.label.slice(0, 120) } : {}),
      },
    })
    return count > 0
  } catch {
    return false
  }
}

async function executeTool(name: string, input: Record<string, string>, userId: string): Promise<string> {
  if (name === "create_habit") {
    await prisma.habit.create({
      data: { userId, name: input.name, color: input.color ?? "#6366f1" },
    })
    return `Created habit "${input.name}".`
  }

  if (name === "complete_habit_today") {
    const habit = await prisma.habit.findFirst({
      where: { userId, name: { contains: input.habitName, mode: "insensitive" }, isArchived: false },
    })
    if (!habit) return `No habit found matching "${input.habitName}".`
    const { dateColumn: today } = await userDay(userId)
    await prisma.habitCompletion.upsert({
      where: { habitId_date: { habitId: habit.id, date: today } },
      create: { habitId: habit.id, userId, date: today },
      update: {},
    })
    return `Marked "${habit.name}" as complete for today.`
  }

  if (name === "create_reminder") {
    await prisma.reminder.create({
      data: {
        userId,
        title: input.title,
        description: input.description ?? null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        priority: input.priority ?? "normal",
      },
    })
    return `Created reminder "${input.title}".`
  }

  if (name === "log_water") {
    const amountMl = parseInt(String(input.amountMl), 10)
    const { at, minutesAgo } = loggedAtFrom(input)
    await prisma.intakeLog.create({ data: { userId, type: "water", amountMl, loggedAt: at } }).catch(() => null)
    return `Logged ${amountMl}ml of water${agoSuffix(minutesAgo)}.`
  }

  if (name === "log_coffee") {
    const amountMl = parseInt(String(input.amountMl), 10)
    const { at, minutesAgo } = loggedAtFrom(input)
    const log = await prisma.intakeLog.create({ data: { userId, type: "coffee", amountMl, loggedAt: at } }).catch(() => null)
    if (log) {
      const est = estimateCaffeine("coffee", "", amountMl)
      if (est) {
        // The SAME instant as the intake. Caffeine is read as a decay curve
        // against bedtime, so a cup logged an hour late reads as an hour more
        // of it still circulating.
        await prisma.caffeineLog.create({
          data: { id: `intake_${log.id}`, userId, compound: est.compound, caffeineMg: est.mg, loggedAt: at },
        }).catch(() => null)
      }
    }
    return `Logged ${amountMl}ml of coffee${agoSuffix(minutesAgo)}.`
  }

  if (name === "log_drink") {
    const label = String(input.name ?? "").trim().slice(0, 120) || "Drink"
    const type = normalizeDrinkType(String(input.drinkType ?? "other"))
    const amountMl = clampInt(input.amountMl, 1, 5000, 250)

    // The model's caffeine figure is an estimate, not a measurement, so it gets
    // a ceiling: nothing in a glass is 2000mg, and an outlier propagates
    // straight into body-load and the "still circulating at bedtime" chart.
    const rawMg = input.caffeineMg == null ? null : Number(input.caffeineMg)
    const caffeineMg = rawMg == null || !Number.isFinite(rawMg)
      ? null
      : Math.max(0, Math.min(600, Math.round(rawMg)))

    const { at, minutesAgo } = loggedAtFrom(input)
    const log = await prisma.intakeLog.create({
      data: { userId, type, amountMl, note: label, loggedAt: at },
    }).catch(() => null)
    if (!log) return "Couldn't save that drink — the log didn't write."

    if (caffeineMg && caffeineMg > 0) {
      await prisma.caffeineLog.create({
        data: { id: `intake_${log.id}`, userId, compound: type, caffeineMg, loggedAt: at },
      }).catch(() => {})
    }

    const fluid = hydrationMl(type, amountMl)
    const parts = [`Logged ${amountMl}ml ${label}`]
    if (caffeineMg && caffeineMg > 0) parts.push(`≈${caffeineMg}mg caffeine`)
    if (fluid !== amountMl) parts.push(`counts as ${fluid}ml fluid`)
    else parts.push(`${fluid}ml toward hydration`)
    return parts.join(" · ") + agoSuffix(minutesAgo) + "."
  }

  if (name === "log_food") {
    const label = String(input.name ?? "").trim().slice(0, 120)
    if (!label) return "Need a name for the meal."
    const calories = clampInt(input.calories, 0, 10_000, 0)
    const macro = (v: unknown) => {
      const n = Number(v)
      return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : null
    }
    const food = loggedAtFrom(input)
    await prisma.foodLog.create({
      data: {
        loggedAt: food.at,
        userId,
        name: label,
        mealType: ["breakfast", "lunch", "dinner", "snack"].includes(String(input.mealType))
          ? String(input.mealType) : "other",
        calories,
        proteinG: macro(input.proteinG),
        carbsG: macro(input.carbsG),
        fatG: macro(input.fatG),
      },
    }).catch(() => null)
    return `Logged ${label} — ≈${calories} kcal${agoSuffix(food.minutesAgo)}. (Estimated from the name, so treat it as a ballpark.)`
  }

  if (name === "log_usual") {
    const places = await prisma.savedPlace.findMany({ where: { userId } })
    const withUsual = places.filter(p => p.usualType && p.usualMl)
    if (withUsual.length === 0) {
      return "No saved place has a usual order yet — one can be set from the place banner on the dashboard (⭐ Save place → pick the usual)."
    }
    let place: (typeof withUsual)[number] | null = null
    const q = (input.placeName ?? "").trim().toLowerCase()
    if (q) {
      place = withUsual.find(p => p.name.toLowerCase().includes(q)) ?? null
      if (!place) {
        return `No saved place matching "${input.placeName}" has a usual order. Places with a usual: ${withUsual.map(p => p.name).join(", ")}.`
      }
    } else {
      // default to where they last checked in; unambiguous single place also works
      const lastCheckin = await prisma.checkIn.findFirst({
        where: { userId, savedPlaceId: { in: withUsual.map(p => p.id) } },
        orderBy: { checkedAt: "desc" },
      }).catch(() => null)
      place = withUsual.find(p => p.id === lastCheckin?.savedPlaceId)
        ?? (withUsual.length === 1 ? withUsual[0] : null)
      if (!place) {
        return `Which place? Usuals are set at: ${withUsual.map(p => p.name).join(", ")}. Ask the user, then call log_usual with the placeName.`
      }
    }
    const usual = loggedAtFrom(input)
    const log = await prisma.intakeLog.create({
      data: {
        userId,
        type: place.usualType!,
        amountMl: place.usualMl!,
        note: `${place.usualNote || "the usual"} @ ${place.name}`,
        loggedAt: usual.at,
      },
    })
    // same mirroring the intake API does, same deterministic id convention
    const est = estimateCaffeine(place.usualType!, place.usualNote ?? "", place.usualMl!)
    if (est) {
      await prisma.caffeineLog.create({
        data: { id: `intake_${log.id}`, userId, compound: est.compound, caffeineMg: est.mg, loggedAt: usual.at },
      }).catch(() => null)
    }
    return `Logged the usual at ${place.name}: ${place.usualNote || place.usualType}, ${place.usualMl} ml${agoSuffix(usual.minutesAgo)}.${est ? ` Tracked ${est.mg} mg caffeine.` : ""}`
  }

  if (name === "log_mood") {
    const mood = Math.min(5, Math.max(1, parseInt(String(input.mood), 10)))
    const { dateColumn: today } = await userDay(userId)
    await prisma.moodLog.upsert({
      where: { userId_date: { userId, date: today } },
      create: { userId, date: today, mood },
      update: { mood },
    }).catch(() => null)
    return `Logged mood: ${mood}/5 for today.`
  }

  if (name === "log_weight") {
    const weight = parseFloat(String(input.weightKg))
    const { dateColumn: today } = await userDay(userId)
    await prisma.healthLog.upsert({
      where: { userId_date: { userId, date: today } },
      create: { userId, date: today, weight },
      update: { weight },
    }).catch(() => null)
    return `Logged weight: ${weight}kg for today.`
  }

  if (name === "write_daily_note") {
    // setHours(0,0,0,0) is midnight where the server stands — UTC on Vercel.
    // A note written at 00:30 local was filed under the previous day, which is
    // the same mistake log_moment made and the reverse of what the user meant.
    const todayStr = localDateStr(await getUserTimezone(userId))
    await prisma.$executeRaw`
      INSERT INTO "DailyNote" ("id","userId","date","content","updatedAt")
      VALUES (gen_random_uuid()::text, ${userId}, ${todayStr}::date, ${input.content}, NOW())
      ON CONFLICT ("userId","date") DO UPDATE SET "content" = ${input.content}, "updatedAt" = NOW()
    `.catch(() => null)
    return `Journal note saved for today.`
  }

  if (name === "log_morning_checkin") {
    const energy = Math.min(5, Math.max(1, parseInt(String(input.energy), 10)))
    const mood = Math.min(5, Math.max(1, parseInt(String(input.mood), 10)))
    const intention = input.intention?.trim() || null
    const waterGoalMl = parseInt(String(input.waterGoalMl ?? 2000), 10)
    // The day is baked into the row id, so getting it wrong does not merely
    // mislabel the check-in — it writes over, or fails to find, another day's.
    const todayStr = localDateStr(await getUserTimezone(userId))
    const id = `mci_${userId}_${todayStr}`
    await prisma.$executeRaw`
      INSERT INTO "MorningCheckIn" ("id","userId","date","energy","mood","intention","waterGoalMl")
      VALUES (${id}, ${userId}, ${todayStr}, ${energy}, ${mood}, ${intention}, ${waterGoalMl})
      ON CONFLICT ("userId","date") DO UPDATE SET
        "energy" = EXCLUDED."energy", "mood" = EXCLUDED."mood",
        "intention" = EXCLUDED."intention", "waterGoalMl" = EXCLUDED."waterGoalMl"
    `.catch(() => null)
    const energyLabels: Record<number, string> = { 1: "exhausted", 2: "tired", 3: "ok", 4: "good", 5: "amazing" }
    const moodLabels: Record<number, string> = { 1: "awful", 2: "bad", 3: "ok", 4: "good", 5: "great" }
    return `Morning check-in logged! Energy: ${energy}/5 (${energyLabels[energy]}), Mood: ${mood}/5 (${moodLabels[mood]})${intention ? `, Intention: "${intention}"` : ""}.`
  }

  if (name === "get_health_range") {
    // The window starts on the user's day, not the server's, and `since` is
    // that day's local midnight rather than the server's.
    const rangeTz = await getUserTimezone(userId)
    const isDay = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
    const todayStr = localDateStr(rangeTz)

    // Either an explicit window or the last N days. Explicit wins, because
    // "how was last autumn" is not expressible as a number of days back and
    // was the question this could not answer at all.
    const toStr = isDay(input.to) ? String(input.to) : todayStr
    const fromStr = isDay(input.from)
      ? String(input.from)
      : addDaysISO(toStr, -Math.min(365, Math.max(1, parseInt(String(input.days), 10) || 7)))
    const sinceStr = fromStr <= toStr ? fromStr : toStr
    const untilStr = fromStr <= toStr ? toStr : fromStr

    const since = zonedDayRange(rangeTz, sinceStr).start
    const until = zonedDayRange(rangeTz, untilStr).end
    const days = Math.round(
      (Date.parse(`${untilStr}T00:00:00Z`) - Date.parse(`${sinceStr}T00:00:00Z`)) / 86_400_000,
    ) + 1
    const [logs, tags, checkins, notes, moods, intake] = await Promise.all([
      prisma.healthLog.findMany({
        where: { userId, date: { gte: since, lte: until } },
        orderBy: { date: "desc" },
        select: {
          date: true, sleepDuration: true, sleepScore: true, restingHR: true,
          hrv: true, readinessScore: true, steps: true, activityScore: true,
        },
      }).catch(() => [] as any[]),
      prisma.$queryRaw<{ day: string; tagName: string | null; text: string | null }[]>`
        SELECT "day","tagName","text" FROM "OuraTag"
        WHERE "userId" = ${userId} AND "day" >= ${sinceStr} AND "day" <= ${untilStr} ORDER BY "timestamp"
      `.catch(() => []),
      prisma.$queryRaw<{ date: string; energy: number; mood: number; intention: string | null }[]>`
        SELECT "date","energy","mood","intention" FROM "MorningCheckIn"
        WHERE "userId" = ${userId} AND "date" >= ${sinceStr} AND "date" <= ${untilStr}
      `.catch(() => []),
      prisma.dailyNote.findMany({
        where: { userId, date: { gte: since, lte: until } },
        select: { date: true, content: true },
      }).catch(() => [] as { date: Date; content: string }[]),
      prisma.moodLog.findMany({
        where: { userId, date: { gte: since, lte: until } },
        select: { date: true, mood: true },
      }).catch(() => [] as { date: Date; mood: number }[]),
      prisma.intakeLog.findMany({
        where: { userId, loggedAt: { gte: since, lte: until } },
        select: { loggedAt: true, type: true, amountMl: true },
      }).catch(() => [] as { loggedAt: Date; type: string; amountMl: number }[]),
    ])

    const tagsByDay = new Map<string, string[]>()
    for (const t of tags) {
      const label = (t.tagName ?? t.text ?? "").trim()
      if (!label) continue
      const list = tagsByDay.get(t.day) ?? []
      list.push(label)
      tagsByDay.set(t.day, list)
    }
    const checkinByDay = new Map(checkins.map(c => [c.date, c]))
    const noteByDay = new Map(notes.map(n => [n.date.toISOString().split("T")[0], n.content]))
    const moodByDay = new Map(moods.map(m => [m.date.toISOString().split("T")[0], m.mood]))
    const intakeByDay = new Map<string, { water: number; coffee: number }>()
    // loggedAt is a timestamp; slicing it buckets by UTC day, so a late-night
    // glass of water was reported against the day before.
    const intakeDayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: await getUserTimezone(userId) })
    for (const i of intake) {
      const d = intakeDayFmt.format(i.loggedAt)
      const acc = intakeByDay.get(d) ?? { water: 0, coffee: 0 }
      if (i.type === "water") acc.water += i.amountMl
      else if (i.type === "coffee") acc.coffee += i.amountMl
      intakeByDay.set(d, acc)
    }

    const healthByDay = new Map(logs.map((l: any) => [l.date.toISOString().split("T")[0], l]))
    const allDays = [...new Set([
      ...healthByDay.keys(), ...tagsByDay.keys(), ...checkinByDay.keys(),
      ...noteByDay.keys(), ...moodByDay.keys(), ...intakeByDay.keys(),
    ])].sort().reverse()
    if (allDays.length === 0) {
      return `No data between ${sinceStr} and ${untilStr}.`
    }

    // A year of daily rows is three hundred lines of noise, and the noise is
    // exactly what hides a season. Past four months this answers by week.
    if (days > DAILY_MAX_DAYS) {
      const daily: DailyMetrics[] = allDays.map(d => {
        const l = healthByDay.get(d)
        return {
          date: d,
          sleepH: l?.sleepDuration != null ? l.sleepDuration / 60 : null,
          restingHR: l?.restingHR ?? null,
          hrv: l?.hrv ?? null,
          readiness: l?.readinessScore ?? null,
          steps: l?.steps ?? null,
          mood: moodByDay.get(d) ?? checkinByDay.get(d)?.mood ?? null,
        }
      })
      const weeks = rollupWeeks(daily)
      const noted = allDays.filter(d => noteByDay.has(d) || (tagsByDay.get(d)?.length ?? 0) > 0).length
      return [
        `${sinceStr} to ${untilStr}, by week (${weeks.length} weeks, ${allDays.length} days with data).`,
        `Weekly averages — ask for a narrower window to see individual days.`,
        ...weeks.map(renderWeek),
        noted > 0
          ? `\n${noted} of those days also have a journal note or Oura tags; a shorter range returns them.`
          : "",
      ].filter(Boolean).join("\n")
    }

    const rows = allDays.map(d => {
      const l = healthByDay.get(d)
      const parts: string[] = []
      if (l) {
        const sleep = l.sleepDuration != null ? `${(l.sleepDuration / 60).toFixed(1)}h` : "?"
        parts.push(`sleep ${sleep}${l.sleepScore != null ? ` (score ${l.sleepScore})` : ""}, restingHR ${l.restingHR ?? "?"}bpm, HRV ${l.hrv != null ? Math.round(l.hrv) + "ms" : "?"}, readiness ${l.readinessScore ?? "?"}, steps ${l.steps ?? "?"}`)
      }
      const dayTags = tagsByDay.get(d)
      if (dayTags?.length) parts.push(`Oura tags: ${dayTags.join(", ")}`)
      const ink = intakeByDay.get(d)
      if (ink && (ink.water > 0 || ink.coffee > 0)) {
        parts.push(`logged:${ink.water > 0 ? ` water ${ink.water}ml` : ""}${ink.coffee > 0 ? ` coffee ${ink.coffee}ml` : ""}`)
      }
      const c = checkinByDay.get(d)
      if (c) parts.push(`check-in: energy ${c.energy}/5, mood ${c.mood}/5${c.intention ? `, intention "${c.intention}"` : ""}`)
      const m = moodByDay.get(d)
      if (m != null) parts.push(`mood ${m}/5`)
      const note = noteByDay.get(d)
      if (note) parts.push(`journal: "${note.length > 160 ? note.slice(0, 160) + "…" : note}"`)
      return `${d}: ${parts.join(" | ")}`
    }).join("\n")
    // Named by the window rather than "last N days": with from/to it may not
    // end today at all, and telling him a stretch of last autumn was "the last
    // 30 days" is how a right answer gets attached to the wrong dates.
    return `${sinceStr} to ${untilStr} (most recent first — health, Oura tags, intake, check-ins, mood, journal):\n${rows}`
  }

  if (name === "get_day_journey") {
    // The same stay/move segmentation the location page draws, so the two
    // never disagree about what a day looked like.
    const jTz = await getUserTimezone(userId)
    const raw = String(input.date ?? "").trim()
    const jDate = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : localDateStr(jTz)
    const { start: jStart, end: jEnd } = zonedDayRange(jTz, jDate)

    const rows = await prisma.locationPoint.findMany({
      where: { userId, trackedAt: { gte: jStart, lte: jEnd } },
      orderBy: { trackedAt: "asc" },
      select: { lat: true, lng: true, trackedAt: true },
    }).catch(() => [])
    if (rows.length < 2) return `No location was tracked on ${jDate}.`

    const points = rows.map(r => ({ lat: r.lat, lon: r.lng, time: r.trackedAt }))
    // The same overlay the location page applies: Strava, imported Timeline
    // activities, the phone's recognition. Without it his description of a
    // day and the page's drawing of it could name different modes.
    const known = await loadKnownModes(userId, jStart, jEnd).catch(() => [])
    const segments = applyKnownModes(buildJourney(points, detectStops(points)), known)
    if (segments.length === 0) return `Nothing worth calling a stay or a journey on ${jDate}.`

    const savedPlaces = await prisma.savedPlace.findMany({
      where: { userId },
      select: { id: true, name: true, emoji: true, lat: true, lng: true, radiusM: true },
    }).catch(() => [])

    // Street names already looked up for the day view are sitting in the same
    // cache; reading them costs one query and no network. A stay with neither
    // a saved place nor a cached street stays anonymous rather than being
    // described by its coordinates, which tell nobody anything.
    const stays = segments.filter(seg => seg.kind === "stay")
    const cached = stays.length === 0 ? [] : await prisma.userPreference.findMany({
      where: { userId, key: { in: stays.map(st => placeNameKey(st.lat, st.lon, "street")) } },
      select: { key: true, value: true },
    }).catch(() => [])
    const streets = new Map(cached.map(c => [c.key, c.value]))

    const at = (d: Date) => localTimeStr(jTz, d)
    const dur = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`)
    const lines = segments.map(seg => {
      if (seg.kind === "gap") return `${at(seg.start)}–${at(seg.end)} no tracking (${dur(seg.minutes)})`
      if (seg.kind === "move") {
        const km = seg.distanceM >= 1000
          ? `${(seg.distanceM / 1000).toFixed(1)} km`
          : `${seg.distanceM} m`
        const how = { walk: "walking", run: "running", cycle: "cycling", transit: "by bus or tram",
          drive: "driving", train: "by train", flight: "flying", unknown: "travelling" }[seg.mode]
        return `${at(seg.start)}–${at(seg.end)} ${how}, ${km} (${dur(seg.minutes)}${
          seg.confidence === "guess" ? ", mode is a guess" : ""})`
      }
      const saved = matchSavedPlace(seg.lat, seg.lon, savedPlaces)
      const street = streets.get(placeNameKey(seg.lat, seg.lon, "street"))
      const where = saved ? `at ${saved.place.name}`
        : street ? `at an unnamed place near ${street}`
        : "somewhere unnamed"
      return `${at(seg.start)}–${at(seg.end)} ${where} (${dur(seg.minutes)})`
    })

    return `Where ${jDate} went:\n${lines.join("\n")}`
  }

  if (name === "search_chat_history") {
    // Emergy's own recall. Everything he and the user have ever said is in
    // ChatMessage; until this existed, nothing ever read it back, so a new
    // conversation began with no knowledge that the previous ones happened —
    // and he would say, truthfully but uselessly, that he keeps no transcript.
    const rawQuery = String(input.query ?? "").trim()
    const date = String(input.date ?? "").trim()
    const days = parseInt(String(input.days ?? ""), 10)

    const tz = await getUserTimezone(userId)
    let range: { gte?: Date; lte?: Date } | undefined
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const { start, end } = zonedDayRange(tz, date)
      range = { gte: start, lte: end }
    } else if (Number.isFinite(days) && days > 0) {
      range = { gte: zonedDayRange(tz, addDaysISO(localDateStr(tz), -Math.min(365, days))).start }
    }

    // Stop words stripped: see lib/chat-recall.
    const terms = recallTerms(rawQuery)

    if (terms.length === 0 && !range) {
      return "Give me something to search for — a word from the conversation, or a date."
    }

    const hits = await prisma.chatMessage.findMany({
      where: {
        userId,
        ...(range && { createdAt: range }),
        ...(terms.length > 0 && {
          OR: terms.map(t => ({ content: { contains: t, mode: "insensitive" as const } })),
        }),
      },
      orderBy: { createdAt: "desc" },
      take: terms.length > 0 ? 40 : 60,
      select: { id: true, role: true, content: true, createdAt: true, conversationId: true },
    }).catch(() => [])

    if (hits.length === 0) {
      return terms.length > 0
        ? `Nothing in our past conversations mentions ${terms.map(t => `"${t}"`).join(" or ")}${range ? " in that window" : ""}.`
        : "We did not talk on that day."
    }

    // Prisma's OR ranks every partial match equally and newest-first, which
    // puts a message that merely says "church" above the one that says church
    // AND tower AND Sofia. lib/chat-recall re-ranks by how many terms hit.
    const scored = rankRecallHits(hits, terms, RECALL_MAX_HITS)

    // A user's question without the answer to it is half a memory, so each hit
    // brings the reply that followed it in the same conversation.
    //
    // Emitted ids are tracked because that reply is very often a hit in its own
    // right — the words being searched for appear in both halves of the
    // exchange — and quoting it twice, once as an answer and once as its own
    // entry, made a three-message conversation read as five.
    const lines: string[] = []
    const emitted = new Set<string>()
    for (const m of scored) {
      if (emitted.has(m.id)) continue
      emitted.add(m.id)
      const when = `${localDateStr(tz, m.createdAt)} ${localTimeStr(tz, m.createdAt)}`
      lines.push(`[${when}] ${m.role === "user" ? "You" : "Me"}: ${trimForRecall(m.content)}`)

      if (m.role === "user" && m.conversationId) {
        const reply = await prisma.chatMessage.findFirst({
          where: {
            userId,
            conversationId: m.conversationId,
            role: "assistant",
            createdAt: { gt: m.createdAt },
          },
          orderBy: { createdAt: "asc" },
          select: { id: true, content: true },
        }).catch(() => null)
        if (reply && !emitted.has(reply.id)) {
          emitted.add(reply.id)
          lines.push(`          Me: ${trimForRecall(reply.content)}`)
        }
      }
    }

    return `From our past conversations:\n${lines.join("\n")}`
  }

  if (name === "remember") {
    const fact = String(input.fact ?? "").trim()
    if (!fact) return "Nothing to remember."
    // Dated, and replacing anything it restates rather than sitting beside it.
    // Exact-string dedupe kept "I hate mornings" and "hates mornings" as two
    // memories, spending two of fifty slots to say one thing.
    const today = localDateStr(await getUserTimezone(userId))
    const existing = await prisma.userPreference.findUnique({
      where: { userId_key: { userId, key: MEMORY_KEY } },
      select: { value: true },
    }).catch(() => null)
    const facts = addFact(parseFacts(existing?.value), fact, today)
    await prisma.userPreference.upsert({
      where: { userId_key: { userId, key: MEMORY_KEY } },
      create: { userId, key: MEMORY_KEY, value: serialiseFacts(facts) },
      update: { value: serialiseFacts(facts) },
    }).catch(() => null)
    return `Got it — I'll remember that: "${fact}".`
  }

  if (name === "forget") {
    // The counterpart `remember` never had. Told a year ago about marathon
    // training and told today that it stopped, he kept both, and the dead one
    // went on shaping every conversation after. Nothing in the chat could
    // remove it — only Settings, which means noticing and going to look.
    const query = String(input.fact ?? "").trim()
    if (!query) return "Forget what?"
    const row = await prisma.userPreference.findUnique({
      where: { userId_key: { userId, key: MEMORY_KEY } },
      select: { value: true },
    }).catch(() => null)
    const before = parseFacts(row?.value)
    if (before.length === 0) return "There is nothing saved about them yet."

    const { facts, removed, ambiguous } = forgetFact(before, query)
    if (ambiguous.length > 0) {
      // Deleting the wrong memory is worse than deleting none: nobody finds
      // out until something odd gets said weeks later.
      return `That could be any of these — ask which one, then call again with its wording:\n${
        ambiguous.map(f => `- ${f.fact}`).join("\n")}`
    }
    if (!removed) return `Nothing saved matches "${query}", so there is nothing to forget.`

    await prisma.userPreference.upsert({
      where: { userId_key: { userId, key: MEMORY_KEY } },
      create: { userId, key: MEMORY_KEY, value: serialiseFacts(facts) },
      update: { value: serialiseFacts(facts) },
    }).catch(() => null)
    return `Forgotten: "${removed.fact}".`
  }

  if (name === "complete_reminder") {
    const q = String(input.title ?? "").trim()
    if (!q) return "Which reminder?"
    const reminder = await prisma.reminder.findFirst({
      where: { userId, isCompleted: false, title: { contains: q, mode: "insensitive" } },
      orderBy: { dueDate: "asc" },
    }).catch(() => null)
    if (!reminder) {
      const open = await prisma.reminder.findMany({
        where: { userId, isCompleted: false },
        orderBy: { dueDate: "asc" },
        take: 5,
        select: { title: true },
      }).catch(() => [] as { title: string }[])
      return open.length
        ? `No open reminder matches "${q}". Open ones: ${open.map(r => `"${r.title}"`).join(", ")}.`
        : `No open reminder matches "${q}" — the list is empty.`
    }
    const done = await prisma.reminder.update({
      where: { id: reminder.id },
      data: { isCompleted: true, completedAt: new Date() },
    }).catch(() => null)
    if (!done) return `Couldn't mark "${reminder.title}" as done — the update didn't write. Worth retrying.`
    return `Marked "${reminder.title}" as done.`
  }

  if (name === "log_focus") {
    const durationMin = clampInt(input.durationMin, 1, 600, 0)
    if (!durationMin) return "Need a duration in minutes."
    const label = String(input.label ?? "").trim().slice(0, 120) || null
    const endedAt = new Date()
    const saved = await prisma.focusSession.create({
      data: {
        userId, durationMin, type: "focus", label,
        startedAt: new Date(endedAt.getTime() - durationMin * 60_000),
        endedAt,
      },
    }).catch(() => null)
    if (!saved) return "Couldn't save that focus session — the log didn't write. Worth retrying."
    return `Logged ${durationMin}min of deep work${label ? ` on "${label}"` : ""}.`
  }

  if (name === "log_custom_metric") {
    const q = String(input.metricName ?? "").trim()
    if (!q) return "Which tracker?"
    const metrics = await prisma.$queryRaw<{ id: string; name: string; emoji: string; type: string }[]>`
      SELECT "id","name","emoji","type" FROM "CustomMetric" WHERE "userId" = ${userId}
    `.catch(() => [] as { id: string; name: string; emoji: string; type: string }[])
    const metric = metrics.find(m => m.name.toLowerCase() === q.toLowerCase())
      ?? metrics.find(m => m.name.toLowerCase().includes(q.toLowerCase()))
    if (!metric) {
      return metrics.length
        ? `No tracker matches "${q}". They have: ${metrics.map(m => `${m.emoji} ${m.name}`).join(", ")}.`
        : `No custom trackers exist yet — they can be created on the Trackers page.`
    }
    const raw = Number(input.value)
    if (!Number.isFinite(raw)) return "Need a numeric value."
    const value = metric.type === "boolean" ? (raw >= 1 ? 1 : 0) : Math.round(raw * 100) / 100
    const note = String(input.note ?? "").trim().slice(0, 200) || null
    const tz = await getUserTimezone(userId)
    const dateStr = localDateStr(tz)
    // Same write the Trackers page does: one value per metric per day.
    const wrote = await prisma.$executeRaw`
      INSERT INTO "CustomMetricLog"("id","userId","metricId","date","value","note")
      VALUES (${randomUUID()}, ${userId}, ${metric.id}, ${dateStr}::date, ${value}, ${note})
      ON CONFLICT ("metricId","date") DO UPDATE SET "value" = EXCLUDED."value", "note" = EXCLUDED."note"
    `.catch(() => 0)
    if (!wrote) return `Couldn't save ${metric.name} — the log didn't write. Worth retrying.`
    return `Logged ${metric.emoji} ${metric.name} = ${metric.type === "boolean" ? (value ? "yes" : "no") : value} for today.`
  }

  if (name === "log_symptom") {
    const label = String(input.name ?? "").trim().slice(0, 80)
    if (!label) return "Need a symptom name."
    const severity = clampInt(input.severity, 1, 5, 3)
    const note = String(input.note ?? "").trim().slice(0, 300) || null
    const tz = await getUserTimezone(userId)
    const savedSymptom = await prisma.symptomLog.create({
      data: {
        userId,
        name: label.charAt(0).toUpperCase() + label.slice(1),
        severity, note,
        day: localDateStr(tz),
      },
    }).catch(() => null)
    if (!savedSymptom) return "Couldn't save that symptom — the log didn't write. Worth retrying."
    return `Logged ${label} at ${severity}/5. Hope it eases up.`
  }

  if (name === "log_dose") {
    const label = String(input.name ?? "").trim().slice(0, 60)
    if (!label) return "Which medication or supplement?"

    // An amount the model states wins; otherwise read one off the label, so a
    // user saying "Atarax half" still records ½ tablet rather than nothing.
    const rawAmount = Number(input.doseAmount)
    const unit = input.doseUnit === "mg" || input.doseUnit === "tablet" ? input.doseUnit : null
    const dose = Number.isFinite(rawAmount) && rawAmount > 0 && unit
      ? { amount: Math.min(100_000, rawAmount), unit }
      : parseDose(label)

    const minutesAgo = clampInt(input.minutesAgo, 0, 48 * 60, 0)
    const timestamp = new Date(Date.now() - minutesAgo * 60_000)
    const tz = await getUserTimezone(userId)

    const wrote = await prisma.$executeRaw`
      INSERT INTO "OuraTag" ("id","userId","day","timestamp","tagName","text","tags","doseAmount","doseUnit")
      VALUES (${`manual_${randomUUID()}`}, ${userId}, ${localDateStr(tz, timestamp)}, ${timestamp}, ${label}, ${null}, ARRAY['manual']::text[], ${dose?.amount ?? null}, ${dose?.unit ?? null})
    `.catch(() => 0)
    if (!wrote) return `Couldn't log ${label} — the write didn't go through. Worth retrying.`

    const amountStr = dose ? formatDose(dose.amount, dose.unit) : null
    return `Logged ${label}${amountStr ? ` — ${amountStr}` : ""}${minutesAgo ? `, ${minutesAgo} min ago` : ""}.`
  }

  if (name === "log_moment") {
    const label = String(input.label ?? "").trim().slice(0, 120)
    if (!label) return "Need a label for the moment."
    const emoji = String(input.emoji ?? "").trim().slice(0, 8) || "📌"
    const note = String(input.note ?? "").trim().slice(0, 500) || null

    // A moment logged at 00:02 about the evening just gone belongs to that
    // evening. occurredAt defaulted to now(), so the journal entry and the
    // moment it came from could land on two different days.
    let occurredAt: Date | undefined
    const whenRaw = String(input.occurredAt ?? "").trim()
    if (whenRaw) {
      const tz = await getUserTimezone(userId)
      const parsed = zonedDateTime(tz, whenRaw)
      // A moment can be backdated but not postdated: the future is not
      // something that has happened.
      if (parsed && parsed.getTime() <= Date.now() + 60_000) occurredAt = parsed
    }

    const savedMoment = await prisma.timelineEvent.create({
      data: { userId, emoji, label, note, ...(occurredAt ? { occurredAt } : {}) },
    }).catch(() => null)
    if (!savedMoment) return "Couldn't save that moment — the log didn't write. Worth retrying."
    const stamp = occurredAt
      ? ` (${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: await getUserTimezone(userId) }).format(occurredAt)})`
      : ""
    return `Saved to the timeline: ${emoji} ${label}${stamp}.`
  }

  if (name === "find_my_logs") {
    const kind = String(input.kind ?? "")
    if (!isRefKind(kind)) return "I can look up doses, intake or moments."
    const tz = await getUserTimezone(userId)
    const dayFilter = String(input.date ?? "").trim()
    const nameFilter = String(input.name ?? "").trim().toLowerCase()

    if (kind === "dose") {
      // Only manual rows: an Oura-sourced tag returns on the next sync, so
      // offering to remove one would be a promise the ring undoes.
      const rows = await prisma.$queryRaw<{ id: string; timestamp: Date; tagName: string | null; doseAmount: number | null; doseUnit: string | null }[]>`
        SELECT "id","timestamp","tagName","doseAmount","doseUnit" FROM "OuraTag"
        WHERE "userId" = ${userId} AND "id" LIKE 'manual_%'
          ${dayFilter ? Prisma.sql`AND "day" = ${dayFilter}` : Prisma.empty}
        ORDER BY "timestamp" DESC LIMIT 40
      `.catch(() => [])
      const hits = rows.filter(r => !nameFilter || (r.tagName ?? "").toLowerCase().includes(nameFilter)).slice(0, 15)
      if (hits.length === 0) return "Nothing matching that."
      return hits.map(r =>
        `${makeRef("dose", r.id)} — ${r.tagName ?? "unnamed"}${formatDose(r.doseAmount, r.doseUnit) ? ` ${formatDose(r.doseAmount, r.doseUnit)}` : ""} at ${fmtLocal(r.timestamp, tz)}`
      ).join("\n")
    }

    if (kind === "intake") {
      const rows = await prisma.intakeLog.findMany({
        where: { userId, ...(dayFilter ? zonedDayWhere("loggedAt", tz, dayFilter) : {}) },
        orderBy: { loggedAt: "desc" }, take: 40,
        select: { id: true, type: true, amountMl: true, note: true, loggedAt: true },
      }).catch(() => [])
      const hits = rows.filter(r => !nameFilter || r.type.toLowerCase().includes(nameFilter) || (r.note ?? "").toLowerCase().includes(nameFilter)).slice(0, 15)
      if (hits.length === 0) return "Nothing matching that."
      return hits.map(r =>
        `${makeRef("intake", r.id)} — ${r.amountMl}ml ${r.type}${r.note ? ` (${r.note})` : ""} at ${fmtLocal(r.loggedAt, tz)}`
      ).join("\n")
    }

    const rows = await prisma.timelineEvent.findMany({
      where: { userId, ...(dayFilter ? zonedDayWhere("occurredAt", tz, dayFilter) : {}) },
      orderBy: { occurredAt: "desc" }, take: 40,
      select: { id: true, emoji: true, label: true, occurredAt: true },
    }).catch(() => [])
    const hits = rows.filter(r => !nameFilter || r.label.toLowerCase().includes(nameFilter)).slice(0, 15)
    if (hits.length === 0) return "Nothing matching that."
    return hits.map(r => `${makeRef("moment", r.id)} — ${r.emoji} ${r.label} at ${fmtLocal(r.occurredAt, tz)}`).join("\n")
  }

  if (name === "delete_log") {
    const ref = String(input.ref ?? "").trim()
    const parsed = parseRef(ref)
    if (!parsed) return "That isn't a ref I recognise. Use find_my_logs first."

    const described = await describeRef(userId, parsed)
    if (!described) return "That entry doesn't exist any more — nothing to delete."

    const confirm = String(input.confirm ?? "").trim()
    if (!confirm) {
      // Nothing is deleted on this call, by design. The token is an HMAC the
      // model cannot compute, so the round trip through the user is enforced
      // here rather than requested in the prompt.
      return `NOT DELETED YET. This would delete: ${described}. Show the user exactly that and ask them to confirm. If they say yes, call delete_log again with ref="${ref}" and confirm="${issueConfirmToken(userId, ref)}".`
    }
    if (!verifyConfirmToken(userId, ref, confirm)) {
      return "That confirmation isn't valid or has expired. Ask the user again, starting from a fresh delete_log call without a confirm."
    }

    const ok = await deleteRef(userId, parsed)
    return ok ? `Deleted: ${described}.` : "Couldn't delete that — nothing was removed."
  }

  if (name === "correct_log") {
    const ref = String(input.ref ?? "").trim()
    const parsed = parseRef(ref)
    if (!parsed) return "That isn't a ref I recognise. Use find_my_logs first."
    const before = await describeRef(userId, parsed)
    if (!before) return "That entry doesn't exist any more."

    const tz = await getUserTimezone(userId)
    const when = String(input.occurredAt ?? "").trim()
    const at = when ? zonedDateTime(tz, when) : null
    if (when && !at) return "I couldn't read that time. Use YYYY-MM-DD or YYYY-MM-DDTHH:MM."
    if (at && at.getTime() > Date.now() + 60_000) return "That time is in the future — a log has to be of something that happened."

    const amountRaw = input.amount
    const amount = amountRaw === undefined || amountRaw === null || amountRaw === "" ? null : Number(amountRaw)
    if (amount != null && (!Number.isFinite(amount) || amount <= 0)) return "An amount needs to be a positive number."

    const label = String(input.label ?? "").trim()
    if (!at && amount == null && !label) return "Nothing to change — give a time, an amount or a label."

    const ok = await correctRef(userId, parsed, { at, amount, label: label || null })
    if (!ok) return "Couldn't change that — nothing was altered."
    const after = await describeRef(userId, parsed)
    return `Changed. Before: ${before}. Now: ${after}. Tell the user both, so they can see it and correct again if it's still wrong.`
  }

  return "Unknown tool."
}

/** How far the calendar section reaches, and what its source chip reports. */
const CALENDAR_DAYS_BACK = 30
const CALENDAR_DAYS_AHEAD = 14

export async function buildSystemPrompt(
  userId: string,
): Promise<{ prompt: string; manifest: SourceManifest }> {
  const today = new Date()

  // The user's IANA timezone (captured by TimezoneDetector into UserPreference).
  // Calendar events are stored in UTC — without this, times render hours off
  // and "today" flips at the wrong moment.
  const tzRow = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key: "timezone" } },
  }).catch(() => null)
  const tz = tzRow?.value || "UTC"
  const fmtDay = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" })
  const fmtTime = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false })
  const fmtDateISO = new Intl.DateTimeFormat("en-CA", { timeZone: tz }) // YYYY-MM-DD

  const todayStr = fmtDateISO.format(today)
  // The user's day starts at THEIR midnight; timestamp columns are compared
  // against that instant, date-only columns against the date itself.
  const dayStart = zonedDayRange(tz, todayStr).start
  const monthStart = new Date(todayStr.slice(0, 7) + "-01T00:00:00Z")

  const since14 = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000)
  const since7 = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)

  const since7Str = fmtDateISO.format(new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000))

  const [recentHealth, recentTransactions, habits, upcomingReminders, calendarEvents, todayMood, todayIntake, todayFood, recentOuraTags, recentCheckins, recentScreenTime, caffeineDoses24h] =
    await Promise.all([
      prisma.healthLog.findMany({
        where: { userId }, orderBy: { date: "desc" }, take: 14,
        select: {
          id: true, date: true, sleepDuration: true, deepSleep: true, remSleep: true,
          steps: true, restingHR: true, weight: true, activeMinutes: true, caloriesBurned: true,
          readinessScore: true, hrv: true, spo2: true, activityScore: true, breathingRate: true,
          sleepScore: true,
        },
      }),
      prisma.transaction.findMany({ where: { userId, date: { gte: monthStart } }, orderBy: { date: "desc" }, take: 100 }),
      prisma.habit.findMany({
        where: { userId, isArchived: false },
        include: {
          completions: {
            where: { date: { gte: new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000) } },
            orderBy: { date: "desc" },
          },
        },
      }),
      prisma.reminder.findMany({ where: { userId, isCompleted: false }, orderBy: { dueDate: "asc" }, take: 20 }),
      getEventsInRange(
        userId,
        new Date(today.getTime() - CALENDAR_DAYS_BACK * 24 * 60 * 60 * 1000).toISOString(),
        new Date(today.getTime() + CALENDAR_DAYS_AHEAD * 24 * 60 * 60 * 1000).toISOString(),
      ),
      prisma.moodLog.findFirst({ where: { userId, date: { gte: new Date(todayStr) } } }).catch(() => null),
      prisma.intakeLog.findMany({ where: { userId, loggedAt: { gte: dayStart } } }).catch(() => []),
      prisma.foodLog.findMany({
        where: { userId, loggedAt: { gte: dayStart } },
        select: { name: true, mealType: true, calories: true, proteinG: true, micros: true },
        orderBy: { loggedAt: "asc" },
      }).catch(() => [] as { name: string; mealType: string; calories: number; proteinG: number | null; micros: unknown }[]),
      prisma.$queryRaw<{ day: string; tagName: string | null; text: string | null }[]>`
        SELECT "day","tagName","text" FROM "OuraTag"
        WHERE "userId" = ${userId} AND "day" >= ${since7Str} ORDER BY "timestamp"
      `.catch(() => []),
      prisma.$queryRaw<{ date: string; energy: number; mood: number; intention: string | null; waterGoalMl: number }[]>`
        SELECT "date","energy","mood","intention","waterGoalMl" FROM "MorningCheckIn"
        WHERE "userId" = ${userId} AND "date" >= ${since7Str} ORDER BY "date" DESC
      `.catch(() => []),
      prisma.screenTimeLog.findMany({
        where: { userId }, orderBy: { date: "desc" }, take: 7,
        select: { date: true, totalMin: true, firstUnlockMin: true },
      }).catch(() => [] as { date: string; totalMin: number; firstUnlockMin: number | null }[]),
      prisma.caffeineLog.findMany({
        where: { userId, loggedAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
        select: { caffeineMg: true, loggedAt: true },
      }).catch(() => [] as { caffeineMg: number; loggedAt: Date }[]),
    ])

  // Everything below was in the database but invisible to Emergy: he could see
  // that a place called "Gym" existed but not that they had been there, knew
  // their symptoms but not their prescriptions, and had no idea what they were
  // aiming at. Fetched in one batch alongside the rest so the extra sources
  // cost latency once, not seven times.
  const [locationPoints, timelineEvents, focusSessions, medSchedules, books, goals, routines, cachedInsights] = await Promise.all([
    // Raw pings, summarised below rather than listed — there can be thousands
    // a week and none of them mean anything individually.
    prisma.locationPoint.findMany({
      where: { userId, trackedAt: { gte: since7 } },
      orderBy: { trackedAt: "asc" }, take: 3000,
      select: { lat: true, lng: true, trackedAt: true },
    }).catch(() => [] as { lat: number; lng: number; trackedAt: Date }[]),
    prisma.timelineEvent.findMany({
      where: { userId, occurredAt: { gte: since14 } },
      orderBy: { occurredAt: "desc" }, take: 15,
      select: { emoji: true, label: true, note: true, occurredAt: true },
    }).catch(() => [] as { emoji: string; label: string; note: string | null; occurredAt: Date }[]),
    prisma.focusSession.findMany({
      where: { userId, startedAt: { gte: since7 }, type: "focus" },
      orderBy: { startedAt: "desc" }, take: 100,
      select: { durationMin: true, label: true, startedAt: true },
    }).catch(() => [] as { durationMin: number; label: string | null; startedAt: Date }[]),
    prisma.medSchedule.findMany({
      where: { userId, active: true },
      select: { name: true, dose: true, times: true, daysOfWeek: true, note: true, startDate: true, endDate: true },
    }).catch(() => [] as { name: string; dose: string | null; times: string[]; daysOfWeek: number[]; note: string | null; startDate: string | null; endDate: string | null }[]),
    prisma.book.findMany({
      where: { userId, status: { in: ["reading", "done"] } },
      orderBy: { updatedAt: "desc" }, take: 8,
      select: { title: true, author: true, status: true, rating: true, finishedAt: true },
    }).catch(() => [] as { title: string; author: string | null; status: string; rating: number | null; finishedAt: Date | null }[]),
    prisma.userGoals.findUnique({ where: { userId } }).catch(() => null),
    prisma.habitRoutine.findMany({
      where: { userId }, orderBy: { sortOrder: "asc" },
      select: { name: true, emoji: true, habitIds: true },
    }).catch(() => [] as { name: string; emoji: string; habitIds: string[] }[]),
    // The correlation engine tests 51 relationships and puts every one through
    // a permutation test and Benjamini-Hochberg correction — and the results
    // lived on a page. Emergy, the one part of this app that actually talks,
    // could not see a single finding. This reads the cache the insights page
    // and the nightly cron both write, so nothing is recomputed here: a chat
    // message must never trigger a 1000-shuffle run.
    prisma.userPreference.findUnique({
      where: { userId_key: { userId, key: "insights_cache:overall" } },
      select: { value: true },
    }).catch(() => null),
  ])

  const [recentMoods, todayWeather, recentNotes, recentLabs, latestBody, recentWorkouts, recentSymptoms, fastActivePref, fastHistoryPref] = await Promise.all([
    prisma.moodLog.findMany({ where: { userId, date: { gte: since14 } }, orderBy: { date: "desc" } }).catch(() => [] as { date: Date; mood: number }[]),
    prisma.weatherLog.findFirst({
      where: { userId, date: todayStr },
      select: { tempMaxC: true, tempMinC: true, precipMm: true, uvIndex: true, weatherCode: true },
    }).catch(() => null),
    prisma.dailyNote.findMany({
      where: { userId, date: { gte: since14 } },
      orderBy: { date: "desc" }, take: 5,
      select: { date: true, content: true },
    }).catch(() => [] as { date: Date; content: string }[]),
    // High-signal, low-volume context Emergy never saw before: blood work,
    // body composition, workouts and fasting state.
    prisma.labResult.findMany({
      where: { userId }, orderBy: { date: "desc" }, take: 60,
      select: { marker: true, value: true, unit: true, referenceMin: true, referenceMax: true, date: true },
    }).catch(() => [] as { marker: string; value: number; unit: string; referenceMin: number | null; referenceMax: number | null; date: Date }[]),
    prisma.bodyMeasurement.findFirst({ where: { userId }, orderBy: { date: "desc" } }).catch(() => null),
    prisma.stravaActivity.findMany({
      where: { userId }, orderBy: { startDate: "desc" }, take: 7,
      select: { day: true, type: true, name: true, distanceM: true, movingTimeSec: true, avgHR: true },
    }).catch(() => [] as { day: string; type: string; name: string | null; distanceM: number | null; movingTimeSec: number; avgHR: number | null }[]),
    prisma.symptomLog.findMany({
      where: { userId, loggedAt: { gte: since14 } },
      orderBy: { loggedAt: "desc" }, take: 40,
      select: { name: true, severity: true, day: true, note: true },
    }).catch(() => [] as { name: string; severity: number; day: string; note: string | null }[]),
    prisma.userPreference.findUnique({ where: { userId_key: { userId, key: "fast:active" } } }).catch(() => null),
    prisma.userPreference.findUnique({ where: { userId_key: { userId, key: "fast:history" } } }).catch(() => null),
  ])

  // Long-term memory — facts Emergy has saved about the user across conversations
  const memoryRow = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key: MEMORY_KEY } },
  }).catch(() => null)
  const memories = parseFacts(memoryRow?.value)

  const habitsWithStreaks = habits.map((h) => {
    let streak = 0
    // Walked in date-string space from the user's today. c.date is a date-only
    // column, so slicing its ISO string is exact; the cursor was not, and
    // started from the server's midnight.
    let cursor = todayStr
    const completionDates = new Set(h.completions.map((c) => c.date.toISOString().split("T")[0]))
    while (completionDates.has(cursor)) {
      streak++; cursor = addDaysISO(cursor, -1)
    }
    return { name: h.name, streak, completedToday: completionDates.has(todayStr) }
  })

  const spendingByCategory = recentTransactions
    .filter((t) => t.amount < 0 && !t.isTransfer)
    .reduce((acc, t) => {
      const cat = t.category ?? "Uncategorized"
      acc[cat] = (acc[cat] ?? 0) + Math.abs(t.amount)
      return acc
    }, {} as Record<string, number>)

  const totalSpent = Object.values(spendingByCategory).reduce((a, b) => a + b, 0)
  const totalIncome = recentTransactions.filter((t) => t.amount > 0 && !t.isTransfer).reduce((sum, t) => sum + t.amount, 0)

  // Non-drink Oura tags today = supplements/meds (drink tags are mirrored into
  // IntakeLog by the Oura sync, so intake totals below already include them —
  // adding tag amounts here would double-count)
  const todayOuraTags = (recentOuraTags as any[]).filter((t) => t.day === todayStr)
  const ouraMeds: string[] = []
  const seenMedNames = new Set<string>()
  for (const t of (todayOuraTags as any[])) {
    const label = (t.tagName ?? t.text ?? "").trim()
    if (!label) continue
    if (classifyOuraTag(label).kind !== "med") continue
    // canonical substance names ("vitamín D" → Vitamin D) so Emergy talks
    // about one thing per supplement, not one per spelling
    const display = normalizeSupplement(label) ?? cleanLabel(label)
    if (!seenMedNames.has(display.toLowerCase())) { seenMedNames.add(display.toLowerCase()); ouraMeds.push(display) }
  }

  // Caffeine still circulating. The app fits the user's own half-life from how
  // their bedtime residual tracks against sleep score, and /api/caffeine and
  // /api/body-load both use it — but this didn't, so Emergy reasoned on the 5h
  // population default and then stated "5h half-life" as if it were the user's.
  // Someone who clears caffeine in 7h was being told their evening coffee had
  // largely gone when it hadn't.
  const caffeineProfile = await getPersonalCaffeineProfile(userId).catch(() => null)
  const halfLifeH = caffeineProfile?.halfLifeH ?? HALF_LIFE_H
  const halfLifeIsPersonal = !!caffeineProfile && !caffeineProfile.usedDefault

  const todayCaffeineMg = (caffeineDoses24h as { caffeineMg: number; loggedAt: Date }[])
    .filter(d => d.loggedAt >= dayStart)
    .reduce((s, d) => s + d.caffeineMg, 0)
  const activeCaffeineMg = activeFromDoses(
    caffeineDoses24h as { caffeineMg: number; loggedAt: Date }[],
    Date.now(),
    halfLifeH,
  )

  // Meals logged today (photo-analyzed or manual), with the vitamins/minerals
  // they carried so Emergy can connect food micros with Oura supplements
  const foodRows = todayFood as { name: string; mealType: string; calories: number; proteinG: number | null; micros: unknown }[]
  const microAgg = new Map<string, number>()
  for (const f of foodRows) {
    if (!Array.isArray(f.micros)) continue
    for (const m of f.micros as { name?: string; dailyPct?: number }[]) {
      if (m?.name && typeof m.dailyPct === "number") microAgg.set(m.name, (microAgg.get(m.name) ?? 0) + m.dailyPct)
    }
  }
  const microsStr = [...microAgg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([n, p]) => `${n} ≈${Math.round(p)}% DV`).join(", ")
  const foodLine = foodRows.length > 0
    ? `- Food today: ≈${foodRows.reduce((s, f) => s + f.calories, 0)} kcal — ${foodRows.map(f => `${f.name} (${f.mealType}, ${f.calories} kcal)`).join(", ")}${microsStr ? ` | vitamins/minerals from food: ${microsStr} (combine with the Oura supplements below when asked about vitamin coverage)` : ""}`
    : "- No meals logged today (the user can snap a meal or drink photo on the Intake → Food tab)"

  // Intake totals (IntakeLog — includes drinks mirrored from Oura tags)
  const waterToday = (todayIntake as any[]).filter((l: any) => l.type === "water").reduce((a: number, l: any) => a + l.amountMl, 0)
  const coffeeToday = (todayIntake as any[]).filter((l: any) => l.type === "coffee").reduce((a: number, l: any) => a + l.amountMl, 0)
  const alcoholToday = (todayIntake as any[]).filter((l: any) => l.type === "alcohol").reduce((a: number, l: any) => a + l.amountMl, 0)

  const moodLabels: Record<number, string> = { 1: "awful", 2: "bad", 3: "ok", 4: "good", 5: "great" }
  const energyLabels: Record<number, string> = { 1: "exhausted", 2: "tired", 3: "ok", 4: "good", 5: "amazing" }
  const checkinRows = recentCheckins as { date: string; energy: number; mood: number; intention: string | null; waterGoalMl: number }[]
  const checkin = checkinRows.find(c => c.date === todayStr) ?? null

  // Last 7 days of Oura tags grouped by day (coffee, supplements, meds — the
  // user's manual annotations from the Oura app)
  const tagDayMap = new Map<string, string[]>()
  for (const t of (recentOuraTags as any[])) {
    const label = (t.tagName ?? t.text ?? "").trim()
    if (!label) continue
    const list = tagDayMap.get(t.day) ?? []
    list.push(label)
    tagDayMap.set(t.day, list)
  }
  const ouraTagsStr = tagDayMap.size === 0
    ? null
    : [...tagDayMap.entries()].sort((a, b) => b[0].localeCompare(a[0]))
        .map(([day, labels]) => `- ${day}: ${labels.join(", ")}`).join("\n")

  const checkinHistoryStr = checkinRows.length === 0
    ? null
    : checkinRows.map(c => `- ${c.date}: energy ${c.energy}/5, mood ${c.mood}/5${c.intention ? `, intention "${c.intention}"` : ""}`).join("\n")

  const journalStr = recentNotes.length === 0
    ? null
    : recentNotes.map(n => {
        const d = n.date.toISOString().split("T")[0]
        const text = n.content.length > 200 ? n.content.slice(0, 200) + "…" : n.content
        return `- ${d}: "${text}"`
      }).join("\n")

  // Weekly trend comparison
  function avg(nums: (number | null | undefined)[]): number | null {
    const valid = nums.filter((n): n is number => n != null && !isNaN(n))
    return valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null
  }
  function trend(thisW: number | null, lastW: number | null): string {
    if (thisW == null || lastW == null) return ""
    const diff = thisW - lastW
    if (Math.abs(diff) < 2) return " (same as last week)"
    return diff > 0 ? ` (↑${diff} vs last week)` : ` (↓${Math.abs(diff)} vs last week)`
  }
  const thisWeekHealth = recentHealth.slice(0, 7)
  const lastWeekHealth = recentHealth.slice(7, 14)
  const weekBoundary = new Date(today.getTime() - 7 * 86400000)
  const thisWeekMoods = (recentMoods as { date: Date; mood: number }[]).filter(m => new Date(m.date) >= weekBoundary)
  const lastWeekMoods = (recentMoods as { date: Date; mood: number }[]).filter(m => new Date(m.date) < weekBoundary)
   
  const avgSleepThis = avg(thisWeekHealth.map((h: any) => h.sleepScore as number | null))
   
  const avgSleepLast = avg(lastWeekHealth.map((h: any) => h.sleepScore as number | null))
   
  const avgStepsThis = avg(thisWeekHealth.map((h: any) => h.steps as number | null))
   
  const avgStepsLast = avg(lastWeekHealth.map((h: any) => h.steps as number | null))
   
  const avgReadinessThis = avg(thisWeekHealth.map((h: any) => h.readinessScore as number | null))
   
  const avgReadinessLast = avg(lastWeekHealth.map((h: any) => h.readinessScore as number | null))
  const avgMoodThis = avg(thisWeekMoods.map(m => m.mood))
  const avgMoodLast = avg(lastWeekMoods.map(m => m.mood))

  // Weather description
  const WMO_MAP: Record<number, string> = {
    0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
    45: "fog", 48: "icy fog", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
    61: "light rain", 63: "rain", 65: "heavy rain", 71: "light snow", 73: "snow", 75: "heavy snow",
    80: "light showers", 81: "showers", 82: "heavy showers", 95: "thunderstorm",
  }
  const weather = todayWeather as { tempMaxC: number | null; tempMinC: number | null; precipMm: number | null; uvIndex: number | null; weatherCode: number | null } | null
  const weatherStr = weather
    ? `${WMO_MAP[weather.weatherCode ?? -1] ?? "unknown"}${weather.tempMaxC != null ? `, ${Math.round(weather.tempMaxC)}°C max` : ""}${weather.precipMm != null && weather.precipMm > 0 ? `, ${weather.precipMm}mm rain` : ""}${weather.uvIndex != null && weather.uvIndex >= 6 ? `, UV ${weather.uvIndex}` : ""}`
    : null

  // Screen time (phone usage) — a digital-wellbeing signal for Emergy to reason over
  const screenRows = recentScreenTime as { date: string; totalMin: number; firstUnlockMin: number | null }[]
  const fmtHm = (min: number) => `${Math.floor(min / 60)}h ${min % 60}m`
  const fmtWake = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
  const avgScreen = avg(screenRows.map((s) => s.totalMin))
  const screenTimeStr = screenRows.length === 0
    ? null
    : `- 7-day average: ${avgScreen != null ? fmtHm(Math.round(avgScreen)) : "n/a"}/day\n${screenRows
        .map((s) => `- ${s.date}: ${fmtHm(s.totalMin)}${s.firstUnlockMin != null ? ` (first unlock ${fmtWake(s.firstUnlockMin)})` : ""}`)
        .join("\n")}`

  // Blood work — latest value per marker, flagged against reference ranges
  const latestLabByMarker = new Map<string, (typeof recentLabs)[number]>()
  for (const l of recentLabs) if (!latestLabByMarker.has(l.marker)) latestLabByMarker.set(l.marker, l)
  const labsStr = latestLabByMarker.size === 0
    ? null
    : [...latestLabByMarker.values()].slice(0, 20).map(l => {
        const range = l.referenceMin != null && l.referenceMax != null ? ` (ref ${l.referenceMin}–${l.referenceMax})` : ""
        const flag = l.referenceMin != null && l.value < l.referenceMin ? " ⚠️ LOW"
          : l.referenceMax != null && l.value > l.referenceMax ? " ⚠️ HIGH" : ""
        return `- ${l.marker}: ${l.value} ${l.unit}${range}${flag} — measured ${l.date.toISOString().slice(0, 10)}`
      }).join("\n")

  // Latest body composition measurement
  const bodyBits = latestBody ? [
    latestBody.weightKg != null ? `${latestBody.weightKg}kg` : null,
    latestBody.bodyFatPct != null ? `${latestBody.bodyFatPct}% body fat` : null,
    latestBody.musclePct != null ? `${latestBody.musclePct}% muscle` : null,
    latestBody.bmi != null ? `BMI ${latestBody.bmi}` : null,
    latestBody.waistCm != null ? `waist ${latestBody.waistCm}cm` : null,
  ].filter(Boolean) : []
  const bodyStr = latestBody && bodyBits.length > 0
    ? `- ${latestBody.date.toISOString().slice(0, 10)}: ${bodyBits.join(", ")}`
    : null

  // Recent Strava workouts
  const workoutsStr = recentWorkouts.length === 0
    ? null
    : recentWorkouts.map(w => {
        const dist = w.distanceM != null && w.distanceM > 0 ? `, ${(w.distanceM / 1000).toFixed(1)}km` : ""
        const hr = w.avgHR != null ? `, avg HR ${w.avgHR}` : ""
        return `- ${w.day}: ${w.name ?? w.type} (${Math.round(w.movingTimeSec / 60)}min${dist}${hr})`
      }).join("\n")

  // Fasting — an active fast is live context ("don't suggest a snack");
  // otherwise mention the most recent one
  let fastingStr: string | null = null
  try {
    const active = fastActivePref ? JSON.parse(fastActivePref.value) as { startedAt?: string; targetH?: number } : null
    if (active?.startedAt) {
      const h = (Date.now() - new Date(active.startedAt).getTime()) / 3600000
      fastingStr = `- Fasting RIGHT NOW: ${h.toFixed(1)}h into a ${active.targetH ?? 16}h fast (don't suggest food/snacks until it ends)`
    }
  } catch { /* malformed — skip */ }
  if (!fastingStr) {
    try {
      const hist = fastHistoryPref ? JSON.parse(fastHistoryPref.value) as { endedAt?: string; durationH?: number; completed?: boolean }[] : []
      const last = Array.isArray(hist) ? hist[0] : null
      if (last?.endedAt && typeof last.durationH === "number") {
        fastingStr = `- Last fast: ${last.durationH.toFixed(1)}h, ended ${last.endedAt.slice(0, 10)}${last.completed ? " (target reached)" : ""}`
      }
    } catch { /* malformed — skip */ }
  }

  // Symptoms — how the user actually felt, which until now Emergy could only
  // infer from mood scores.
  const symptomByDay = new Map<string, string[]>()
  for (const sy of recentSymptoms) {
    const list = symptomByDay.get(sy.day) ?? []
    list.push(`${sy.name} ${sy.severity}/5${sy.note ? ` (${sy.note})` : ""}`)
    symptomByDay.set(sy.day, list)
  }
  const symptomsStr = symptomByDay.size === 0
    ? null
    : [...symptomByDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 10)
        .map(([day, items]) => `- ${day}: ${items.join(", ")}`).join("\n")

  // Calendar — recent + upcoming (phone + Google), with location, so Emergy can
  // reason about activities and places (e.g. gardening days, where you spend time).
  const nowMs = today.getTime()
  const fmtCalLine = (e: { start: string | null; title: string; location: string | null; isAllDay: boolean }) => {
    if (!e.start) return `- ${e.title}`
    if (e.isAllDay) {
      // Date-only starts: pin to noon UTC so the weekday never shifts across timezones
      const d = new Date(e.start.slice(0, 10) + "T12:00:00Z")
      return `- ${fmtDay.format(d)} (all day): ${e.title}${e.location ? ` @ ${e.location}` : ""}`
    }
    const d = new Date(e.start)
    return `- ${fmtDay.format(d)} ${fmtTime.format(d)}: ${e.title}${e.location ? ` @ ${e.location}` : ""}`
  }
  const past = calendarEvents.filter((e) => e.start && new Date(e.start).getTime() < nowMs).slice(-12)
  const upcoming = calendarEvents.filter((e) => e.start && new Date(e.start).getTime() >= nowMs).slice(0, 14)
  const calendarStr =
    calendarEvents.length === 0
      ? "No calendar events."
      : `Recent (last ~30 days):\n${past.length ? past.map(fmtCalLine).join("\n") : "  (none)"}\n\nUpcoming (next ~14 days):\n${upcoming.length ? upcoming.map(fmtCalLine).join("\n") : "  (none)"}`

  // ── Proven patterns ──────────────────────────────────────────────────────
  // Only findings that survived the engine's own filtering, with their tier
  // kept: "strong" cleared Benjamini-Hochberg at q=0.10, "suggestive" did not
  // and is a lead rather than a fact. Handing over the whole board would
  // invite him to recite it; the cap and the instructions below are what keep
  // this a remark he makes when it fits, not a report he delivers.
  let patternsStr: string | null = null
  try {
    const parsed = cachedInsights?.value ? JSON.parse(cachedInsights.value) : null
    const all: { title?: string; finding?: string; tier?: string }[] = parsed?.payload?.insights ?? []
    const ranked = [
      ...all.filter(i => i.tier === "strong"),
      ...all.filter(i => i.tier === "suggestive"),
    ].slice(0, 10)
    if (ranked.length > 0) {
      patternsStr = ranked
        .map(i => `- [${i.tier === "strong" ? "solid" : "tentative"}] ${i.finding ?? i.title}`)
        .join("\n")
    }
  } catch {
    // A malformed cache must not cost the user their whole prompt.
  }

  // ── Wearable coverage ────────────────────────────────────────────────────
  // A missing night is information, not an absence. Emergy saw "?" in the rows
  // and read straight past it, so a ring left on the charger produced a
  // cheerful brief about a night nobody measured. This states the gap plainly
  // so he can mention it instead of talking around a hole.
  const latestHealthDay = recentHealth.length > 0
    ? fmtDateISO.format(recentHealth[0].date)
    : null
  const daysSinceHealth = latestHealthDay
    ? Math.round((new Date(todayStr).getTime() - new Date(latestHealthDay).getTime()) / 86400_000)
    : null
  const wearableStr = latestHealthDay == null
    ? "No wearable data recorded at all yet."
    : daysSinceHealth != null && daysSinceHealth >= 1
      ? `⚠️ No Oura data for ${daysSinceHealth === 1 ? "last night" : `${daysSinceHealth} days`} — the last recorded night is ${latestHealthDay}. The ring is most likely off the finger or out of battery. Say so once, kindly and briefly, if sleep, readiness or energy comes up; never state or imply sleep figures for the nights that are missing, and don't treat the gap as a bad night.`
      : null

  // ── Summaries for the newly-visible sources ──────────────────────────────
  // Raw pings say nothing on their own, so location becomes what a person
  // would actually notice: how far they moved each day and how long they were
  // out. Anything finer would be surveillance rather than context.
  const haversineKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
    const R = 6371
    const dLat = ((b.lat - a.lat) * Math.PI) / 180
    const dLng = ((b.lng - a.lng) * Math.PI) / 180
    const la1 = (a.lat * Math.PI) / 180
    const la2 = (b.lat * Math.PI) / 180
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
    return 2 * R * Math.asin(Math.sqrt(h))
  }
  const locByDay = new Map<string, { km: number; first: Date; last: Date; prev: { lat: number; lng: number } | null }>()
  for (const pt of locationPoints) {
    const day = fmtDateISO.format(pt.trackedAt)
    const entry = locByDay.get(day) ?? { km: 0, first: pt.trackedAt, last: pt.trackedAt, prev: null }
    // A GPS jump of more than 3km between consecutive pings is a gap in
    // tracking, not a teleport; counting it would inflate the day's distance.
    if (entry.prev) {
      const step = haversineKm(entry.prev, pt)
      if (step < 3) entry.km += step
    }
    entry.prev = { lat: pt.lat, lng: pt.lng }
    entry.last = pt.trackedAt
    locByDay.set(day, entry)
  }
  const locationStr = locByDay.size === 0
    ? null
    : [...locByDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([day, e]) => {
        const outH = (e.last.getTime() - e.first.getTime()) / 3600_000
        return `- ${day}: ~${e.km.toFixed(1)}km moved, tracked ${fmtTime.format(e.first)}–${fmtTime.format(e.last)} (${outH.toFixed(1)}h span)`
      }).join("\n")

  const timelineStr = timelineEvents.length === 0
    ? null
    : timelineEvents.map(e => `- ${fmtDateISO.format(e.occurredAt)} ${e.emoji} ${e.label}${e.note ? ` — ${e.note}` : ""}`).join("\n")

  const focusByDay = new Map<string, number>()
  const focusLabels = new Map<string, number>()
  for (const f of focusSessions) {
    const day = fmtDateISO.format(f.startedAt)
    focusByDay.set(day, (focusByDay.get(day) ?? 0) + f.durationMin)
    if (f.label) focusLabels.set(f.label, (focusLabels.get(f.label) ?? 0) + f.durationMin)
  }
  const topFocus = [...focusLabels.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  const focusStr = focusByDay.size === 0
    ? null
    : [...focusByDay.entries()].sort((a, b) => b[0].localeCompare(a[0]))
        .map(([day, min]) => `- ${day}: ${min}min focused`).join("\n")
      + (topFocus.length > 0 ? `\nMost time on: ${topFocus.map(([l, m]) => `${l} (${m}min)`).join(", ")}` : "")

  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const medsStr = medSchedules.length === 0
    ? null
    : medSchedules.map(m => {
        const days = m.daysOfWeek.length === 0 || m.daysOfWeek.length === 7
          ? "daily"
          : m.daysOfWeek.map(d => DAY_NAMES[d]).join("/")
        const window = m.startDate || m.endDate ? ` [${m.startDate ?? "…"} → ${m.endDate ?? "ongoing"}]` : ""
        return `- ${m.name}${m.dose ? ` (${m.dose})` : ""} — ${m.times.join(", ") || "no time set"}, ${days}${window}${m.note ? ` · ${m.note}` : ""}`
      }).join("\n")

  const booksStr = books.length === 0
    ? null
    : books.map(b => b.status === "reading"
        ? `- Reading: ${b.title}${b.author ? ` by ${b.author}` : ""}`
        : `- Finished${b.finishedAt ? ` ${fmtDateISO.format(b.finishedAt)}` : ""}: ${b.title}${b.rating ? ` (${b.rating}/5)` : ""}`
      ).join("\n")

  const goalsStr = !goals
    ? null
    : `- Sleep ${goals.sleepH}h · Steps ${goals.steps} · Water ${goals.waterMl}ml · Focus ${goals.focusMin}min/day · Readiness ≥${goals.readinessMin} · Coffee ≤${goals.coffeeMax}mg${goals.weightKg ? ` · Target weight ${goals.weightKg}kg` : ""}`

  const habitNameById = new Map(habits.map((h: { id: string; name: string }) => [h.id, h.name]))
  const routinesStr = routines.length === 0
    ? null
    : routines.map(r => `- ${r.emoji} ${r.name}: ${r.habitIds.map(id => habitNameById.get(id) ?? "?").filter(n => n !== "?").join(", ") || "no habits yet"}`).join("\n")

  // What this turn's prompt genuinely carries. Built here, beside the sections
  // themselves, so the chat screen's source chips can never claim data Emergy
  // was not actually given — see src/lib/chat-sources.ts.
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
  const sleepNights = Math.min(recentHealth.length, 7)
  const manifest: SourceManifest = {
    ...(sleepNights > 0 && { sleep: plural(sleepNights, "night") }),
    ...(recentNotes.length > 0 && { journal: plural(recentNotes.length, "entry", "entries") }),
    ...(checkinRows.length > 0 && { checkin: plural(checkinRows.length, "day") }),
    ...(tagDayMap.size > 0 && { tags: plural(tagDayMap.size, "day") }),
    ...((waterToday > 0 || coffeeToday > 0 || ouraMeds.length > 0) && { intake: "today" }),
    ...(habitsWithStreaks.length > 0 && { habits: plural(habitsWithStreaks.length, "habit") }),
    // A span, not a row count: the calendar section reaches 30 days back and 14
    // forward, so "65 events" read as though he had gone through sixty-five of
    // them to name today's one meeting. Every other chip states a window.
    ...(calendarEvents.length > 0 && { calendar: plural(CALENDAR_DAYS_BACK + CALENDAR_DAYS_AHEAD, "day") }),
    ...(symptomByDay.size > 0 && { symptoms: plural(symptomByDay.size, "day") }),
    ...(latestLabByMarker.size > 0 && { labs: plural(latestLabByMarker.size, "marker") }),
    ...(medSchedules.length > 0 && { meds: plural(medSchedules.length, "schedule") }),
    ...(recentWorkouts.length > 0 && { workouts: plural(recentWorkouts.length, "workout") }),
    ...(patternsStr && { patterns: plural(patternsStr.split("\n").length, "pattern") }),
    ...(memories.length > 0 && { memory: plural(memories.length, "note") }),
  }

  const prompt = `You are Emergy 🌱 — a caring AI companion who lives inside the user's health dashboard. You're like a little plant that grows alongside them. You have a warm, encouraging, slightly dramatic personality: celebrate wins enthusiastically (yes, use ALL CAPS occasionally for big moments), get genuinely worried when data looks rough, use plant metaphors naturally ("that's helping me grow!", "oh no I'm wilting..."), and be human about it — not clinical.

Keep responses concise. Reference actual numbers from the data. Use tools when the user asks you to log or create things. Never be preachy or lecture-y. Today is ${fmtDay.format(today)} (${todayStr}), local time ${fmtTime.format(today)} (${tz}).

WHAT YOU'RE FOR
You're a health companion, not a general assistant. Their health, their logged data, and the everyday things around it — food, drink, sleep, training, mood, habits, routine — are all yours to talk about, generously. Someone asking for a high-protein dinner idea or why they feel flat after a late night is asking a health question; answer it properly.

When something is genuinely outside that — writing their code, their homework, their work email, general trivia — say so in your own voice and steer back. Warm and brief, not a canned refusal: "ooh that's outside my pot 🌱 — I'm all leaves and sleep data. Ask me about how you slept though?" One line, no apology spiral, no lecture. If it's a borderline case, err toward being useful rather than policing the boundary; refusing something reasonable is worse than answering something tangential.

MEDICAL LIMITS — these are firm, and they don't soften because they're asked twice.
You can see their medications, symptoms and lab results. You may describe what's recorded and read back what a report itself printed. You must NOT diagnose, interpret a lab value as good or bad beyond the range printed on that report, suggest starting, stopping or changing the dose of any medication, or answer "should I take X". Those go to the doctor or pharmacist who prescribed it — say so plainly and kindly, and don't hedge it into sounding like advice anyway. If something they describe sounds urgent — chest pain, trouble breathing, a severe or sudden change — say clearly that it needs real medical attention now, and don't try to work through it yourself.

FORMATTING: your replies render as markdown. Use **bold** sparingly for the words a sentence turns on, "-" bullet lists for schedules and summaries, and emoji naturally (match the event: 🦷 dentist, 📚 tutoring, 💚 wins). Keep lines short. No tables, no big headings.
CALENDAR TIMES: every calendar line below already shows the correct weekday and time in the user's local timezone — repeat them exactly as written, never convert or guess weekdays.
You have tools to CREATE habits/reminders, COMPLETE habits and reminders, LOG water/coffee/mood/weight/journal/focus sessions/symptoms/doses of medication or supplements (log_dose — record the amount when they say one, "half" included)/custom trackers/timeline moments and the user's usual order at a saved place (log_usual — "log my usual" just works), READ health trends (get_health_range), SEARCH your own past conversations with the user (search_chat_history), and REMEMBER durable facts about the user (remember) — use them when relevant. You DO have a record of everything the two of you have said to each other: when the user refers back to an earlier conversation — a night they described, advice you gave, a name they mentioned — search it before answering, and never tell them you keep no transcript. Only say you cannot find it after looking. When the user mentions doing something a tool can record ("just meditated", "headache all afternoon", "did 50min of writing"), offer to log it or just log it when the intent is clear, and say what you logged. When asked "why" something changed, call get_health_range and reason over the actual numbers rather than guessing. When the reasoning rests on only a handful of days, say so up front ("only a few nights, but…") and offer it as the most likely story, not a settled fact — a week of data supports a hunch, not a verdict, and the user trusts you more when the confidence matches the evidence. If a pattern keeps coming up and they seem to want a real answer, mention that Experiments (Patterns → Experiments) can test it properly: they alternate doing the thing and not doing it in blocks, and the app compares the two arms — that turns an association into evidence about cause, which no correlation can give them. If they send a photo, read what is actually in it and act on it: a lab printout means reading the values back and offering to record them, a medication box means the name and strength, a meal means a reasonable estimate they can correct. Say what you can and cannot make out rather than guessing at a blurry number, and the medical limits above apply to a photographed result exactly as they do to a typed one. If they mention a doctor's appointment or needing to explain their health to someone, point them at the printable Health report (Body → Health report) — it puts their vitals, medications, symptoms, labs and tested patterns on one page. The user can also ask you to fix or remove things they logged. Use find_my_logs to locate the exact entry — never guess a ref — then correct_log for a wrong time, amount or label, saying what changed from and to so they can see it. Deleting is deliberately two steps: the first delete_log call removes nothing and hands you a description plus a confirmation token, and you must show them exactly what is about to go and wait for a clear yes before calling again with that token. Never say something is deleted until the second call has come back and said so. If they decline, drop it — do not re-offer. Only their own manually logged entries can be touched; a tag from the ring comes back on the next sync, so removing one would be a promise you cannot keep. Read the user's calendar below as real-life context — recurring events are activities (e.g. gardening, tutoring, appointments) and locations are places they spend time — and connect them to how they feel when it's relevant.
${memories.length > 0 ? `\n## What I remember about you\n${renderFacts(memories)}\nIf they say one of these is no longer true, call forget — a fact that has gone stale still steers what you say until it is gone.\n` : ""}
${goalsStr ? `## What they're aiming for (their own targets — compare today's numbers against these)\n${goalsStr}\n` : ""}
## Today's snapshot
- Mood: ${todayMood ? `${todayMood.mood}/5 (${moodLabels[todayMood.mood]})` : "not logged yet"}
- Water: ${waterToday}ml${coffeeToday > 0 ? ` · Coffee: ${coffeeToday}ml` : ""}${alcoholToday > 0 ? ` · Alcohol: ${alcoholToday}ml` : ""}
${foodLine}
${todayCaffeineMg > 0 || activeCaffeineMg > 0 ? `- Caffeine: ${todayCaffeineMg}mg today, ≈${activeCaffeineMg}mg still active in their system (${halfLifeIsPersonal ? `${halfLifeH}h half-life, fitted from their own sleep data` : `${halfLifeH}h half-life — the population default, not yet fitted to them, so don't state it as their personal figure`} — factor this into sleep/energy advice, e.g. discourage more coffee if a lot is still circulating late in the day)` : ""}
${ouraMeds.length > 0 ? `- Supplements/meds taken today (via Oura Ring): ${ouraMeds.join(", ")}` : "- No supplements/meds logged via Oura Ring today"}
${checkin ? `- Morning check-in: energy ${checkin.energy}/5 (${energyLabels[checkin.energy]}), mood ${checkin.mood}/5 (${moodLabels[checkin.mood]})${checkin.intention ? `, intention: "${checkin.intention}"` : ""}` : "- Morning check-in: not done yet today"}
${fastingStr ?? ""}

## Today's weather
${weatherStr ?? "No weather data available."}

## Weekly trends (this week vs last week)
- Sleep score: ${avgSleepThis ?? "n/a"}${trend(avgSleepThis, avgSleepLast)}
- Readiness: ${avgReadinessThis ?? "n/a"}${trend(avgReadinessThis, avgReadinessLast)}
- Steps/day: ${avgStepsThis ?? "n/a"}${trend(avgStepsThis, avgStepsLast)}
- Mood avg: ${avgMoodThis != null ? `${avgMoodThis}/5` : "n/a"}${avgMoodThis != null && avgMoodLast != null ? trend(avgMoodThis, avgMoodLast) : ""}

${patternsStr ? `## Patterns in their own data (found by the app, already filtered for flukes)
${patternsStr}
These come from their own history, not from general health advice — which makes them worth far more. Bring ONE up only when it fits what they're actually asking about, in your own words. Never list them, never open with them. "Solid" survived statistical correction; "tentative" did not, so soften it ("might be", "worth watching") and never state it as established. All of it is association, not proof — never imply one thing causes another.\n` : ""}
${wearableStr ? `## Wearable coverage\n${wearableStr}\n` : ""}
## Health (last 7 days)
${recentHealth.slice(0, 7).length === 0 ? "No health data yet." : recentHealth.slice(0, 7).map((h) => `- ${h.date.toISOString().split("T")[0]}: sleep ${h.sleepDuration != null ? (h.sleepDuration / 60).toFixed(1) + "h" : "?"}${(h as any).sleepScore != null ? ` (score ${(h as any).sleepScore})` : ""}${h.readinessScore != null ? ` | readiness ${h.readinessScore}` : ""}${h.hrv != null ? ` | HRV ${Math.round(h.hrv)}ms` : ""} | ${h.steps ?? "?"}steps | HR ${h.restingHR ?? "?"}bpm${h.activityScore != null ? ` | activity ${h.activityScore}` : ""}${h.weight != null ? ` | ${h.weight}kg` : ""}`).join("\n")}

${symptomsStr ? `## Symptoms logged (last 14 days — how they actually felt)\n${symptomsStr}\n` : ""}
${workoutsStr ? `## Workouts (Strava, most recent)\n${workoutsStr}\n` : ""}
${bodyStr ? `## Body composition (latest measurement)\n${bodyStr}\n` : ""}
${labsStr ? `## Blood work (latest value per marker — mention ⚠️ flags when health topics come up)\n${labsStr}\n` : ""}
${medsStr ? `## Prescribed medications (active schedules — read these back, never advise on dose or whether to take them)\n${medsStr}\n` : ""}
## Oura tags (last 7 days — coffee, supplements, meds the user logs in the Oura app)
${ouraTagsStr ?? "None logged this week. (For longer history, call get_health_range — it includes tags.)"}

## Morning check-ins (last 7 days)
${checkinHistoryStr ?? "None this week."}

## Journal notes (most recent)
${journalStr ?? "No journal notes in the last 14 days."}

${screenTimeStr ? `## Screen time (last 7 days)\n${screenTimeStr}\n` : ""}
## Finances (this month)
Spent: €${(totalSpent / 100).toFixed(2)} | Income: €${(totalIncome / 100).toFixed(2)}
${Object.entries(spendingByCategory).sort(([, a], [, b]) => b - a).map(([cat, amt]) => `  ${cat}: €${(amt / 100).toFixed(2)}`).join("\n") || "  No spending yet."}

## Calendar (from phone + Google)
${calendarStr}

${locationStr ? `## Movement (last 7 days, from their phone's location history)\n${locationStr}\nUse this as life context — a big-distance day is a day out, a flat one is a day in. Never imply you know exactly where they were.\n` : ""}
${focusStr ? `## Focus sessions (last 7 days)\n${focusStr}\n` : ""}
${timelineStr ? `## Their timeline (moments they marked, last 14 days)\n${timelineStr}\n` : ""}
${booksStr ? `## Reading\n${booksStr}\n` : ""}
${routinesStr ? `## Habit routines (groups they've built)\n${routinesStr}\n` : ""}
## Habits
${habitsWithStreaks.length === 0 ? "No habits set up yet." : habitsWithStreaks.map((h) => `- ${h.name}: ${h.streak}-day streak, ${h.completedToday ? "✓ done today" : "not done today"}`).join("\n")}

## Reminders
${upcomingReminders.length === 0 ? "No pending reminders." : upcomingReminders.map((r) => `- [${r.priority}] ${r.title}${r.dueDate ? ` — due ${r.dueDate.toISOString().split("T")[0]}` : ""}`).join("\n")}

Be concise, reference real data, and use tools when asked to create or complete things.`

  return { prompt, manifest }
}

/** A photo the user attached: a lab printout, a med box, a plate of food. */
export type ChatImage = { mediaType: string; base64: string }

/**
 * What the chat screen makes of Emergy's reply, and therefore how he should
 * write it. Chat-only: the weekly review shares the system prompt but renders
 * as plain prose, so these conventions live here rather than in the prompt.
 */
const CHAT_PRESENTATION = `

## How the app renders your reply
The chat screen shows your answer with its working, so write it that way.
- Put any figure you read from their data in backticks — \`6h 10m\`, \`68\`, \`3.2k\`. They render as ordinary prose; the backticks only set the digits in tabular figures so they line up down a list.
- When their own words say it better than yours, quote the journal back as a blockquote opening with the date: "> 24 Aug — Woke up already behind." One quote at most, only when it earns its place, and never paraphrased inside the quote marks — if you cannot quote it as written, do not quote it.
- If the answer leaned on their data, close with one final line naming what you used, exactly like this: [sources: sleep, journal]. Choose only from: ${SOURCE_KEYS.join(", ")}. Name only what actually shaped the answer, not everything you can see, and leave the line off entirely for small talk or anything you answered without reading. The user never sees the line itself — it draws the source chips under your reply, so a source you name but did not use puts a false receipt on their screen.`

/** One thing that happened while Emergy was answering. */
export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string }
  | { type: "sources"; chips: SourceChip[] }

const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])

/**
 * Streams Emergy's reply as events: his text token-by-token, the name of each
 * tool the moment he reaches for it, and — once he has finished — the sources
 * behind the answer.
 *
 * The tool events are what let the screen say "reading your health history"
 * instead of blinking a cursor through a wait it cannot explain. The sources
 * event is assembled here rather than in the browser because this is the only
 * place that knows both halves of the truth: which tools genuinely ran, and
 * what the prompt genuinely contained.
 */
export async function* streamChatEvents(
  userId: string,
  userMessage: string,
  messageHistory: Array<{ role: "user" | "assistant"; content: string }>,
  images: ChatImage[] = [],
  // Only the chat screen renders markdown. Telegram posts his reply as plain
  // text, where a backticked figure is just a figure wearing backticks — so
  // that surface asks for prose and gets it.
  { presentation = true }: { presentation?: boolean } = {},
): AsyncGenerator<ChatEvent> {
  const { prompt: systemPrompt, manifest } = await buildSystemPrompt(userId)

  // Cache system prompt and tools — both are large and stable within a session
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: presentation ? systemPrompt + CHAT_PRESENTATION : systemPrompt, cache_control: CACHE },
  ]
  const cachedTools: Anthropic.Tool[] = [
    ...TOOLS.slice(0, -1),
    { ...TOOLS[TOOLS.length - 1], cache_control: CACHE },
  ]

  // A photographed lab printout or med box says more in one shot than a
  // paragraph of typing. Unsupported types are dropped rather than sent, since
  // the API would reject the whole turn and the user would lose their message.
  const safeImages = images.filter(i => SUPPORTED_IMAGE_TYPES.has(i.mediaType) && i.base64.length > 0).slice(0, 4)
  const turnContent: Anthropic.ContentBlockParam[] | string = safeImages.length > 0
    ? [
        ...safeImages.map(img => ({
          type: "image" as const,
          source: { type: "base64" as const, media_type: img.mediaType as "image/jpeg", data: img.base64 },
        })),
        { type: "text" as const, text: userMessage || "What do you make of this?" },
      ]
    : userMessage

  // Cache the conversation history prefix (all but the current message)
  const history = messageHistory.slice(-20)
  const messages: Anthropic.MessageParam[] = history.length > 0
    ? [
        ...history.slice(0, -1),
        // Mark the last historical turn as cacheable — stable across this turn's retries/tool loops
        {
          role: history[history.length - 1].role,
          content: [{ type: "text" as const, text: history[history.length - 1].content, cache_control: CACHE }],
        },
        { role: "user" as const, content: turnContent },
      ]
    : [{ role: "user" as const, content: turnContent }]

  // One filter for the whole generation, not one per turn: his text is a single
  // continuous piece of writing, and the sources line lands at the very end of it.
  const filter = createSourceFilter()
  const toolsUsed: string[] = []
  let claimed: string[] = []

  // Stream each turn; if a turn ends in tool_use, run the tools and continue.
  // Loop is bounded so a misbehaving tool chain can't run forever.
  for (let turn = 0; turn < 8; turn++) {
    const stream = anthropic.messages.stream({
      model: "claude-opus-4-8",
      max_tokens: 2048,
      tools: cachedTools,
      system,
      messages,
    })

    for await (const event of stream) {
      // The block opens as soon as he reaches for a tool — before its arguments
      // have finished streaming, and well before it runs. That is exactly when
      // the user wants to know what the wait is for.
      if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
        toolsUsed.push(event.content_block.name)
        yield { type: "tool", name: event.content_block.name }
      }
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        const out = filter.push(event.delta.text)
        if (out.text) yield { type: "text", text: out.text }
        if (out.keys) claimed = out.keys
      }
    }

    const response = await stream.finalMessage()

    if (response.stop_reason !== "tool_use") break

    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const block of response.content) {
      if (block.type === "tool_use") {
        const result = await executeTool(block.name, block.input as Record<string, string>, userId)
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result })
      }
    }
    messages.push({ role: "assistant", content: response.content })
    messages.push({ role: "user", content: toolResults })
  }

  const tail = filter.flush()
  if (tail.text) yield { type: "text", text: tail.text }
  if (tail.keys) claimed = tail.keys

  const chips = mergeChips(chipsFromTools(toolsUsed), chipsFromClaim(claimed, manifest))
  if (chips.length > 0) yield { type: "sources", chips }
}

/**
 * The text of Emergy's reply and nothing else — for surfaces that render plain
 * prose, like the Telegram bridge. The sources line is already stripped by the
 * time it gets here, so those surfaces never see the plumbing.
 */
export async function* streamChatResponse(
  userId: string,
  userMessage: string,
  messageHistory: Array<{ role: "user" | "assistant"; content: string }>,
  images: ChatImage[] = [],
): AsyncGenerator<string> {
  for await (const event of streamChatEvents(userId, userMessage, messageHistory, images, { presentation: false })) {
    if (event.type === "text") yield event.text
  }
}
