import { google } from "googleapis"
import { prisma } from "@/lib/prisma"
import { parseGpx, GpxTrack } from "./gpx"

const GPSLOGGER_FOLDER_ID = "1rmfhtRSJz6OiOcdJilDwHHsjousC6oSy"

export interface DriveStatementFile {
  id: string
  name: string
  createdTime: string
  size: number
}

async function buildDriveClient(userId: string) {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
  })
  if (!account?.access_token) throw new Error("No Google account linked")

  const oauth2Client = new google.auth.OAuth2(
    process.env.AUTH_GOOGLE_ID,
    process.env.AUTH_GOOGLE_SECRET,
  )
  oauth2Client.setCredentials({
    access_token: account.access_token,
    refresh_token: account.refresh_token,
    expiry_date: account.expires_at ? account.expires_at * 1000 : undefined,
  })

  oauth2Client.on("tokens", async (tokens) => {
    await prisma.account.update({
      where: { provider_providerAccountId: { provider: "google", providerAccountId: account.providerAccountId } },
      data: {
        access_token: tokens.access_token ?? account.access_token,
        ...(tokens.refresh_token && { refresh_token: tokens.refresh_token }),
        ...(tokens.expiry_date && { expires_at: Math.floor(tokens.expiry_date / 1000) }),
      },
    })
  })

  return google.drive({ version: "v3", auth: oauth2Client })
}

// Search Drive for Revolut account-statement CSVs anywhere in the user's Drive
export async function listRevolutStatements(userId: string): Promise<DriveStatementFile[]> {
  try {
    const drive = await buildDriveClient(userId)
    const res = await drive.files.list({
      q: "name contains 'account-statement' and (mimeType = 'text/comma-separated-values' or mimeType = 'text/csv' or mimeType = 'text/troff') and trashed = false",
      fields: "files(id, name, createdTime, size)",
      orderBy: "createdTime desc",
      pageSize: 50,
    })
    return (res.data.files ?? []).map(f => ({
      id: f.id!,
      name: f.name!,
      createdTime: f.createdTime ?? "",
      size: parseInt(f.size ?? "0"),
    }))
  } catch (e: any) {
    console.error("[drive] listRevolutStatements failed:", e?.message)
    return []
  }
}

export async function downloadRevolutCsv(userId: string, fileId: string): Promise<string> {
  const drive = await buildDriveClient(userId)
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" },
  )
  return Buffer.from(res.data as ArrayBuffer).toString("utf-8")
}

export async function getGpxTrackForDate(userId: string, dateStr: string): Promise<GpxTrack | null> {
  try {
    const drive = await buildDriveClient(userId)
    const compact = dateStr.replace(/-/g, "")
    const fileName = `${compact}.gpx`

    const res = await drive.files.list({
      q: `'${GPSLOGGER_FOLDER_ID}' in parents and name = '${fileName}' and trashed = false`,
      fields: "files(id, name)",
      pageSize: 1,
    })

    const file = res.data.files?.[0]
    if (!file?.id) return null

    const content = await drive.files.get(
      { fileId: file.id, alt: "media" },
      { responseType: "arraybuffer" },
    )

    const text = Buffer.from(content.data as ArrayBuffer).toString("utf-8")
    return parseGpx(text)
  } catch {
    return null
  }
}

export async function listGpxDates(userId: string): Promise<string[]> {
  try {
    const drive = await buildDriveClient(userId)
    const res = await drive.files.list({
      q: `'${GPSLOGGER_FOLDER_ID}' in parents and name contains '.gpx' and trashed = false`,
      fields: "files(name)",
      orderBy: "name desc",
      pageSize: 30,
    })
    return (res.data.files ?? [])
      .map(f => f.name?.replace(".gpx", "") ?? "")
      .filter(s => s.length === 8)
      .map(s => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`)
  } catch {
    return []
  }
}
