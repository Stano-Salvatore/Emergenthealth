import { prisma } from "@/lib/prisma"

// Full-account export. Years of tracked life live in one Postgres database;
// this turns all of it into a single JSON bundle the user can hold on to —
// no bug, migration, or vendor issue can take history that also exists in
// their inbox and downloads folder.
//
// Tables are discovered from information_schema (every table with a userId
// column), so new features join the export automatically instead of being
// forgotten here. Credential tables are excluded by name: an export is for
// keeping, sharing with a doctor, feeding to a script — none of which should
// ever carry OAuth tokens or push keys.

const EXCLUDED_TABLES = new Set([
  "Account", "Session", "VerificationToken", "Passkey",
  "McpApiKey", "FitToken", "OuraToken", "StravaToken", "YnabToken",
  "TogglToken", "TruelayerToken", "LastfmKey", "RescuetimeKey",
  "GocardlessConnection", "SaltedgeConnection",
  "PushSubscription", "NewsletterSubscriber",
])

// Belt and braces for UserPreference: no key with a credential-shaped name
// leaves with its value, even if one appears in the future.
const SENSITIVE_PREF_KEY = /(token|secret|password|api_?key|credential)/i

const SAFE_TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

export type ExportBundle = {
  filename: string
  json: string
  bytes: number
  tableCount: number
  rowCount: number
}

export async function buildExportBundle(userId: string): Promise<ExportBundle> {
  const [user, tableRows] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true, createdAt: true },
    }).catch(() => null),
    prisma.$queryRaw<{ table_name: string }[]>`
      SELECT DISTINCT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_name = c.table_name AND t.table_schema = 'public'
      WHERE c.table_schema = 'public'
        AND c.column_name = 'userId'
        AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name
    `,
  ])

  const tables: Record<string, unknown[]> = {}
  let rowCount = 0

  for (const { table_name } of tableRows) {
    if (EXCLUDED_TABLES.has(table_name)) continue
    if (!SAFE_TABLE_NAME.test(table_name)) continue // defense in depth; names come from information_schema

    let rows: Record<string, unknown>[]
    try {
      rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT * FROM "${table_name}" WHERE "userId" = $1`,
        userId,
      )
    } catch {
      continue // a table this connection can't read shouldn't sink the export
    }
    if (rows.length === 0) continue

    if (table_name === "UserPreference") {
      rows = rows.map(r =>
        SENSITIVE_PREF_KEY.test(String(r.key ?? ""))
          ? { ...r, value: "[redacted — credential-shaped key]" }
          : r
      )
    }

    tables[table_name] = rows
    rowCount += rows.length
  }

  const exportedAt = new Date().toISOString()
  const bundle = {
    format: "emergenthealth-export",
    version: 1,
    exportedAt,
    user: { name: user?.name ?? null, email: user?.email ?? null, memberSince: user?.createdAt ?? null },
    note: "Complete account export. Credential tables (OAuth tokens, push keys, API keys) are deliberately excluded.",
    counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])),
    tables,
  }

  // Dates serialize via toJSON; bigints (rare, from raw SELECTs) would throw.
  const json = JSON.stringify(bundle, (_k, v) => (typeof v === "bigint" ? Number(v) : v))

  return {
    filename: `emergenthealth-export-${exportedAt.slice(0, 10)}.json`,
    json,
    bytes: Buffer.byteLength(json, "utf8"),
    tableCount: Object.keys(tables).length,
    rowCount,
  }
}
