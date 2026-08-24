// Read a lab report — a photo of the printout or the PDF the lab emailed —
// and turn it into rows.
//
// This is a *transcription* tool and nothing else. The model is told to copy
// what is printed and to leave blank anything it can't read, rather than to
// interpret, diagnose, or fill in a reference range from general knowledge: a
// reference range differs between labs and assays, so a plausible-looking
// invented one is worse than none at all. Nothing is written to the record
// until the user has seen every row next to the document and confirmed it.

import Anthropic from "@anthropic-ai/sdk"
import { canonicalMarker } from "@/lib/lab-markers"

const anthropic = new Anthropic()

export interface ParsedLabRow {
  marker: string
  /** Exactly as printed, before canonicalisation — shown so the user can check. */
  rawMarker: string
  value: number
  unit: string
  referenceMin: number | null
  referenceMax: number | null
  /** The lab's own out-of-range mark, when the report carries one. */
  flag: "low" | "high" | "normal" | null
}

export interface ParsedLabReport {
  isLabReport: boolean
  /** YYYY-MM-DD of the sample or the report, when printed. */
  date: string | null
  lab: string | null
  results: ParsedLabRow[]
  /** Rows the model could see but couldn't read confidently. */
  unreadable: string[]
  note: string | null
}

const ROW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["marker", "value", "unit", "referenceMin", "referenceMax", "flag"],
  properties: {
    marker: { type: "string", description: "The marker name exactly as printed on the report, in its original language." },
    value: { type: "number", description: "The measured result as a number. Use a decimal point even if the report uses a comma." },
    unit: { type: "string", description: "The unit exactly as printed, e.g. 'mmol/l', 'ng/mL', 'x10^9/l'. Empty string only if the report truly prints none." },
    referenceMin: { type: ["number", "null"], description: "Lower bound of the reference range printed ON THIS REPORT. Null if the report shows no lower bound. Never supply one from your own knowledge." },
    referenceMax: { type: ["number", "null"], description: "Upper bound of the reference range printed ON THIS REPORT. Null if the report shows no upper bound. Never supply one from your own knowledge." },
    // "none" rather than null, and a single declared type rather than a union.
    // The API rejects an enum next to a ["string","null"] type outright — the
    // whole request 400s, so this feature never worked. Every other schema in
    // this codebase spells an absent choice as a sentinel string for the same
    // reason; normalizeReport turns it back into null.
    flag: { type: "string", enum: ["low", "high", "normal", "none"], description: "Only if the report itself marks the row (H, L, ↑, ↓, bold, 'mimo referenčné rozmedzie'). Use \"none\" when the report doesn't mark it — do not decide this yourself." },
  },
} as const

const REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["isLabReport", "date", "lab", "results", "unreadable", "note"],
  properties: {
    isLabReport: { type: "boolean", description: "False when the document is not a laboratory result report." },
    date: { type: ["string", "null"], description: "Sample collection date as YYYY-MM-DD if printed, else the report date, else null. Do not guess from context." },
    lab: { type: ["string", "null"], description: "Name of the laboratory or clinic, if printed." },
    results: { type: "array", description: "Every numeric result row you can read confidently.", items: ROW_SCHEMA },
    unreadable: { type: "array", description: "Names of rows that are visible but too blurred, cropped or ambiguous to transcribe.", items: { type: "string" } },
    note: { type: ["string", "null"], description: "One short factual sentence about the document itself if useful — e.g. 'second page only', 'photo cuts off the reference column'. No medical interpretation." },
  },
} as const

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"])

type Doc =
  | { kind: "image"; mediaType: string; data: string }
  | { kind: "pdf"; data: string }

/** Split a data URL into a document block we can send. */
export function parseDocumentDataUrl(dataUrl: string): Doc | null {
  const m = /^data:([a-z]+\/[a-z0-9+.-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl)
  if (!m) return null
  const mediaType = m[1].toLowerCase()
  if (mediaType === "application/pdf") return { kind: "pdf", data: m[2] }
  if (IMAGE_TYPES.has(mediaType)) return { kind: "image", mediaType, data: m[2] }
  return null
}

const PROMPT =
  "This is a laboratory result report. Transcribe every numeric result you can read.\n\n" +
  "Copy what is printed. Specifically:\n" +
  "- Keep the marker name in its original language and spelling.\n" +
  "- Decimal commas become decimal points; do not otherwise change a number.\n" +
  "- Copy the unit exactly as printed. Never convert between units.\n" +
  "- A reference range comes from this report or it is null. Reference ranges differ between laboratories and assays, so one supplied from general knowledge would be wrong in a way nobody could see.\n" +
  "- Only set a flag if the report itself marks the row as out of range; otherwise the flag is \"none\".\n" +
  "- A row you cannot read confidently belongs in `unreadable`, not in `results` with a guess.\n\n" +
  "Do not interpret the results, do not comment on what they might mean, and do not add rows the document doesn't contain."

/**
 * Returns null when the document can't be served at all (bad data URL,
 * model refusal). Anything readable comes back with the rows it found, which
 * may legitimately be none.
 */
export async function analyzeLabDocument(dataUrl: string): Promise<ParsedLabReport | null> {
  const doc = parseDocumentDataUrl(dataUrl)
  if (!doc) return null

  const block = doc.kind === "pdf"
    ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: doc.data } }
    : { type: "image" as const, source: { type: "base64" as const, media_type: doc.mediaType as "image/jpeg", data: doc.data } }

  const response = await anthropic.messages.create({
    model: "claude-opus-5",
    max_tokens: 8192,
    output_config: {
      // Transcription accuracy is the whole product here; a slower, more
      // careful read beats a fast one the user has to correct row by row.
      effort: "high",
      format: { type: "json_schema", schema: REPORT_SCHEMA },
    },
    messages: [{ role: "user", content: [block, { type: "text", text: PROMPT }] }],
  })

  if (response.stop_reason === "refusal") return null
  const text = response.content.find(b => b.type === "text")?.text
  if (!text) return null

  let parsed: ParsedLabReport
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }

  return normalizeReport(parsed)
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Canonicalise names and drop anything that isn't a usable row. */
export function normalizeReport(parsed: ParsedLabReport): ParsedLabReport {
  const results: ParsedLabRow[] = []
  for (const r of parsed.results ?? []) {
    const rawMarker = String(r.marker ?? "").trim()
    const marker = canonicalMarker(rawMarker)
    if (!marker) continue
    if (typeof r.value !== "number" || !Number.isFinite(r.value)) continue

    // A range the wrong way round is a misread, not a range.
    let min = typeof r.referenceMin === "number" && Number.isFinite(r.referenceMin) ? r.referenceMin : null
    let max = typeof r.referenceMax === "number" && Number.isFinite(r.referenceMax) ? r.referenceMax : null
    if (min != null && max != null && min > max) { const t = min; min = max; max = t }

    results.push({
      marker,
      rawMarker,
      value: r.value,
      unit: String(r.unit ?? "").trim().slice(0, 20),
      referenceMin: min,
      referenceMax: max,
      flag: r.flag === "low" || r.flag === "high" || r.flag === "normal" ? r.flag : null,
    })
  }

  return {
    isLabReport: Boolean(parsed.isLabReport),
    date: typeof parsed.date === "string" && DATE_RE.test(parsed.date) ? parsed.date : null,
    lab: typeof parsed.lab === "string" && parsed.lab.trim() ? parsed.lab.trim().slice(0, 80) : null,
    results,
    unreadable: (parsed.unreadable ?? []).filter(u => typeof u === "string" && u.trim()).slice(0, 20),
    note: typeof parsed.note === "string" && parsed.note.trim() ? parsed.note.trim().slice(0, 200) : null,
  }
}

export const LAB_IMPORT_DISCLAIMER =
  "Values are transcribed from your document, not interpreted. Check every row against the original before saving — and take any question about what a result means to the doctor who ordered it."
