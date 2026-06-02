import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { createHash } from "crypto"

export const runtime = "nodejs"
export const maxDuration = 60

// Parse a CSV line respecting quoted fields
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim()); current = ""
    } else {
      current += ch
    }
  }
  fields.push(current.trim())
  return fields
}

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(l => l.trim())
  if (lines.length < 2) return { headers: [], rows: [] }
  const headers = parseCsvLine(lines[0]).map(h => h.replace(/^﻿/, "")) // strip BOM
  const rows = lines.slice(1).map(line => {
    const vals = parseCsvLine(line)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = vals[i] ?? "" })
    return row
  })
  return { headers, rows }
}

const MERCHANT_KEYWORD_MAP: [RegExp, string][] = [
  [/revolut|transfer|topup/i, "Transfer"],
  [/grocery|supermarket|tesco|lidl|kaufland|albert|billa|coop|biedronka|zabka/i, "Food & Drink"],
  [/restaurant|cafe|coffee|starbucks|mcdonald|burger|pizza|kfc|subway|pub|bar/i, "Food & Drink"],
  [/uber|bolt|taxi|lyft|train|metro|bus|mhd|cp\.sk|slovak rail/i, "Transport"],
  [/fuel|petrol|benzin|shell|eni|lotos|orlen/i, "Transport"],
  [/netflix|spotify|youtube|prime|disney|hbo|apple\.com\/bill/i, "Entertainment"],
  [/amazon|aliexpress|mall\.sk|heureka|alza|ikea|zara|hm\b/i, "Shopping"],
  [/rent|mortgage|nájom/i, "Housing"],
  [/gym|fitness|sport|swimming|pool/i, "Health"],
  [/doctor|pharmacy|lekaren|lekár|medical|hospital/i, "Health"],
  [/insurance|allianz|uniqa|generali/i, "Bills & Utilities"],
  [/salary|payroll|mzda|výplata/i, "Income"],
]

function mapCategory(amount: number, description: string): string {
  if (amount > 0) return "Income"
  for (const [re, cat] of MERCHANT_KEYWORD_MAP) {
    if (re.test(description)) return cat
  }
  return "Other"
}

interface ParsedTransaction {
  date: Date
  amount: number       // cents
  description: string
  currency: string
  txType: string | null
}

function parseRevolutCsv(rows: Record<string, string>[]): ParsedTransaction[] {
  return rows
    .filter(r => {
      const state = r["State"] ?? r["state"] ?? ""
      return state.toUpperCase() === "COMPLETED"
    })
    .map(r => {
      const dateStr = r["Completed Date"] ?? r["Started Date"] ?? r["Date"] ?? ""
      const amount = parseFloat(r["Amount"] ?? "0")
      const description = r["Description"] ?? ""
      const currency = r["Currency"] ?? "EUR"
      const txType = r["Type"] ?? null
      return {
        date: new Date(dateStr),
        amount: Math.round(amount * 100),
        description,
        currency,
        txType,
      }
    })
    .filter(t => !isNaN(t.date.getTime()) && t.amount !== 0)
}

function parseGenericCsv(headers: string[], rows: Record<string, string>[]): ParsedTransaction[] {
  // Try to find date, amount, description columns by common names
  const dateCol = headers.find(h => /date|time/i.test(h)) ?? headers[0]
  const amountCol = headers.find(h => /amount|value|sum/i.test(h))
  const descCol = headers.find(h => /desc|memo|narr|payee|reference/i.test(h))
  const currencyCol = headers.find(h => /curr/i.test(h))

  if (!amountCol) return []

  return rows
    .map(r => {
      const dateStr = r[dateCol] ?? ""
      const amountStr = r[amountCol].replace(/[, ]/g, "")
      const amount = parseFloat(amountStr)
      const description = descCol ? (r[descCol] ?? "") : ""
      const currency = currencyCol ? (r[currencyCol] ?? "EUR") : "EUR"
      return {
        date: new Date(dateStr),
        amount: Math.round(amount * 100),
        description,
        currency,
        txType: null,
      }
    })
    .filter(t => !isNaN(t.date.getTime()) && t.amount !== 0)
}

function stableId(userId: string, date: Date, amount: number, description: string): string {
  const hash = createHash("sha256")
    .update(`${userId}|${date.toISOString().slice(0, 10)}|${amount}|${description}`)
    .digest("hex")
    .slice(0, 16)
  return `csv_${hash}`
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let text: string
  try {
    const formData = await req.formData()
    const file = formData.get("file") as File | null
    if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 })
    if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "File too large (max 5 MB)" }, { status: 400 })
    text = await file.text()
  } catch {
    return NextResponse.json({ error: "Failed to read file" }, { status: 400 })
  }

  const { headers, rows } = parseCsv(text)
  if (!rows.length) return NextResponse.json({ error: "CSV is empty or unreadable" }, { status: 400 })

  // Detect Revolut format by checking for its characteristic headers
  const isRevolut = headers.some(h => h === "Completed Date" || h === "Started Date") &&
    headers.some(h => h === "State")

  const transactions = isRevolut
    ? parseRevolutCsv(rows)
    : parseGenericCsv(headers, rows)

  if (!transactions.length) {
    return NextResponse.json({ error: "No valid transactions found in CSV" }, { status: 400 })
  }

  let synced = 0
  for (const t of transactions) {
    const actualId = stableId(session.user.id, t.date, t.amount, t.description)
    const category = mapCategory(t.amount, t.description)

    await prisma.transaction.upsert({
      where: { actualId },
      create: {
        userId: session.user.id,
        actualId,
        date: t.date,
        amount: t.amount,
        payee: t.description || null,
        category,
        categoryGroup: t.txType,
        notes: t.description || null,
        cleared: true,
        isTransfer: category === "Transfer",
      },
      update: {
        date: t.date,
        amount: t.amount,
        payee: t.description || null,
        category,
        notes: t.description || null,
        syncedAt: new Date(),
      },
    })
    synced++
  }

  return NextResponse.json({ success: true, synced, format: isRevolut ? "revolut" : "generic" })
}
