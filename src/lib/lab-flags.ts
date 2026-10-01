// The two things a lab report prints beside a number that the number alone
// can't give back: its own out-of-range mark, and a < or > sign.
//
// Both are stored as free strings in LabResult, so every write validates
// against the values below and every read re-validates: a column that holds
// "H" or "≤" from some future path must read as absent, not as a mark.

export type LabFlag = "low" | "high" | "normal"
export type LabQualifier = "<" | ">"

export function parseLabFlag(v: unknown): LabFlag | null {
  return v === "low" || v === "high" || v === "normal" ? v : null
}

export function parseLabQualifier(v: unknown): LabQualifier | null {
  return v === "<" || v === ">" ? v : null
}

/**
 * The value as the lab printed it: "<5" is a limit, and printed as "5" it
 * reads as a measurement to anyone who sees it — a clinician included.
 */
export function labValueText(value: number | string, qualifier?: string | null): string {
  return `${parseLabQualifier(qualifier) ?? ""}${value}`
}
