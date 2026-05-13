/**
 * Custom MCP SSE transport that works with Next.js App Router streaming responses.
 *
 * The MCP SDK's built-in SSEServerTransport requires Node.js http.ServerResponse,
 * which is not available in App Router route handlers. This implementation wraps
 * a Web Streams ReadableStream instead.
 *
 * Session state lives in a module-level Map. On Vercel this works as long as
 * both the SSE and POST messages requests hit the same warm function instance —
 * which is typical for a single-user app with Fluid Compute enabled (see
 * vercel.json). maxDuration is set to 60s (Hobby) / 300s (Pro) on each route.
 */

import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js"

// Sessions live in module scope — shared across requests on the same warm instance.
const sessions = new Map<string, NextSSETransport>()

export function getSession(id: string): NextSSETransport | undefined {
  return sessions.get(id)
}

export function deleteSession(id: string): void {
  sessions.delete(id)
}

export class NextSSETransport implements Transport {
  readonly sessionId: string
  readonly readable: ReadableStream<Uint8Array>

  private encoder = new TextEncoder()
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null

  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void

  constructor(messagesPath: string) {
    this.sessionId = crypto.randomUUID()

    this.readable = new ReadableStream<Uint8Array>({
      start: (ctrl) => {
        this.controller = ctrl
        // MCP spec: first event tells the client where to POST messages
        ctrl.enqueue(this.encode(`event: endpoint\ndata: ${messagesPath}?sessionId=${this.sessionId}\n\n`))
      },
      cancel: () => {
        sessions.delete(this.sessionId)
        this.onclose?.()
      },
    })

    sessions.set(this.sessionId, this)
  }

  // Called by the MCP SDK to start the transport — nothing to do here.
  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    this.controller?.enqueue(
      this.encode(`event: message\ndata: ${JSON.stringify(message)}\n\n`)
    )
  }

  async close(): Promise<void> {
    this.controller?.close()
    this.controller = null
    sessions.delete(this.sessionId)
    this.onclose?.()
  }

  // Called by POST /api/mcp/messages to deliver an incoming client message.
  deliver(message: JSONRPCMessage): void {
    this.onmessage?.(message)
  }

  private encode(text: string): Uint8Array {
    return this.encoder.encode(text)
  }
}
