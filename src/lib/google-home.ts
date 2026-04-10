import { google } from "googleapis"
import { prisma } from "@/lib/prisma"

const SDM_BASE = "https://smartdevicemanagement.googleapis.com/v1"

async function getValidAccessToken(userId: string): Promise<string> {
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

  const { token } = await oauth2Client.getAccessToken()
  if (!token) throw new Error("Could not get valid access token")
  return token
}

export interface SmartDevice {
  name: string
  type: string
  displayName: string
  traits: Record<string, Record<string, unknown>>
  connectivity: "ONLINE" | "OFFLINE" | "UNKNOWN"
}

export async function getSmartDevices(userId: string): Promise<SmartDevice[]> {
  const projectId = process.env.SDM_PROJECT_ID
  if (!projectId) throw new Error("SDM_PROJECT_ID not configured")

  const token = await getValidAccessToken(userId)

  const res = await fetch(`${SDM_BASE}/enterprises/${projectId}/devices`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  })

  if (res.status === 403) throw new Error("PERMISSION_DENIED")
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`SDM ${res.status}: ${text}`)
  }

  const data = await res.json()
  const devices: Record<string, unknown>[] = data.devices ?? []

  return devices.map((d) => {
    const traits = (d.traits ?? {}) as Record<string, Record<string, unknown>>
    const parentRelations = (d.parentRelations as Array<{ displayName: string }> | undefined) ?? []
    const displayName = parentRelations[0]?.displayName ?? String(d.name).split("/").pop() ?? "Device"
    const connectivity = (traits["sdm.devices.traits.Connectivity"]?.status as string) ?? "UNKNOWN"

    return {
      name: d.name as string,
      type: d.type as string,
      displayName,
      traits,
      connectivity: connectivity as SmartDevice["connectivity"],
    }
  })
}

export async function executeCommand(
  userId: string,
  deviceName: string,
  command: string,
  params: Record<string, unknown>,
): Promise<void> {
  const token = await getValidAccessToken(userId)

  const res = await fetch(`${SDM_BASE}/${deviceName}:executeCommand`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ command, params }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Command failed ${res.status}: ${text}`)
  }
}
