import { google } from "googleapis"
import { prisma } from "@/lib/prisma"

async function buildGmailClient(userId: string) {
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

  return google.gmail({ version: "v1", auth: oauth2Client })
}

export interface GmailMessage {
  id: string
  subject: string
  from: string
  fromName: string
  snippet: string
  date: string
  isUnread: boolean
}

export interface GmailSummary {
  unreadCount: number
  messages: GmailMessage[]
}

function decodeHeader(raw: string): string {
  // Decode RFC 2047 encoded words (basic support)
  return raw.replace(/=\?([^?]+)\?([BQbq])\?([^?]*)\?=/g, (_, charset, encoding, encoded) => {
    try {
      if (encoding.toUpperCase() === "B") return Buffer.from(encoded, "base64").toString("utf8")
      return encoded.replace(/_/g, " ")
    } catch {
      return encoded
    }
  })
}

function parseFrom(from: string): { name: string; email: string } {
  const match = from.match(/^(.*?)\s*<(.+?)>$/)
  if (match) return { name: decodeHeader(match[1].replace(/"/g, "").trim()), email: match[2] }
  return { name: from, email: from }
}

export async function getGmailSummary(userId: string): Promise<GmailSummary> {
  try {
    const gmail = await buildGmailClient(userId)

    const [unreadRes, listRes] = await Promise.all([
      gmail.users.messages.list({
        userId: "me",
        q: "in:inbox is:unread",
        maxResults: 1,
      }),
      gmail.users.messages.list({
        userId: "me",
        q: "in:inbox",
        maxResults: 10,
      }),
    ])

    const unreadCount = unreadRes.data.resultSizeEstimate ?? 0
    const messageItems = listRes.data.messages ?? []

    const messages = await Promise.all(
      messageItems.map(async (m) => {
        const msg = await gmail.users.messages.get({
          userId: "me",
          id: m.id!,
          format: "metadata",
          metadataHeaders: ["Subject", "From", "Date"],
        })

        const headers = msg.data.payload?.headers ?? []
        const subject = decodeHeader(headers.find(h => h.name === "Subject")?.value ?? "(no subject)")
        const fromRaw = headers.find(h => h.name === "From")?.value ?? ""
        const date = headers.find(h => h.name === "Date")?.value ?? ""
        const { name: fromName, email: fromEmail } = parseFrom(fromRaw)
        const isUnread = (msg.data.labelIds ?? []).includes("UNREAD")

        return {
          id: m.id!,
          subject,
          from: fromEmail,
          fromName: fromName || fromEmail,
          snippet: msg.data.snippet ?? "",
          date,
          isUnread,
        } satisfies GmailMessage
      })
    )

    return { unreadCount, messages }
  } catch {
    return { unreadCount: 0, messages: [] }
  }
}
