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
  "Vitamin B12": ["b12", "vitamin b12", "vitamín b12", "cobalamin", "kobalamin"],
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
  "LDL": ["ldl", "ldl cholesterol", "ldl-c", "ldl cholesterol vypocitany"],
  "HDL": ["hdl", "hdl cholesterol", "hdl-c"],
  "Triglycerides": ["triglycerides", "triacylglyceroly", "trigylcerides", "tag", "tg", "triglyceridy"],
  "Glucose": ["glucose", "glukoza", "blood sugar", "glykemia", "fasting glucose", "glukoza nalacno"],
  "HbA1c": ["hba1c", "a1c", "glycated hemoglobin", "glykovany hemoglobin"],
  "Insulin": ["insulin", "inzulin"],
  "Creatinine": ["creatinine", "kreatinin"],
  "eGFR": ["egfr", "gfr", "glomerular filtration rate"],
  "Urea": ["urea", "bun", "blood urea nitrogen", "mocovina"],
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

const LOOKUP = new Map<string, string>()
for (const [canonical, aliases] of Object.entries(ALIASES)) {
  LOOKUP.set(fold(canonical), canonical)
  for (const a of aliases) LOOKUP.set(fold(a), canonical)
}

/** Strip the decoration labs put around a marker name. */
function tidy(raw: string): string {
  return raw
    .replace(/\(.*?\)/g, " ")          // "(serum)", "(calculated)"
    .replace(/\b(s|p|b|u)[-–]\s*/i, "") // Slovak sample prefixes: "S-", "P-"
    .replace(/[,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Canonical name for a marker, or a tidied version of the input when it isn't
 * one we know — an unrecognised marker is still worth recording, and inventing
 * a mapping for it would be worse than leaving it as printed.
 */
export function canonicalMarker(raw: string): string {
  // Match the untouched name first: some real marker names are mostly
  // punctuation — "25(OH)D" survives tidying as a meaningless "25 D".
  const asWritten = LOOKUP.get(fold(raw.trim()))
  if (asWritten) return asWritten

  const cleaned = tidy(raw)
  if (!cleaned) return ""
  const direct = LOOKUP.get(fold(cleaned))
  if (direct) return direct

  // "LDL cholesterol - calculated" and friends: try the leading words too.
  const words = fold(cleaned).split(" ")
  for (let n = words.length - 1; n >= 1; n--) {
    const hit = LOOKUP.get(words.slice(0, n).join(" "))
    if (hit) return hit
  }

  // Preserve the user's capitalisation for anything already mixed-case
  // (acronyms like "NT-proBNP"); title-case only shouty or lower-case input.
  const hasMixedCase = /[a-z]/.test(cleaned) && /[A-Z]/.test(cleaned)
  if (hasMixedCase) return cleaned
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase()
}

/** Every canonical marker, for autocomplete. */
export const CANONICAL_MARKERS = Object.keys(ALIASES)
