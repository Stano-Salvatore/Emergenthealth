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
  error?: string
}

export interface SubscriptionEmail {
  id: string
  service: string
  subject: string
  snippet: string
  date: string
  from: string
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
  } catch (e: any) {
    console.error("[gmail] getGmailSummary failed:", e?.message ?? e)
    return { unreadCount: 0, messages: [], error: e?.message ?? "Unknown error" }
  }
}

function extractServiceName(from: string, subject: string): string {
  // Common senders
  if (from.includes("googleplay")) return "Google Play"
  if (from.includes("payments-noreply@google")) return "Google Pay"
  if (from.includes("netflix")) return "Netflix"
  if (from.includes("spotify")) return "Spotify"
  if (from.includes("apple")) return "Apple"
  if (from.includes("amazon")) return "Amazon"
  if (from.includes("paypal")) return "PayPal"
  // Fall back to domain
  const domainMatch = from.match(/@([a-zA-Z0-9-]+)\.[a-z]+/)
  if (domainMatch) {
    const d = domainMatch[1].replace(/[-_]/g, " ")
    return d.charAt(0).toUpperCase() + d.slice(1)
  }
  return subject.slice(0, 30)
}

export interface BillEmail {
  id: string
  sender: string
  senderName: string
  subject: string
  snippet: string
  date: string
  estimatedAmount?: number
  dueDateText?: string
}

const BILL_AMOUNT_RE = /(?:€|£|\$|EUR|USD|GBP)\s*([\d,]+(?:\.\d{2})?)/i
const DUE_DATE_RE = /(?:due|pay\s*by|due\s*(?:date|on)|payment\s*(?:due|by))[:\s]+([A-Za-z0-9\s,]+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d+\s+\w+\s+\d{4})/i

export async function getBillEmails(userId: string): Promise<BillEmail[]> {
  try {
    const gmail = await buildGmailClient(userId)
    const queries = [
      "subject:(payment due)",
      "subject:(invoice)",
      "subject:(amount due)",
      "subject:(bill) subject:(pay)",
      "subject:(direct debit)",
      "subject:(statement) -subject:(bank statement)",
      "subject:(renewal notice)",
    ]
    const res = await gmail.users.messages.list({
      userId: "me",
      q: queries.join(" OR "),
      maxResults: 40,
    })

    const items = res.data.messages ?? []
    const messages = await Promise.all(
      items.map(async m => {
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
        const { name: senderName, email: senderEmail } = parseFrom(fromRaw)
        const snippet = msg.data.snippet ?? ""

        const amountMatch = (subject + " " + snippet).match(BILL_AMOUNT_RE)
        const dueDateMatch = (subject + " " + snippet).match(DUE_DATE_RE)

        return {
          id: m.id!,
          sender: senderEmail,
          senderName: senderName || extractServiceName(senderEmail, subject),
          subject,
          snippet,
          date,
          estimatedAmount: amountMatch ? parseFloat(amountMatch[1].replace(/,/g, "")) : undefined,
          dueDateText: dueDateMatch ? dueDateMatch[1].trim() : undefined,
        } satisfies BillEmail
      })
    )
    return messages
  } catch (e: any) {
    console.error("[gmail] getBillEmails failed:", e?.message ?? e)
    return []
  }
}

export async function getSubscriptionEmails(userId: string): Promise<SubscriptionEmail[]> {
  try {
    const gmail = await buildGmailClient(userId)
    const res = await gmail.users.messages.list({
      userId: "me",
      q: [
        "from:googleplay-noreply@google.com",
        "from:payments-noreply@google.com",
        "subject:(subscription renewal)",
        "subject:(receipt) subject:(subscription)",
      ].join(" OR "),
      maxResults: 30,
    })

    const items = res.data.messages ?? []
    const messages = await Promise.all(
      items.map(async m => {
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
        const { email: fromEmail } = parseFrom(fromRaw)
        return {
          id: m.id!,
          service: extractServiceName(fromEmail, subject),
          subject,
          snippet: msg.data.snippet ?? "",
          date,
          from: fromEmail,
        } satisfies SubscriptionEmail
      })
    )
    return messages
  } catch (e: any) {
    console.error("[gmail] getSubscriptionEmails failed:", e?.message ?? e)
    return []
  }
}
