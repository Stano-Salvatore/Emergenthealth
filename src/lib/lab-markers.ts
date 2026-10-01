// Canonical marker names.
//
// A lab report says "Cholesterol celkový", the next one says "Total
// cholesterol", the app's own form says "Cholesterol" — and the trend chart
// that should show three points shows three separate markers with one point
// each. Names are folded onto a canonical form so a series survives changing
// labs and changing languages.
//
// Units are deliberately NOT converted. A Slovak report reports cholesterol in
// mmol/L and an American one in mg/dL; silently rewriting either would put a
// number in the record that appears on no piece of paper the user holds. The
// unit is stored exactly as printed and the UI can point out a mismatch.

import { fold } from "@/lib/supplement-normalize"

/** canonical → every spelling seen in the wild, folded at match time. */
const ALIASES: Record<string, string[]> = {
  "Vitamin D": ["vitamin d", "vitamin d3", "25-oh vitamin d", "25 oh d", "25(oh)d", "vitamin d 25-oh", "calcidiol", "kalcidiol", "vitamín d", "vitamin d celkovy"],
  "Vitamin B12": ["b12", "b-12", "vitamin b12", "vitamin b-12", "vitamín b12", "cobalamin", "kobalamin"],
  "Folate": ["folate", "folic acid", "folat", "kyselina listova", "folacin"],
  "Ferritin": ["ferritin", "feritin"],
  "Iron": ["iron", "zelezo", "fe", "serum iron", "sérum železo"],
  "Transferrin": ["transferrin", "transferin"],
  "Hemoglobin": ["hemoglobin", "hgb", "hb", "haemoglobin", "hemoglobín"],
  "Hematocrit": ["hematocrit", "hct", "hematokrit"],
  "White blood cells": ["wbc", "white blood cells", "leukocytes", "leukocyty"],
  "Red blood cells": ["rbc", "red blood cells", "erythrocytes", "erytrocyty"],
  "Platelets": ["platelets", "plt", "trombocyty", "thrombocytes"],
  "TSH": ["tsh", "thyrotropin", "thyroid stimulating hormone"],
  "Free T4": ["ft4", "free t4", "volny t4", "free thyroxine", "tyroxin volny"],
  "Free T3": ["ft3", "free t3", "volny t3", "free triiodothyronine"],
  "Cholesterol": ["cholesterol", "total cholesterol", "cholesterol celkovy", "celkovy cholesterol", "chol"],
  "LDL": ["ldl", "ldl cholesterol", "ldl-c", "ldl cholesterol vypocitany", "cholesterol ldl", "cholesterol v ldl"],
  "HDL": ["hdl", "hdl cholesterol", "hdl-c", "cholesterol hdl", "cholesterol v hdl"],
  "Triglycerides": ["triglycerides", "triacylglyceroly", "trigylcerides", "tag", "tg", "triglyceridy"],
  "Glucose": ["glucose", "glukoza", "blood sugar", "glykemia", "fasting glucose", "glukoza nalacno"],
  "HbA1c": ["hba1c", "a1c", "hb a1c", "hemoglobin a1c", "glycated hemoglobin", "glykovany hemoglobin", "glykovany hemoglobin a1c"],
  "Insulin": ["insulin", "inzulin"],
  "Creatinine": ["creatinine", "kreatinin"],
  "eGFR": ["egfr", "gfr", "glomerular filtration rate"],
  "Urea": ["urea", "mocovina"],
  // The nitrogen in urea, not urea itself: a series of its own, or the same
  // blood reads 2.14x apart depending on which of the two the lab printed.
  "BUN": ["bun", "blood urea nitrogen", "urea nitrogen"],
  "Uric acid": ["uric acid", "kyselina mocova", "urate"],
  "ALT": ["alt", "alat", "sgpt", "alanine aminotransferase", "alaninaminotransferaza"],
  "AST": ["ast", "asat", "sgot", "aspartate aminotransferase", "aspartataminotransferaza"],
  "GGT": ["ggt", "gmt", "gama gt", "gamma gt", "gamma-glutamyl transferase"],
  "ALP": ["alp", "alkaline phosphatase", "alkalicka fosfataza"],
  "Bilirubin": ["bilirubin", "total bilirubin", "bilirubin celkovy"],
  "Albumin": ["albumin", "albumín"],
  "Total protein": ["total protein", "celkova bielkovina", "protein celkovy"],
  "CRP": ["crp", "c-reactive protein", "c reaktivny protein"],
  "Sodium": ["sodium", "na", "natrium", "sodik"],
  "Potassium": ["potassium", "k", "kalium", "draslik"],
  "Calcium": ["calcium", "ca", "kalcium", "vapnik"],
  "Magnesium": ["magnesium", "mg", "horcik", "magnezium"],
  "Phosphate": ["phosphate", "phosphorus", "fosfor", "fosfat"],
  "Zinc": ["zinc", "zinok", "zn"],
  "Testosterone": ["testosterone", "testosteron"],
  "Cortisol": ["cortisol", "kortizol"],
  "Homocysteine": ["homocysteine", "homocystein"],
  "PSA": ["psa", "prostate specific antigen"],
}

/**
 * fold() plus the separators labs put between words: "LDL-cholesterol",
 * "S_LDL" and "Gama-GT" are the spaced spellings with other punctuation.
 * Parentheses survive, because "25(OH)D" is a name and not decoration.
 */
function key(s: string): string {
  return fold(s).replace(/[-–_/.]/g, " ").replace(/\s+/g, " ").trim()
}

const LOOKUP = new Map<string, string>()
for (const [canonical, aliases] of Object.entries(ALIASES)) {
  LOOKUP.set(key(canonical), canonical)
  for (const a of aliases) LOOKUP.set(key(a), canonical)
}

/**
 * Words a lab adds without changing what was measured. Anything else after a
 * known name makes it a different test — "Cholesterol HDL", "Testosteron
 * volný", "Bilirubín konjugovaný", "CA 19-9" — and folding that into the
 * parent puts two analytes in one series and reads their gap as a change.
 */
const NEUTRAL = new Set([
  "total", "celkovy", "celkova", "celkove",
  "v", "serum", "sere", "sera", "plasma", "plazma", "plazme", "krvi",
  "fasting", "nalacno",
  "calculated", "calc", "vypocitany", "vypocitana", "vypocteny", "vypocet",
  "enzymatic", "enzymaticky",
  "ifcc", "dcct", "ngsp",
])

/** "U-", "dU-" (24-hour urine), "v moči", "(urine)", "Urine …". */
const URINE_PREFIX = /^d?u[-–_]\s*/i
const URINE_WORDS = /\(?\s*\b(?:(?:v|in)\s+)?(?:urine|mo[cč][iu]?)(?=$|[\s,;)])\s*\)?/gi

/** Strip the decoration labs put around a marker name. */
function tidy(raw: string): string {
  return raw
    .replace(/\(.*?\)/g, " ")           // "(serum)", "(calculated)"
    .trim()
    .replace(/^(?:(?:f?s|p)[-–_]\s*|b[-–_]\s*(?!\d))/i, "") // sample prefixes: "S-", "P-", "B-", Czech "S_" — not the B of "B-12"
    .replace(/[,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function bloodMarker(raw: string): string {
  // Match the untouched name first: some real marker names are mostly
  // punctuation — "25(OH)D" survives tidying as a meaningless "25 D".
  const asWritten = LOOKUP.get(key(raw))
  if (asWritten) return asWritten

  const cleaned = tidy(raw)
  if (!cleaned) return ""
  const direct = LOOKUP.get(key(cleaned))
  if (direct) return direct

  // "Železo sérum", "Glukóza v plazme": a known name followed only by words
  // that leave the analyte as it was.
  const words = key(cleaned).split(" ")
  for (let n = words.length - 1; n >= 1; n--) {
    const hit = LOOKUP.get(words.slice(0, n).join(" "))
    if (hit && words.slice(n).every(w => NEUTRAL.has(w))) return hit
  }

  // Preserve the user's capitalisation for anything already mixed-case
  // (acronyms like "NT-proBNP"); title-case only shouty or lower-case input.
  const hasMixedCase = /[a-z]/.test(cleaned) && /[A-Z]/.test(cleaned)
  if (hasMixedCase) return cleaned
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase()
}

/**
 * Canonical name for a marker, or a tidied version of the input when it isn't
 * one we know — an unrecognised marker is still worth recording, and inventing
 * a mapping for it would be worse than leaving it as printed.
 *
 * A urine measurement is its own series ("Creatinine (urine)"): its values and
 * units share nothing with the blood marker of the same name. Every answer
 * canonicalises to itself, because the server canonicalises every write —
 * including names the importer already canonicalised.
 */
export function canonicalMarker(raw: string): string {
  const trimmed = raw.trim()
  const withoutUrine = trimmed.replace(URINE_PREFIX, "").replace(URINE_WORDS, " ").trim()
  if (withoutUrine === trimmed) return bloodMarker(trimmed)
  const base = withoutUrine ? bloodMarker(withoutUrine) : ""
  return base ? `${base} (urine)` : bloodMarker(trimmed)
}

/** Every canonical marker, for autocomplete. */
export const CANONICAL_MARKERS = Object.keys(ALIASES)
