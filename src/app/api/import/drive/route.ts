import { auth } from "@/auth"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { listRevolutStatements, downloadRevolutCsv } from "@/lib/google-drive"
import { parseRevolutCsv, guessCategory, isInternalTransfer, rowKey } from "@/lib/revolut-csv"

// GET — list available Drive statement files and their import status
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const [files, logs] = await Promise.all([
    listRevolutStatements(session.user.id),
    prisma.driveImportLog.findMany({ where: { userId: session.user.id } }),
  ])
  const importedIds = new Set(logs.map(l => l.fileId))

  return NextResponse.json({
    files: files.map(f => ({ ...f, imported: importedIds.has(f.id) })),
    logs,
  })
}

// POST — import all new (not-yet-imported) statement files from Drive
export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  // Find all statement files in Drive
  const files = await listRevolutStatements(userId)
  if (files.length === 0) {
    return NextResponse.json({ imported: 0, skipped: 0, message: "No Revolut statement files found in Drive" })
  }

  // Find already-imported files
  const existingLogs = await prisma.driveImportLog.findMany({ where: { userId } })
  const importedIds = new Set(existingLogs.map(l => l.fileId))
  const newFiles = files.filter(f => !importedIds.has(f.id))

  if (newFiles.length === 0) {
    return NextResponse.json({
      imported: 0,
      skipped: files.length,
      message: `All ${files.length} file${files.length !== 1 ? "s" : ""} already imported`,
    })
  }

  let totalImported = 0

  for (const file of newFiles) {
    try {
      const csvText = await downloadRevolutCsv(userId, file.id)
      const rows = parseRevolutCsv(csvText)

      // Upsert each row using actualId for dedup
      let rowCount = 0
      for (const row of rows) {
        if (row.state === "PENDING") continue // skip pending

        const actualId = rowKey(row)
        const amount = Math.round(row.amountEur * 100)
        const isTransfer = isInternalTransfer(row.description, row.type)
        const category = isTransfer ? null : guessCategory(row.description, row.type)
        const dateStr = row.startedDate.toISOString().split("T")[0]

        await prisma.transaction.upsert({
          where: { actualId },
          create: {
            userId,
            actualId,
            date: new Date(dateStr + "T00:00:00.000Z"),
            amount,
            payee: row.description || null,
            category,
            accountName: row.product || null,
            cleared: row.state === "COMPLETED",
            isTransfer,
          },
          update: {
            // Only update mutable fields; keep user-assigned category
            cleared: row.state === "COMPLETED",
          },
        })
        rowCount++
      }

      await prisma.driveImportLog.create({
        data: { userId, fileId: file.id, fileName: file.name, rowCount },
      })
      totalImported += rowCount
    } catch (e: any) {
      console.error(`[drive-import] Failed to import ${file.name}:`, e?.message)
    }
  }

  return NextResponse.json({
    imported: totalImported,
    skipped: files.length - newFiles.length,
    newFiles: newFiles.length,
    message: `Imported ${totalImported} transactions from ${newFiles.length} new file${newFiles.length !== 1 ? "s" : ""}`,
  })
}
