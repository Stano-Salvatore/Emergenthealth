export type EmergyState = "thriving" | "happy" | "okay" | "tired" | "wilting" | "screaming"

const STATE_COLORS: Record<EmergyState, { body: string; bodyDark: string; highlight: string }> = {
  thriving:  { body: "#4ade80", bodyDark: "#16a34a", highlight: "#bbf7d0" },
  happy:     { body: "#86efac", bodyDark: "#22c55e", highlight: "#dcfce7" },
  okay:      { body: "#fde68a", bodyDark: "#f59e0b", highlight: "#fef3c7" },
  tired:     { body: "#d1d5db", bodyDark: "#9ca3af", highlight: "#f3f4f6" },
  wilting:   { body: "#fca5a5", bodyDark: "#ef4444", highlight: "#fee2e2" },
  screaming: { body: "#f87171", bodyDark: "#dc2626", highlight: "#fecaca" },
}

interface Props { state: EmergyState; size?: number }

export function EmergySVG({ state, size = 80 }: Props) {
  const c = STATE_COLORS[state]
  const isHappy = state === "thriving" || state === "happy"
  const isTired = state === "tired" || state === "wilting"
  const isScreaming = state === "screaming"

  return (
    <svg width={size} height={size} viewBox="0 0 100 120" fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{ animation: isScreaming ? "emg-shake 0.3s infinite" : isTired ? "emg-droop 3s ease-in-out infinite" : "emg-float 3s ease-in-out infinite" }}
    >
      <style>{`
        @keyframes emg-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
        @keyframes emg-droop { 0%,100%{transform:rotate(0deg)} 50%{transform:rotate(3deg)} }
        @keyframes emg-shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-2px)} 75%{transform:translateX(2px)} }
      `}</style>

      <line x1="50" y1="30" x2="50" y2="10" stroke="#16a34a" strokeWidth="3" strokeLinecap="round"/>
      {isHappy && <>
        <ellipse cx="38" cy="18" rx="10" ry="6" fill="#22c55e" transform="rotate(-30 38 18)"/>
        <ellipse cx="62" cy="14" rx="10" ry="6" fill="#16a34a" transform="rotate(20 62 14)"/>
        <ellipse cx="50" cy="8" rx="8" ry="5" fill="#4ade80" transform="rotate(-10 50 8)"/>
      </>}
      {!isHappy && !isTired && <>
        <ellipse cx="40" cy="20" rx="8" ry="5" fill="#22c55e" transform="rotate(-20 40 20)"/>
        <ellipse cx="60" cy="16" rx="8" ry="5" fill="#16a34a" transform="rotate(15 60 16)"/>
      </>}
      {isTired && <>
        <ellipse cx="42" cy="22" rx="9" ry="5" fill="#4b5563" transform="rotate(-40 42 22)"/>
        <ellipse cx="58" cy="20" rx="8" ry="4" fill="#6b7280" transform="rotate(30 58 20)"/>
      </>}

      <rect x="18" y="30" width="64" height="60" rx="10" fill={c.body}/>
      <rect x="18" y="30" width="64" height="10" rx="5" fill={c.bodyDark}/>
      <rect x="24" y="36" width="18" height="8" rx="4" fill={c.highlight} opacity="0.6"/>

      <ellipse cx="40" cy="52" rx="5" ry="6" fill="white"/>
      <ellipse cx="60" cy="52" rx="5" ry="6" fill="white"/>
      <ellipse cx="41" cy="53" rx="3" ry="3.5" fill="#1f2937"/>
      <ellipse cx="61" cy="53" rx="3" ry="3.5" fill="#1f2937"/>
      <circle cx="42.5" cy="51.5" r="1" fill="white"/>
      <circle cx="62.5" cy="51.5" r="1" fill="white"/>

      {isScreaming && <ellipse cx="50" cy="67" rx="8" ry="6" fill="#1f2937"/>}
      {isHappy && <path d="M42 65 Q50 72 58 65" stroke="#1f2937" strokeWidth="2.5" fill="none" strokeLinecap="round"/>}
      {!isScreaming && !isHappy && isTired && <line x1="42" y1="67" x2="58" y2="67" stroke="#1f2937" strokeWidth="2" strokeLinecap="round"/>}
      {!isScreaming && !isHappy && !isTired && <path d="M42 68 Q50 64 58 68" stroke="#1f2937" strokeWidth="2" fill="none" strokeLinecap="round"/>}

      {isHappy && <>
        <ellipse cx="33" cy="58" rx="5" ry="3" fill="#fb7185" opacity="0.4"/>
        <ellipse cx="67" cy="58" rx="5" ry="3" fill="#fb7185" opacity="0.4"/>
      </>}

      <rect x="5" y="45" width="14" height="8" rx="4" fill={c.bodyDark} transform="rotate(-15 5 45)"/>
      <rect x="81" y="45" width="14" height="8" rx="4" fill={c.bodyDark} transform="rotate(15 81 45)"/>

      <rect x="28" y="88" width="16" height="10" rx="5" fill={c.bodyDark}/>
      <rect x="56" y="88" width="16" height="10" rx="5" fill={c.bodyDark}/>
    </svg>
  )
}
