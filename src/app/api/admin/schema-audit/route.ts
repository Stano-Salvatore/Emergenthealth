import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// Read-only audit of the live database against prisma/schema.prisma.
//
// Several tables in this app are created by raw `CREATE TABLE IF NOT EXISTS`
// on the request path and never appear in the schema file — invisible to the
// typed client, to migrations, and to review. That's how the widget spent
// months selecting a column that doesn't exist and swallowing the error.
//
// Before those tables can be adopted into schema.prisma they have to be
// described exactly: the build runs `prisma db push --accept-data-loss`, so a
// model that disagrees with reality doesn't fail — it rewrites reality. This
// endpoint reports the ground truth (columns, types, nullability, defaults,
// indexes, foreign keys, row counts and row age) so the models can be written
// from data instead of memory.
//
// Row age also answers the open question of whether `db push` has been
// dropping these tables on every deploy: rows older than the last few deploys
// prove they survive.
//
// Owner-only, GET-only, and it never writes anything.

export const dynamic = "force-dynamic"

const IDENT = /^[A-Za-z0-9_]+$/

interface ColumnRow {
  table_name: string
  column_name: string
  data_type: string
  is_nullable: string
  column_default: string | null
  character_maximum_length: number | null
}

// Columns worth reading a date range from, most specific first.
const DATE_COLUMN_HINTS = [
  "createdAt", "loggedAt", "occurredAt", "startedAt", "checkedAt",
  "timestamp", "syncedAt", "date", "day", "updatedAt",
]

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const ownerEmail = process.env.FEEDBACK_NOTIFY_EMAIL ?? process.env.OWNER_EMAIL
  if (!ownerEmail) {
    return NextResponse.json(
      { error: "No owner configured — set OWNER_EMAIL to your account's email address to use admin endpoints." },
      { status: 403 })
  }
  if (session.user.email !== ownerEmail) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // What Prisma believes exists — taken from the generated client, so it can
  // never drift from the schema file the build actually pushes.
  const modelTables = new Set(
    Prisma.dmmf.datamodel.models.map(m => m.dbName || m.name)
  )

  const [dbTables, columns, indexes, foreignKeys] = await Promise.all([
    // Every identifier column below is cast ::text. In the catalogs they are
    // Postgres's `name` type, which Prisma's driver adapter cannot
    // deserialise — the whole route answered 500 on its first query, from the
    // day it was written until the first time anyone actually opened it.
    // The same bug was found and fixed in the stats route earlier; this file
    // never got the cast because nothing ever exercised it.
    prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name::text AS table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `,
    prisma.$queryRaw<ColumnRow[]>`
      SELECT table_name::text AS table_name, column_name::text AS column_name,
             data_type::text AS data_type, is_nullable::text AS is_nullable,
             column_default::text AS column_default, character_maximum_length::int AS character_maximum_length
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `,
    prisma.$queryRaw<{ tablename: string; indexname: string; indexdef: string }[]>`
      SELECT tablename::text AS tablename, indexname::text AS indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname
    `,
    prisma.$queryRaw<{ table_name: string; constraint_name: string; definition: string }[]>`
      SELECT rel.relname::text AS table_name, con.conname::text AS constraint_name,
             pg_get_constraintdef(con.oid) AS definition
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
      WHERE ns.nspname = 'public' AND con.contype = 'f'
      ORDER BY rel.relname
    `,
  ])

  const allTables = dbTables.map(t => t.table_name).filter(t => IDENT.test(t))
  const shadow = allTables.filter(t => !modelTables.has(t) && !t.startsWith("_"))
  const managed = allTables.filter(t => modelTables.has(t))
  const missing = [...modelTables].filter(t => !allTables.includes(t)).sort()

  const columnsByTable = new Map<string, ColumnRow[]>()
  for (const c of columns) {
    if (!columnsByTable.has(c.table_name)) columnsByTable.set(c.table_name, [])
    columnsByTable.get(c.table_name)!.push(c)
  }

  // Row counts and date ranges. Identifiers are validated against IDENT and
  // come from information_schema, never from user input.
  async function tableStats(table: string) {
    const countRows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*)::bigint AS n FROM "${table}"`
    ).catch(() => [{ n: BigInt(0) }])
    const rows = Number(countRows[0]?.n ?? 0)

    const cols = columnsByTable.get(table) ?? []
    const dateCol = DATE_COLUMN_HINTS
      .map(hint => cols.find(c => c.column_name === hint))
      .find(Boolean)

    let oldest: string | null = null
    let newest: string | null = null
    if (dateCol && rows > 0 && IDENT.test(dateCol.column_name)) {
      const range = await prisma.$queryRawUnsafe<{ lo: string | null; hi: string | null }[]>(
        `SELECT MIN("${dateCol.column_name}")::text AS lo, MAX("${dateCol.column_name}")::text AS hi FROM "${table}"`
      ).catch(() => [])
      oldest = range[0]?.lo ?? null
      newest = range[0]?.hi ?? null
    }
    return { table, rows, dateColumn: dateCol?.column_name ?? null, oldest, newest }
  }

  const shadowStats = await Promise.all(shadow.map(tableStats))
  const managedCounts = await Promise.all(managed.map(async t => {
    const r = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*)::bigint AS n FROM "${t}"`
    ).catch(() => [{ n: BigInt(0) }])
    return { table: t, rows: Number(r[0]?.n ?? 0) }
  }))

  const payload = {
    generatedAt: new Date().toISOString(),
    summary: {
      tablesInDatabase: allTables.length,
      knownToPrisma: managed.length,
      shadowTables: shadow.length,
      inSchemaButMissingFromDatabase: missing.length,
    },
    shadowTables: shadowStats.map(s => ({
      ...s,
      columns: (columnsByTable.get(s.table) ?? []).map(c => ({
        name: c.column_name,
        type: c.data_type + (c.character_maximum_length ? `(${c.character_maximum_length})` : ""),
        nullable: c.is_nullable === "YES",
        default: c.column_default,
      })),
      indexes: indexes.filter(i => i.tablename === s.table).map(i => i.indexdef),
      foreignKeys: foreignKeys.filter(f => f.table_name === s.table).map(f => f.definition),
    })),
    managedTables: managedCounts,
    missingFromDatabase: missing,
  }

  if (new URL(req.url).searchParams.get("format") === "json") {
    return NextResponse.json(payload)
  }

  // Plain text by default: this report exists to be read and pasted.
  const lines: string[] = []
  lines.push(`SCHEMA AUDIT — ${payload.generatedAt}`)
  lines.push(`${payload.summary.tablesInDatabase} tables in the database · ${payload.summary.knownToPrisma} known to Prisma · ${payload.summary.shadowTables} shadow · ${payload.summary.inSchemaButMissingFromDatabase} in schema but absent`)
  lines.push("")
  lines.push("== SHADOW TABLES (exist in the database, absent from schema.prisma) ==")
  if (payload.shadowTables.length === 0) lines.push("  (none)")
  for (const t of payload.shadowTables) {
    const age = t.oldest ? `oldest ${t.oldest.slice(0, 19)} · newest ${(t.newest ?? "").slice(0, 19)}` : "no date column"
    lines.push("")
    lines.push(`-- ${t.table}  (${t.rows} rows · ${age})`)
    for (const c of t.columns) {
      lines.push(`   ${c.name.padEnd(24)} ${c.type.padEnd(28)} ${c.nullable ? "NULL" : "NOT NULL"}${c.default ? ` DEFAULT ${c.default}` : ""}`)
    }
    for (const idx of t.indexes) lines.push(`   idx: ${idx}`)
    for (const fk of t.foreignKeys) lines.push(`   fk:  ${fk}`)
  }
  lines.push("")
  lines.push("== IN SCHEMA BUT NOT IN THE DATABASE (db push would create these) ==")
  lines.push(missing.length ? "  " + missing.join(", ") : "  (none)")
  lines.push("")
  lines.push("== MANAGED TABLES (row counts) ==")
  for (const t of payload.managedTables) lines.push(`   ${t.table.padEnd(28)} ${t.rows}`)

  return new NextResponse(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  })
}
