export interface RevolutRow {
  type: string
  product: string
  startedDate: Date
  completedDate: Date | null
  description: string
  amountEur: number   // original EUR amount, negative = expense
  fee: number
  currency: string
  state: "COMPLETED" | "PENDING" | string
}

// Minimal RFC-4180 CSV parser (handles quoted fields with embedded commas)
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let i = 0
  while (i < line.length) {
    if (line[i] === '"') {
      let val = ""
      i++ // skip opening quote
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { val += '"'; i += 2 }
        else if (line[i] === '"') { i++; break }
        else { val += line[i++] }
      }
      fields.push(val)
      if (line[i] === ",") i++ // skip comma
    } else {
      const end = line.indexOf(",", i)
      if (end === -1) { fields.push(line.slice(i)); break }
      fields.push(line.slice(i, end))
      i = end + 1
    }
  }
  return fields
}

export function parseRevolutCsv(csvText: string): RevolutRow[] {
  const lines = csvText.replace(/\r/g, "").split("\n").filter(l => l.trim())
  if (lines.length < 2) return []

  return lines
    .slice(1) // skip header
    .map(line => {
      const cols = parseCsvLine(line)
      const amountRaw = parseFloat(cols[5] ?? "0")
      return {
        type: cols[0]?.trim() ?? "",
        product: cols[1]?.trim() ?? "",
        startedDate: new Date((cols[2] ?? "").trim()),
        completedDate: cols[3]?.trim() ? new Date(cols[3].trim()) : null,
        description: cols[4]?.trim() ?? "",
        amountEur: isNaN(amountRaw) ? 0 : amountRaw,
        fee: parseFloat(cols[6] ?? "0") || 0,
        currency: cols[7]?.trim() ?? "EUR",
        state: cols[8]?.trim() ?? "",
      } satisfies RevolutRow
    })
    .filter(r => r.description && !isNaN(r.amountEur) && !isNaN(r.startedDate.getTime()))
}

const CATEGORY_MAP: [RegExp, string][] = [
  [/google play|netflix|spotify|apple|youtube|deezer|hbo|disney/i, "Entertainment"],
  [/billa|kaufland|tesco|lidl|aldi|coop|cba|albert|hofer|jednota/i, "Food & Drink"],
  [/mcdonald|burger king|kfc|subway|pizza|kebab|cafe|kaffee|kaviareň|restaraunt|restaurant|pub|bar |bistro/i, "Food & Drink"],
  [/bolt|uber|taxi|metro|mhd|cp\.sk|rail|bus|tram|parking|aparcament/i, "Transport"],
  [/motion|gym|apotheke|lekáreň|lékárna|doktor|health|pharma/i, "Health"],
  [/internet|telekom|orange|o2|vodafone|electric|gas |teplo|voda |energie/i, "Bills & Utilities"],
  [/nájom|rent|airbnb|hotel/i, "Housing"],
]

export function guessCategory(description: string, type: string): string | null {
  if (type === "TOPUP") return "Income"
  if (type === "FEE") return "Bills & Utilities"
  for (const [re, cat] of CATEGORY_MAP) {
    if (re.test(description)) return cat
  }
  return null
}

export function isInternalTransfer(description: string, type: string): boolean {
  if (type === "EXCHANGE") return true
  if (type === "TRANSFER") {
    const d = description.toLowerCase()
    return d.startsWith("to eur") || d.startsWith("from eur") || d.includes("travelling")
  }
  return false
}

// Stable dedup key — Revolut has no native transaction ID
export function rowKey(row: RevolutRow): string {
  const ts = row.startedDate.getTime()
  const safe = row.description.replace(/[^a-z0-9]/gi, "_").slice(0, 30)
  const amt = Math.round(row.amountEur * 100)
  return `revolut_${ts}_${safe}_${amt}`
}
