import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { google } from "googleapis"
import Anthropic from "@anthropic-ai/sdk"

export const runtime = "nodejs"
export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

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

  oauth2Client.on("tokens", async (tokens: { access_token?: string | null; refresh_token?: string; expiry_date?: number | null }) => {
    await prisma.account.update({
      where: {
        provider_providerAccountId: {
          provider: "google",
          providerAccountId: account.providerAccountId,
        },
      },
      data: {
        access_token: tokens.access_token ?? account.access_token,
        ...(tokens.refresh_token && { refresh_token: tokens.refresh_token }),
        ...(tokens.expiry_date && { expires_at: Math.floor(tokens.expiry_date / 1000) }),
      },
    })
  })

  return google.drive({ version: "v3", auth: oauth2Client })
}

async function extractBookFromImage(
  imageBase64: string,
  mimeType: string,
): Promise<{
  title: string
  author: string
  isbn?: string
  confidence: "high" | "medium" | "low"
  notes?: string
}> {
  const validMimeTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const
  type ValidMimeType = (typeof validMimeTypes)[number]
  const safeMime: ValidMimeType = validMimeTypes.includes(mimeType as ValidMimeType)
    ? (mimeType as ValidMimeType)
    : "image/jpeg"

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: safeMime, data: imageBase64 },
          },
          {
            type: "text",
            text: `This is a photo of a book cover or spine. Extract the book information.\n\nReturn ONLY a JSON object:\n{\n  "title": "exact book title",\n  "author": "author name(s)",\n  "isbn": "ISBN if visible, otherwise omit this field",\n  "confidence": "high|medium|low",\n  "notes": "optional notes or explanation if not a book"\n}\n\nIf not a book image, set title and author to "Unknown", confidence to "low".`,
          },
        ],
      },
    ],
  })

  const textBlock = response.content.find((b: { type: string }) => b.type === "text") as { type: "text"; text: string } | undefined
  const text = textBlock?.text ?? ""
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error("Could not parse Claude response")
  return JSON.parse(jsonMatch[0])
}

async function addBookToNotion(book: {
  title: string
  author: string
  isbn?: string
  driveFileName?: string
}): Promise<string | null> {
  const token = process.env.NOTION_TOKEN
  const dbId = process.env.NOTION_DB_ID
  if (!token || !dbId) return null

  try {
    const bodyLines: string[] = [`Author: ${book.author}`]
    if (book.isbn) bodyLines.push(`ISBN: ${book.isbn}`)
    if (book.driveFileName) bodyLines.push(`Source file: ${book.driveFileName}`)

    const res = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
      },
      body: JSON.stringify({
        parent: { database_id: dbId },
        properties: {
          Name: { title: [{ text: { content: book.title } }] },
        },
        children: bodyLines.map((line) => ({
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: [{ text: { content: line } }] },
        })),
      }),
    })

    if (!res.ok) return null
    const page = await res.json()
    return page.url ?? null
  } catch {
    return null
  }
}

// POST /api/books
// Body: { fileId?: string } — omit fileId to scan entire DRIVE_FOLDER_ID folder
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const folderId = process.env.DRIVE_FOLDER_ID
  if (!folderId) {
    return NextResponse.json({ error: "DRIVE_FOLDER_ID not configured" }, { status: 503 })
  }

  const body = await req.json().catch(() => ({})) as { fileId?: string }

  let drive: ReturnType<typeof google.drive>
  try {
    drive = await buildDriveClient(session.user.id)
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Drive auth failed" },
      { status: 403 },
    )
  }

  let files: { id: string; name: string; mimeType: string }[]

  if (body.fileId) {
    const file = await drive.files.get({ fileId: body.fileId, fields: "id,name,mimeType" })
    files = file.data.id
      ? [{ id: file.data.id, name: file.data.name ?? "unknown", mimeType: file.data.mimeType ?? "image/jpeg" }]
      : []
  } else {
    const list = await drive.files.list({
      q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
      fields: "files(id,name,mimeType)",
      pageSize: 20,
    })
    files = (list.data.files ?? []).map((f: { id?: string | null; name?: string | null; mimeType?: string | null }) => ({
      id: f.id!,
      name: f.name ?? "unknown",
      mimeType: f.mimeType ?? "image/jpeg",
    }))
  }

  if (files.length === 0) {
    return NextResponse.json({ results: [], message: "No images found in folder" })
  }

  const results: Array<{
    file: string
    book?: { title: string; author: string; isbn?: string; confidence: string }
    notionUrl?: string | null
    error?: string
  }> = []

  for (const file of files) {
    try {
      const media = await drive.files.get(
        { fileId: file.id, alt: "media" },
        { responseType: "arraybuffer" },
      )
      const base64 = Buffer.from(media.data as ArrayBuffer).toString("base64")
      const book = await extractBookFromImage(base64, file.mimeType)
      const notionUrl = await addBookToNotion({ ...book, driveFileName: file.name })
      results.push({ file: file.name, book, notionUrl })
    } catch (err: unknown) {
      results.push({ file: file.name, error: err instanceof Error ? err.message : "Failed" })
    }
  }

  return NextResponse.json({ results, processed: results.length })
}

// GET /api/books — list books from Notion DB
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const token = process.env.NOTION_TOKEN
  const dbId = process.env.NOTION_DB_ID
  if (!token || !dbId) {
    return NextResponse.json({ error: "Notion not configured" }, { status: 503 })
  }

  const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify({
      page_size: 100,
      sorts: [{ timestamp: "created_time", direction: "descending" }],
    }),
  })

  if (!res.ok) {
    return NextResponse.json({ error: "Notion query failed" }, { status: 502 })
  }

  const data = await res.json()
  const books = (data.results ?? []).map((page: {
    id: string
    created_time: string
    url: string
    properties: Record<string, { title?: Array<{ plain_text: string }> }>
  }) => {
    const props = page.properties ?? {}
    const titleProp = props.Name ?? props.Title ?? props.title ?? props.name
    const title = titleProp?.title?.[0]?.plain_text ?? "Unknown"
    return { id: page.id, title, createdAt: page.created_time, url: page.url }
  })

  return NextResponse.json(books)
}
