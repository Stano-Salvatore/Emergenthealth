"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Volume2, Play, Square } from "lucide-react"
import {
  listVoices, resolveVoice, speak, stopSpeaking, speechSupported,
  getSavedVoiceUri, saveVoiceUri, getVoiceRate, saveVoiceRate,
  getAutoSpeak, saveAutoSpeak, dictationSupport, type DictationSupport,
} from "@/lib/voice"

// Which voice Emergy speaks in. The list comes from the device — a phone and a
// laptop have entirely different voices installed — so the choice is stored
// per device rather than on the account, where it would name a voice the other
// device has never heard of.

const SAMPLE = "You slept seven hours and twelve minutes. Your HRV is up on last week."

export function VoiceSettings() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[] | null>(null)
  const [selected, setSelected] = useState<string>("")
  const [rate, setRate] = useState(1)
  const [autoSpeak, setAutoSpeak] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [dictation, setDictation] = useState<DictationSupport>("unsupported")

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const list = await listVoices()
      const support = await dictationSupport()
      if (cancelled) return
      setVoices(list)
      setSelected(getSavedVoiceUri() ?? "")
      setRate(getVoiceRate())
      setAutoSpeak(getAutoSpeak())
      setDictation(support)
    })()
    return () => { cancelled = true; stopSpeaking() }
  }, [])

  function preview() {
    if (speaking) { stopSpeaking(); setSpeaking(false); return }
    const voice = resolveVoice(voices ?? [], selected || null, navigator.language)
    setSpeaking(true)
    const ok = speak(SAMPLE, { voice, rate, onEnd: () => setSpeaking(false) })
    if (!ok) setSpeaking(false)
  }

  if (!speechSupported() && dictation === "unsupported") {
    return (
      <Card>
        <CardContent className="pt-4 pb-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">🔊 Emergy&apos;s voice</p>
          <p className="text-sm text-muted-foreground">
            This device doesn&apos;t offer speech or dictation, so there&apos;s nothing to configure here.
          </p>
        </CardContent>
      </Card>
    )
  }

  // Same-language voices first: the rest are usually a long tail nobody wants.
  const lang = typeof navigator !== "undefined" ? navigator.language.slice(0, 2).toLowerCase() : "en"
  const sorted = [...(voices ?? [])].sort((a, b) => {
    const aMatch = a.lang?.toLowerCase().startsWith(lang) ? 0 : 1
    const bMatch = b.lang?.toLowerCase().startsWith(lang) ? 0 : 1
    return aMatch - bMatch || a.name.localeCompare(b.name)
  })

  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">🔊 Emergy&apos;s voice</p>
          <p className="text-xs text-muted-foreground">
            Read replies aloud and dictate instead of typing. Voices come from this device, so the choice is saved here rather than on your account.
          </p>
        </div>

        {speechSupported() && (
          <>
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <span className="text-sm">Read Emergy&apos;s replies aloud</span>
              <input
                type="checkbox"
                checked={autoSpeak}
                onChange={e => { setAutoSpeak(e.target.checked); saveAutoSpeak(e.target.checked) }}
                className="h-4 w-4 accent-primary"
              />
            </label>

            {voices === null ? (
              <div className="h-9 bg-secondary rounded-lg animate-pulse" />
            ) : sorted.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No voices installed on this device. On Android they come from the system text-to-speech engine
                (Settings → Accessibility → Text-to-speech).
              </p>
            ) : (
              <div className="space-y-1.5">
                <label className="text-[11px] text-muted-foreground">Voice</label>
                <select
                  value={selected}
                  onChange={e => { setSelected(e.target.value); saveVoiceUri(e.target.value || null) }}
                  className="w-full rounded-lg border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
                >
                  <option value="">Automatic (best match for {navigator.language})</option>
                  {sorted.map(v => (
                    <option key={v.voiceURI} value={v.voiceURI}>{v.name} · {v.lang}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-[11px] text-muted-foreground">Speed · {rate.toFixed(1)}×</label>
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.1}
                value={rate}
                onChange={e => { const r = Number(e.target.value); setRate(r); saveVoiceRate(r) }}
                className="w-full accent-primary"
              />
            </div>

            <button
              onClick={preview}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary transition-colors"
            >
              {speaking ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {speaking ? "Stop" : "Hear it"}
            </button>
          </>
        )}

        <div className="flex items-start gap-2 pt-1 border-t border-border/50">
          <Volume2 className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground leading-snug">
            {dictation === "native" && "Dictation is ready — tap the microphone in Emergy's chat."}
            {dictation === "web" && "Dictation works in this browser — tap the microphone in Emergy's chat."}
            {dictation === "unsupported" && "Dictation isn't available here. In the phone app it needs the newest APK; in a browser it needs Chrome."}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
