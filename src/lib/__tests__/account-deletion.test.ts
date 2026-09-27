import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { deleteAccount } from "@/lib/account-deletion"
import { TABLE_DISCOVERY_SQL } from "@/lib/export"

// "Delete my account" used to walk a hand-kept list of eleven tables and then
// delete the User row, with every failure swallowed. Six user tables have no
// foreign key to User and were on no list — body measurements, push
// subscriptions, Oura tag names, and three banking connections — so they
// survived the deletion. A surviving push subscription kept an orphaned userId
// in the re-engagement cron's "hasn't checked in lately" query, and a deleted
// person was sent "Miss you" every ten minutes for the rest of the day.
//
// Deletion now discovers every table with a userId column, the same way the
// export does, and runs inside one transaction that reports its failure.

type Call = { kind: "userDelete" | "query" | "exec"; sql?: string; args?: unknown[] }

function fakeDb(tables: string[], opts: { failOn?: string } = {}) {
  const calls: Call[] = []
  let committed = false
  const tx = {
    user: {
      delete: async (a: unknown) => { calls.push({ kind: "userDelete", args: [a] }) },
    },
    $queryRawUnsafe: async (sql: string) => {
      calls.push({ kind: "query", sql })
      return tables.map(table_name => ({ table_name }))
    },
    $executeRawUnsafe: async (sql: string, ...args: unknown[]) => {
      calls.push({ kind: "exec", sql, args })
      if (opts.failOn && sql.includes(`"${opts.failOn}"`)) throw new Error("boom")
      return 1
    },
  }
  const db = {
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
      const out = await fn(tx)
      committed = true
      return out
    },
  }
  return { db, calls, committed: () => committed }
}

describe("deleteAccount", () => {
  it("deletes from every table that has a userId column, not a remembered list", async () => {
    const { db, calls, committed } = fakeDb(["BodyMeasurementLog", "PushSubscription", "TagAlias", "TruelayerToken"])
    await deleteAccount(db as never, "u1")

    expect(calls.find(c => c.kind === "query")?.sql).toBe(TABLE_DISCOVERY_SQL)
    const deleted = calls.filter(c => c.kind === "exec")
    for (const t of ["BodyMeasurementLog", "PushSubscription", "TagAlias", "TruelayerToken"]) {
      expect(deleted).toContainEqual({ kind: "exec", sql: `DELETE FROM "${t}" WHERE "userId" = $1`, args: ["u1"] })
    }
    expect(calls.some(c => c.kind === "userDelete")).toBe(true)
    expect(committed()).toBe(true)
  })

  it("fails loudly and does not commit when a table cannot be cleared", async () => {
    const { db, committed } = fakeDb(["BodyMeasurementLog", "PushSubscription"], { failOn: "PushSubscription" })
    await expect(deleteAccount(db as never, "u1")).rejects.toThrow()
    expect(committed()).toBe(false)
  })

  it("refuses a discovered name it cannot quote safely", async () => {
    const { db } = fakeDb(['x"; DROP TABLE "User'])
    await expect(deleteAccount(db as never, "u1")).rejects.toThrow()
  })
})

describe("DELETE /api/account", () => {
  const src = readFileSync("src/app/api/account/route.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")

  it("goes through deleteAccount and says so when it fails", () => {
    expect(src).toContain("deleteAccount(prisma, userId)")
    expect(src).toMatch(/status:\s*500/)
    expect(src).not.toMatch(/\.catch\(\(\)\s*=>\s*\{\s*\}\)/)
  })
})

// Subscriptions orphaned before the fix are still in the table, and the push
// crons cannot record "already sent today" for a user who no longer exists —
// that log is a UserPreference row, which needs a User. So they are skipped
// where every cron loads its devices: a web-push row only counts while its
// user does.
describe("loadSubscriptionsByUser", () => {
  const src = readFileSync("src/lib/push.ts", "utf8")
  const reads = src.match(/SELECT[^`]*FROM "PushSubscription"[^`]*/g) ?? []

  it("finds both of its reads", () => {
    expect(reads.length).toBe(2)
  })

  it("never returns a subscription whose user is gone", () => {
    for (const sql of reads) expect(sql).toMatch(/JOIN "User" u ON u\.id = ps\."userId"/)
  })
})

// The re-engagement cron picks its 200 "inactive" users straight from
// PushSubscription before it loads their devices. An orphan never checks in,
// so without the join it is always inactive and permanently takes a slot.
describe("re-engagement candidate query", () => {
  const src = readFileSync("src/app/api/cron/re-engagement/route.ts", "utf8")

  it("only considers subscriptions whose user still exists", () => {
    expect(src).toMatch(/FROM "PushSubscription" ps\s+JOIN "User" u ON u\.id = ps\."userId"/)
  })
})
