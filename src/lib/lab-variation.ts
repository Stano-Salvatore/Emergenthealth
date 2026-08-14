// How much a marker moves on its own.
//
// A flat 5% "that's just noise" threshold was wrong in both directions at
// once. Sodium is held so tightly that a 5% move is a genuine event; CRP
// routinely doubles in a healthy person between two ordinary mornings. Judging
// both by the same number means crying wolf about one and staying silent about
// the other.
//
// The proper measure is the **reference change value**: the difference two
// results must show before it can be attributed to something other than the
// analysis plus the person's own day-to-day biology.
//
//   RCV = 2.77 × √(CVa² + CVi²)
//
// where CVi is within-subject biological variation and CVa analytical
// variation, and 2.77 is the two-tailed 95% coefficient (1.96 × √2). The CVi
// figures below are rounded from the published biological-variation
// literature (Ricós et al. / the EFLM database). They are population
// estimates, not this user's own numbers, and they vary between assays — so
// they're used to decide whether a change is worth mentioning, never to say
// anything about what the result means.

export interface Variation {
  /** Within-subject biological variation, %. */
  cvi: number
  /** Analytical variation, %. */
  cva: number
}

const VARIATION: Record<string, Variation> = {
  // Tightly regulated — small moves are real
  "Sodium": { cvi: 0.6, cva: 1.0 },
  "Calcium": { cvi: 2.1, cva: 1.5 },
  "Total protein": { cvi: 2.7, cva: 1.5 },
  "Albumin": { cvi: 3.1, cva: 2.0 },
  "Hemoglobin": { cvi: 2.8, cva: 1.5 },
  "Hematocrit": { cvi: 2.8, cva: 1.5 },
  "Red blood cells": { cvi: 3.2, cva: 1.5 },
  "Magnesium": { cvi: 3.6, cva: 2.0 },
  "Transferrin": { cvi: 3.0, cva: 2.0 },
  "HbA1c": { cvi: 1.7, cva: 1.5 },

  // Moderate
  "Potassium": { cvi: 4.6, cva: 2.0 },
  "Glucose": { cvi: 5.7, cva: 2.5 },
  "Cholesterol": { cvi: 6.0, cva: 2.5 },
  "Creatinine": { cvi: 6.0, cva: 3.0 },
  "eGFR": { cvi: 6.0, cva: 3.0 },
  "ALP": { cvi: 6.4, cva: 3.0 },
  "HDL": { cvi: 7.3, cva: 3.0 },
  "Free T4": { cvi: 5.7, cva: 3.0 },
  "Free T3": { cvi: 7.9, cva: 3.5 },
  "LDL": { cvi: 8.3, cva: 3.0 },
  "Homocysteine": { cvi: 8.0, cva: 3.0 },
  "Phosphate": { cvi: 8.5, cva: 3.0 },
  "Uric acid": { cvi: 9.0, cva: 2.5 },
  "Platelets": { cvi: 9.1, cva: 3.5 },
  "Zinc": { cvi: 9.3, cva: 3.0 },
  "Testosterone": { cvi: 9.3, cva: 4.0 },

  // Wide — needs a big move to mean anything
  "White blood cells": { cvi: 10.9, cva: 3.5 },
  "AST": { cvi: 11.9, cva: 4.0 },
  "Urea": { cvi: 12.0, cva: 3.0 },
  "Vitamin D": { cvi: 12.1, cva: 5.0 },
  "GGT": { cvi: 13.4, cva: 4.0 },
  "Vitamin B12": { cvi: 13.5, cva: 5.0 },
  "Ferritin": { cvi: 14.2, cva: 5.0 },
  "PSA": { cvi: 18.0, cva: 5.0 },
  "ALT": { cvi: 19.4, cva: 5.0 },
  "TSH": { cvi: 19.3, cva: 5.0 },
  "Triglycerides": { cvi: 20.0, cva: 4.0 },
  "Cortisol": { cvi: 20.9, cva: 5.0 },
  "Insulin": { cvi: 21.1, cva: 5.0 },
  "Bilirubin": { cvi: 21.8, cva: 5.0 },
  "Folate": { cvi: 24.0, cva: 5.0 },
  "Iron": { cvi: 26.5, cva: 4.0 },
  "CRP": { cvi: 42.2, cva: 5.0 },
}

/** 1.96 × √2 — two-tailed, 95%. */
const Z = 2.77

/**
 * The percentage change this marker has to exceed before it's worth calling a
 * change at all. Null for a marker we hold no variation data for — in which
 * case the honest report is that we don't know, not a made-up threshold.
 */
export function referenceChangeValue(marker: string): number | null {
  const v = VARIATION[marker]
  if (!v) return null
  return Math.round(Z * Math.sqrt(v.cva * v.cva + v.cvi * v.cvi))
}

/**
 * Is a change bigger than this marker's own natural variation?
 * Returns null when the marker's variability is unknown.
 */
export function isSignificantChange(marker: string, changePct: number): boolean | null {
  const rcv = referenceChangeValue(marker)
  if (rcv == null) return null
  return Math.abs(changePct) >= rcv
}

export const VARIATION_NOTE =
  "Thresholds come from published within-subject biological variation, which differs between assays and is a population estimate rather than your own. They decide what's worth mentioning — nothing more."
