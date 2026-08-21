// Talking to Emergy, and Emergy talking back.
//
// Three engines, because no single one covers both surfaces this app runs on:
//
//   Dictation, native app — @capacitor-community/speech-recognition. The
//     browser's SpeechRecognition is NOT available inside an Android WebView:
//     it needs Chrome's own speech service, which the WebView does not expose.
//     Without the plugin, dictation in the APK would simply never fire, which
//     is exactly the class of silent failure this project has spent its time
//     removing. The plugin ships in the APK, so an older APK reports
//     unavailable and the UI says so instead of pretending.
//   Dictation, web — the browser SpeechRecognition API.
//   Speech — window.speechSynthesis, which both surfaces do have. Voices come
//     from the device, so the chosen voice is stored per device rather than on
//     the account: a name picked on a phone means nothing on a laptop.

import { Capacitor } from "@capacitor/core"
import { SpeechRecognition } from "@capacitor-community/speech-recognition"
import type { PluginListenerHandle } from "@capacitor/core"

const VOICE_PREF_KEY = "emergy_voice_uri"
const RATE_PREF_KEY = "emergy_voice_rate"
const AUTOSPEAK_PREF_KEY = "emergy_autospeak"

export type DictationSupport = "native" | "web" | "unsupported"

/* ────────────────────────────── Dictation ────────────────────────────── */

function webRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null
}

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((e: { error?: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

/** What this device can actually do, checked rather than assumed. */
export async function dictationSupport(): Promise<DictationSupport> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { available } = await SpeechRecognition.available()
      return available ? "native" : "unsupported"
    } catch {
      // Plugin missing from this APK build.
      return "unsupported"
    }
  }
  return webRecognition() ? "web" : "unsupported"
}

export type DictationHandle = { stop: () => void }

/**
 * Listen once and hand back what was said. `onPartial` fires as the words
 * arrive so the user can see it working — silence with no feedback is
 * indistinguishable from a broken microphone.
 */
export async function startDictation(opts: {
  lang?: string
  onPartial?: (text: string) => void
  onFinal: (text: string) => void
  onError: (message: string) => void
}): Promise<DictationHandle | null> {
  const support = await dictationSupport()
  const lang = opts.lang || (typeof navigator !== "undefined" ? navigator.language : "en-US") || "en-US"

  if (support === "unsupported") {
    opts.onError(
      Capacitor.isNativePlatform()
        ? "This app build can't do dictation yet — it needs the newest APK."
        : "This browser can't do dictation. Chrome supports it."
    )
    return null
  }

  if (support === "native") {
    try {
      const perm = await SpeechRecognition.requestPermissions()
      if (perm.speechRecognition !== "granted") {
        opts.onError("Microphone permission is off — turn it on in Android Settings → Apps → Emergenthealth.")
        return null
      }
      // How this plugin actually behaves, from its own docs: with
      // partialResults on, start() "respond[s] directly without result" — it
      // resolves immediately and empty, and every word arrives through the
      // partialResults event instead, until something stops it.
      //
      // Reading start()'s resolution as the end of speech is therefore wrong
      // twice over: onFinal never fires, and tearing the listeners down in
      // that .then() removes them before the first word is spoken. The mic
      // listens and nothing ever appears.
      //
      // So: listeners first, then start; the latest partial is the answer, and
      // listeningState says when speech is over.
      let settled = false
      let latest = ""

      // Collected in a list so cleanup never closes over a binding that might
      // not be initialised yet, and so only this call's listeners are removed
      // — removeAllListeners() would tear down anyone else's too.
      const handles: PluginListenerHandle[] = []
      const cleanup = () => {
        while (handles.length) void handles.pop()?.remove().catch(() => {})
      }

      handles.push(await SpeechRecognition.addListener("partialResults", (data: { matches?: string[] }) => {
        const text = data?.matches?.[0]
        if (!text) return
        latest = text
        opts.onPartial?.(text)
      }))

      // Idempotent: whichever of the stop event and the stop() call lands
      // first finishes the job, and the other becomes a no-op.
      const finish = () => {
        if (settled) return
        settled = true
        if (graceTimer) clearTimeout(graceTimer)
        cleanup()
        if (latest) opts.onFinal(latest)
        else opts.onError("Didn't catch that — nothing was heard.")
      }

      // Android emits end-of-speech before it delivers the polished result:
      // onEndOfSpeech() fires "stopped", and onResults() — which with
      // partialResults on is also sent through the partialResults event —
      // arrives after it. Finishing the instant "stopped" lands would settle
      // on the last rough partial and throw the real answer away, so the
      // window stays open a moment longer for it.
      let graceTimer: ReturnType<typeof setTimeout> | null = null
      const finishAfterFinalResult = () => {
        if (settled || graceTimer) return
        graceTimer = setTimeout(finish, 700)
      }

      handles.push(await SpeechRecognition.addListener("listeningState", (data: { status?: string }) => {
        if (data?.status === "stopped") finishAfterFinalResult()
      }))

      SpeechRecognition.start({ language: lang, partialResults: true, popup: false, maxResults: 1 })
        .catch(() => {
          if (settled) return
          settled = true
          cleanup()
          opts.onError("Dictation stopped unexpectedly.")
        })

      return {
        // stop() makes the native side emit listeningState "stopped", which
        // finishes. finish() is called anyway in case that event never lands,
        // so pressing stop always resolves to something.
        stop: () => {
          // Same grace window: the final result may still be in flight.
          void SpeechRecognition.stop().catch(() => {}).finally(() => finishAfterFinalResult())
        },
      }
    } catch {
      opts.onError("Couldn't start dictation.")
      return null
    }
  }

  const Ctor = webRecognition()
  if (!Ctor) { opts.onError("This browser can't do dictation."); return null }
  const rec = new Ctor()
  rec.lang = lang
  rec.continuous = false
  rec.interimResults = true
  rec.onresult = e => {
    const parts: string[] = []
    for (let i = 0; i < e.results.length; i++) parts.push(e.results[i][0]?.transcript ?? "")
    const text = parts.join(" ").trim()
    if (text) opts.onPartial?.(text)
  }
  rec.onerror = e => {
    opts.onError(e?.error === "not-allowed"
      ? "Microphone permission was denied."
      : "Dictation stopped unexpectedly.")
  }
  rec.onend = () => { /* final text already delivered through onPartial */ }
  try {
    rec.start()
  } catch {
    opts.onError("Couldn't start dictation.")
    return null
  }
  return { stop: () => { try { rec.stop() } catch { /* already stopped */ } } }
}

/* ─────────────────────────────── Speech ──────────────────────────────── */

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window
}

/**
 * The device's voices. Chrome populates the list asynchronously, so a caller
 * that reads it once on mount usually gets nothing — this waits for the
 * voiceschanged event, with a ceiling so a device that never fires it doesn't
 * hang the settings page forever.
 */
export function listVoices(timeoutMs = 2000): Promise<SpeechSynthesisVoice[]> {
  if (!speechSupported()) return Promise.resolve([])
  const existing = window.speechSynthesis.getVoices()
  if (existing.length > 0) return Promise.resolve(existing)
  return new Promise(resolve => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      window.speechSynthesis.onvoiceschanged = null
      resolve(window.speechSynthesis.getVoices())
    }
    window.speechSynthesis.onvoiceschanged = finish
    setTimeout(finish, timeoutMs)
  })
}

/**
 * The voice to use: the one chosen on this device if it is still installed,
 * otherwise the best match for the app's language, otherwise the default.
 * Voices come and go with system updates, so a saved name is a preference and
 * never a guarantee.
 */
export function resolveVoice(voices: SpeechSynthesisVoice[], savedUri: string | null, lang: string): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null
  if (savedUri) {
    const saved = voices.find(v => v.voiceURI === savedUri)
    if (saved) return saved
  }
  const want = (lang || "en").toLowerCase().replace("_", "-")
  const base = want.slice(0, 2)
  return (
    // An exact locale beats a same-language default: sk-SK and en-GB are the
    // point of choosing them, and a US default should not swallow either.
    voices.find(v => v.lang?.toLowerCase().replace("_", "-") === want) ??
    voices.find(v => v.lang?.toLowerCase().startsWith(base) && v.default) ??
    voices.find(v => v.lang?.toLowerCase().startsWith(base)) ??
    voices.find(v => v.default) ??
    voices[0]
  )
}

/** Markdown and emoji read aloud as punctuation soup; strip them first. */
export function speakableText(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__|\*|_|~~)/g, "")
    .replace(/^\s*[-•*]\s+/gm, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    // Line breaks included: read aloud they are just gaps, and leaving them in
    // makes the output impossible to compare or test.
    .replace(/\s+/g, " ")
    .trim()
}

export function speak(text: string, opts?: { voice?: SpeechSynthesisVoice | null; rate?: number; onEnd?: () => void }): boolean {
  if (!speechSupported()) return false
  const body = speakableText(text)
  if (!body) return false
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(body)
  if (opts?.voice) { u.voice = opts.voice; u.lang = opts.voice.lang }
  u.rate = Math.max(0.5, Math.min(2, opts?.rate ?? 1))
  if (opts?.onEnd) { u.onend = opts.onEnd; u.onerror = opts.onEnd }
  window.speechSynthesis.speak(u)
  return true
}

export function stopSpeaking(): void {
  if (speechSupported()) window.speechSynthesis.cancel()
}

/* ───────────────────────── Per-device preferences ────────────────────── */
// Stored on the device, not the account: the voices installed on a phone say
// nothing about the ones on a laptop, so syncing the choice would break it.

export function getSavedVoiceUri(): string | null {
  try { return localStorage.getItem(VOICE_PREF_KEY) } catch { return null }
}
export function saveVoiceUri(uri: string | null): void {
  try {
    if (uri) localStorage.setItem(VOICE_PREF_KEY, uri)
    else localStorage.removeItem(VOICE_PREF_KEY)
  } catch { /* private mode */ }
}
export function getVoiceRate(): number {
  try {
    const raw = Number(localStorage.getItem(RATE_PREF_KEY))
    return Number.isFinite(raw) && raw >= 0.5 && raw <= 2 ? raw : 1
  } catch { return 1 }
}
export function saveVoiceRate(rate: number): void {
  try { localStorage.setItem(RATE_PREF_KEY, String(Math.max(0.5, Math.min(2, rate)))) } catch { /* private mode */ }
}
export function getAutoSpeak(): boolean {
  try { return localStorage.getItem(AUTOSPEAK_PREF_KEY) === "true" } catch { return false }
}
export function saveAutoSpeak(on: boolean): void {
  try { localStorage.setItem(AUTOSPEAK_PREF_KEY, String(on)) } catch { /* private mode */ }
}
