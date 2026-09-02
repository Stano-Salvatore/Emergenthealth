// Pure helpers for the shape of a chat transcript sent to the model.

/**
 * A history window that starts on a user turn.
 *
 * The chat keeps the last twenty turns. Sliced blindly, that window can open
 * on an assistant turn — and a conversation handed to the API that begins
 * with the assistant is rejected outright (400), which surfaced as Emergy
 * "not answering" exactly once every twenty messages in a long thread.
 */
export function trimToUserTurn<T extends { role: "user" | "assistant" }>(history: T[]): T[] {
  const first = history.findIndex(m => m.role === "user")
  return first === -1 ? [] : history.slice(first)
}
