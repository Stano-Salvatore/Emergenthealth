import type { PrismaClient } from "@prisma/client"
import { SAFE_TABLE_NAME, TABLE_DISCOVERY_SQL } from "@/lib/export"

// Most user tables cascade from User, but not all: several were added with a
// bare userId column and no relation, and a hand-kept list of them fell behind
// (push subscriptions and body measurements outlived deleted accounts). The
// sweep after the User delete uses the export's discovery query, so a table
// added later is covered without anyone remembering it here. The User row goes
// first so the cascades clear parent/child pairs before the sweep reaches them.
export async function deleteAccount(db: PrismaClient, userId: string): Promise<void> {
  await db.$transaction(async tx => {
    await tx.user.delete({ where: { id: userId } })
    const tables = await tx.$queryRawUnsafe<{ table_name: string }[]>(TABLE_DISCOVERY_SQL)
    for (const { table_name } of tables) {
      if (!SAFE_TABLE_NAME.test(table_name)) throw new Error(`Refusing to delete from table "${table_name}"`)
      await tx.$executeRawUnsafe(`DELETE FROM "${table_name}" WHERE "userId" = $1`, userId)
    }
  }, { maxWait: 10_000, timeout: 60_000 })
}
