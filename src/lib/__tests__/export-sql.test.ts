import { describe, it, expect } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { TABLE_DISCOVERY_SQL } from "@/lib/export"

// The backup's table-discovery query, run against a real Postgres.
//
// It failed in production twice with code that typechecked and every unit
// test green: first because information_schema returns identifiers as the
// `name` type Prisma's driver will not read, then because the fix's cast
// broke SELECT DISTINCT's ORDER BY rule. Neither is visible to anything but
// Postgres itself, so Postgres itself runs here — in-process, no server.
describe("export table discovery SQL", () => {
  it("returns every user-owned base table as text, and nothing else", async () => {
    const db = new PGlite()
    await db.exec(`
      CREATE TABLE "HealthLog" ("id" text, "userId" text);
      CREATE TABLE "Habit" ("id" text, "userId" text);
      CREATE TABLE "Account" ("id" text, "provider" text);
      CREATE VIEW "HabitView" AS SELECT * FROM "Habit";
    `)
    const res = await db.query<{ table_name: string }>(TABLE_DISCOVERY_SQL)
    expect(res.rows.map(r => r.table_name)).toEqual(["Habit", "HealthLog"])
    // OID 25 is text. The bare column comes back as `name` (OID 19), which
    // is the type Prisma refuses.
    expect(res.fields.map(f => f.dataTypeID)).toEqual([25])
    await db.close()
  })
})
