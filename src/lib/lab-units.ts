// Unit conversion for lab results.
//
// Refusing to compare 200 mg/dL with 5.2 mmol/l was the safe answer, not the
// right one — they're the same cholesterol, and a Slovak report next to
// anything from an American lab hits this on the first comparison.
//
// Conversion is done properly rather than with a lookup table of magic
// numbers. Every unit is parsed into a dimension and a scale relative to that
// dimension's base (g/L, mol/L, U/L, cells/L). Same dimension converts by
// ratio alone. Crossing between mass and molar needs the substance's molar
// mass, which is why that step is keyed by marker and simply doesn't happen
// for a marker whose molar mass we don't hold.
//
// Storage is unaffected: a result is still saved exactly as the lab printed
// it. This only exists so two of them can be compared.

export type Dimension = "mass" | "molar" | "activity" | "count" | "fraction" | "iu"

interface UnitDef {
  dim: Dimension
  /** Multiply a value in this unit by this to reach the dimension's base. */
  toBase: number
}

/**
 * Bases: mass = g/L, molar = mol/L, activity = U/L, count = cells/L,
 * fraction = %, iu = IU/L (arbitrary international units, never convertible
 * to mass without an assay-specific factor).
 */
const UNITS: Record<string, UnitDef> = {
  // ── mass concentration, base g/L ──
  "g/l": { dim: "mass", toBase: 1 },
  "g/dl": { dim: "mass", toBase: 10 },
  "mg/l": { dim: "mass", toBase: 1e-3 },
  "mg/dl": { dim: "mass", toBase: 1e-2 },
  "ug/l": { dim: "mass", toBase: 1e-6 },
  "ug/dl": { dim: "mass", toBase: 1e-5 },
  "ug/ml": { dim: "mass", toBase: 1e-3 },
  "ng/l": { dim: "mass", toBase: 1e-9 },
  "ng/dl": { dim: "mass", toBase: 1e-8 },
  "ng/ml": { dim: "mass", toBase: 1e-6 },
  "pg/l": { dim: "mass", toBase: 1e-12 },
  "pg/ml": { dim: "mass", toBase: 1e-9 },

  // ── molar concentration, base mol/L ──
  "mol/l": { dim: "molar", toBase: 1 },
  "mmol/l": { dim: "molar", toBase: 1e-3 },
  "umol/l": { dim: "molar", toBase: 1e-6 },
  "nmol/l": { dim: "molar", toBase: 1e-9 },
  "pmol/l": { dim: "molar", toBase: 1e-12 },

  // ── enzyme activity, base U/L ──
  "u/l": { dim: "activity", toBase: 1 },
  "iu/l": { dim: "activity", toBase: 1 },
  "ukat/l": { dim: "activity", toBase: 60 }, // 1 katal = 60 mol/min

  // ── cell counts, base cells/L ──
  "10^9/l": { dim: "count", toBase: 1e9 },
  "10^3/ul": { dim: "count", toBase: 1e9 },
  "10^12/l": { dim: "count", toBase: 1e12 },
  "10^6/ul": { dim: "count", toBase: 1e12 },
  "/ul": { dim: "count", toBase: 1e6 },
  "/l": { dim: "count", toBase: 1 },

  // ── fractions ──
  "%": { dim: "fraction", toBase: 1 },

  // ── international units: hormone assays, never mass-convertible ──
  "iu/ml": { dim: "iu", toBase: 1e3 },
  "miu/l": { dim: "iu", toBase: 1e-3 },
  "uiu/ml": { dim: "iu", toBase: 1e-3 }, // µIU/mL and mIU/L are the same thing
  "miu/ml": { dim: "iu", toBase: 1 },
}

/**
 * Molar masses in g/mol, for the markers where mass and molar reporting both
 * occur in the wild. A marker absent from here simply never crosses between
 * the two — which is the old refusal, now applied only where it's warranted.
 *
 * LDL and HDL take cholesterol's mass because that is what is being measured.
 * Triglycerides use triolein, the convention labs report against. Phosphate is
 * reported as elemental phosphorus.
 */
const MOLAR_MASS: Record<string, number> = {
  "Cholesterol": 386.65,
  "LDL": 386.65,
  "HDL": 386.65,
  "Triglycerides": 885.4,
  "Glucose": 180.156,
  "Creatinine": 113.12,
  "Urea": 60.06,
  "Uric acid": 168.11,
  "Calcium": 40.078,
  "Magnesium": 24.305,
  "Phosphate": 30.974,
  "Sodium": 22.99,
  "Potassium": 39.098,
  "Iron": 55.845,
  "Zinc": 65.38,
  "Bilirubin": 584.66,
  "Vitamin D": 400.64,
  "Vitamin B12": 1355.37,
  "Folate": 441.4,
  "Testosterone": 288.42,
  "Cortisol": 362.46,
  "Homocysteine": 135.18,
}

/**
 * Fold the many ways a lab prints the same unit onto one key: case, spacing,
 * the micro sign vs "u" vs "mcg", "x10^9/L" vs "10*9/L" vs "G/L", and "per".
 */
export function normalizeUnit(raw: string): string {
  let u = (raw ?? "").trim().toLowerCase()
  if (!u) return ""
  u = u
    .replace(/\s+/g, "")
    .replace(/µ|μ/g, "u")       // both micro signs in Unicode
    .replace(/mcg/g, "ug")
    .replace(/per/g, "/")
    .replace(/litre|liter/g, "l")
    .replace(/^x/, "")           // "x10^9/L"
    .replace(/\*/g, "^")         // "10*9/L"
    .replace(/10e(\d)/g, "10^$1")
    .replace(/^g\/l$/, "g/l")
  // "G/L" for 10^9/L and "T/L" for 10^12/L are a European convention for cell
  // counts, but "g/l" is also grams per litre — so only the uppercase original
  // disambiguates them.
  const original = (raw ?? "").trim().replace(/\s+/g, "")
  if (original === "G/L") return "10^9/l"
  if (original === "T/L") return "10^12/l"
  return u
}

export function unitDimension(raw: string): Dimension | null {
  return UNITS[normalizeUnit(raw)]?.dim ?? null
}

/**
 * Convert `value` from one unit to another for a given marker. Returns null
 * when the conversion isn't defined — unknown unit, incompatible dimensions,
 * or a mass/molar crossing for a marker whose molar mass we don't hold.
 */
export function convertLabValue(
  value: number,
  fromUnit: string,
  toUnit: string,
  marker: string,
): number | null {
  if (!Number.isFinite(value)) return null
  const from = UNITS[normalizeUnit(fromUnit)]
  const to = UNITS[normalizeUnit(toUnit)]
  if (!from || !to) return null

  if (from.dim === to.dim) return (value * from.toBase) / to.toBase

  // The only cross-dimension conversion that is ever legitimate.
  const mm = MOLAR_MASS[marker]
  if (mm == null) return null
  if (from.dim === "mass" && to.dim === "molar") {
    return (value * from.toBase) / mm / to.toBase
  }
  if (from.dim === "molar" && to.dim === "mass") {
    return (value * from.toBase * mm) / to.toBase
  }
  return null
}

/** True when two printed units mean the same thing for this marker. */
export function sameQuantity(a: string, b: string, marker: string): boolean {
  const na = normalizeUnit(a)
  const nb = normalizeUnit(b)
  if (na === nb) return true
  return convertLabValue(1, a, b, marker) != null
}
