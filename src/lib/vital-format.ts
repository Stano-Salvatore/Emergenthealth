// A vital as the card prints it.
//
// Skin temperature is the ring's deviation from its own reference, not a
// temperature: "0 °C · usual 0 °C" read as a reading of zero degrees. Signed
// with one decimal it reads as what it is, a shift: "+0.4 °C".

const SIGNED = new Set(["skinTemp"])

export function vitalText(key: string, value: number, unit: string): string {
  if (!SIGNED.has(key)) return `${value}${unit}`
  const fixed = Math.abs(value).toFixed(1)
  const sign = fixed === "0.0" ? (value < 0 ? "−" : "+") : value > 0 ? "+" : "−"
  return `${sign}${fixed}${unit}`
}
