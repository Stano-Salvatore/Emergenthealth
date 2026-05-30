"use client"

export type EmergyState = "thriving" | "happy" | "okay" | "tired" | "wilting" | "screaming"

const STATE_COLORS: Record<EmergyState, { body: string; bodyDark: string; bodyHighlight: string }> = {
  thriving:  { body: "#A8D5A2", bodyDark: "#7CB87A", bodyHighlight: "#C8ECC4" },
  happy:     { body: "#B2DFB0", bodyDark: "#82C47E", bodyHighlight: "#D0EED0" },
  okay:      { body: "#C5D5C2", bodyDark: "#90A88D", bodyHighlight: "#DDE8D8" },
  tired:     { body: "#C0CCC0", bodyDark: "#8FA08A", bodyHighlight: "#D8E0D4" },
  wilting:   { body: "#D4BFB8", bodyDark: "#A88880", bodyHighlight: "#E8D4CC" },
  screaming: { body: "#F5B8A0", bodyDark: "#D07855", bodyHighlight: "#FAD4C0" },
}

export function EmergySVG({ state, size = 80 }: { state: EmergyState; size?: number }) {
  const isThrive = state === "thriving"
  const isHappy  = state === "happy" || isThrive
  const isTired  = state === "tired"
  const isWilt   = state === "wilting"
  const isScream = state === "screaming"
  const { body, bodyDark, bodyHighlight } = STATE_COLORS[state]

  const anim = isScream
    ? "emg-shake 0.35s ease-in-out infinite"
    : isThrive
    ? "emg-float 2.8s ease-in-out infinite"
    : isTired || isWilt
    ? "emg-droop 4s ease-in-out infinite"
    : "emg-sway 4s ease-in-out infinite"

  // Arm rotation per state
  const lArmR = isScream ? -65 : isThrive ? -45 : isWilt ? 25 : isHappy ? -25 : -10
  const rArmR = isScream ? 65  : isThrive ? 45  : isWilt ? -25 : isHappy ? 25  : 10

  return (
    <svg viewBox="0 0 100 118" width={size} height={size * 1.18} style={{ overflow: "visible" }}>
      <defs>
        <style>{`
          @keyframes emg-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
          @keyframes emg-sway  { 0%,100%{transform:rotate(0deg);transform-origin:50px 96px} 45%{transform:rotate(3deg);transform-origin:50px 96px} 70%{transform:rotate(-2deg);transform-origin:50px 96px} }
          @keyframes emg-droop { 0%,100%{transform:rotate(0deg);transform-origin:50px 96px} 50%{transform:rotate(2deg);transform-origin:50px 96px} }
          @keyframes emg-shake { 0%,100%{transform:rotate(0deg)} 20%{transform:rotate(-7deg)} 50%{transform:rotate(7deg)} 80%{transform:rotate(-5deg)} }
          @keyframes emg-sp    { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.3;transform:scale(0.5)} }
          @keyframes emg-zzz   { 0%{opacity:0;transform:translate(0,0)scale(0.5)} 30%,70%{opacity:0.9} 100%{opacity:0;transform:translate(4px,-22px)scale(1.1)} }
          .emg-sp1{animation:emg-sp 1.4s infinite 0s}
          .emg-sp2{animation:emg-sp 1.4s infinite 0.47s}
          .emg-sp3{animation:emg-sp 1.4s infinite 0.94s}
          .emg-z1 {animation:emg-zzz 2.4s infinite 0s}
          .emg-z2 {animation:emg-zzz 2.4s infinite 0.8s}
          .emg-z3 {animation:emg-zzz 2.4s infinite 1.6s}
        `}</style>
      </defs>

      <g style={{ animation: anim }}>

        {/* ── PLANTS ────────────────────────────────── */}
        {/* Center stem */}
        <path
          d={isWilt ? "M50 47 Q46 35 44 22" : "M50 47 Q54 33 50 18"}
          stroke="#3D8B40" strokeWidth="3.5" fill="none" strokeLinecap="round"
        />

        {/* Side stems */}
        {!isWilt && (
          <>
            <path d={`M50 47 Q${isScream ? 28 : 36} ${isScream ? 24 : 34} ${isScream ? 22 : 28} 28`}
                  stroke="#3D8B40" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
            <path d={`M50 47 Q${isScream ? 72 : 64} ${isScream ? 24 : 34} ${isScream ? 78 : 72} 28`}
                  stroke="#3D8B40" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
          </>
        )}
        {isWilt && (
          <path d="M50 47 Q38 38 32 42" stroke="#3D8B40" strokeWidth="2" fill="none" strokeLinecap="round"/>
        )}

        {/* ── Thriving: flowers */}
        {isThrive && (
          <>
            {/* Center flower */}
            {[0,60,120,180,240,300].map(a => {
              const r = a * Math.PI / 180
              return <ellipse key={a} cx={50 + Math.cos(r)*8} cy={14 + Math.sin(r)*8}
                rx="5" ry="3" fill="#FFB3D1"
                transform={`rotate(${a} ${50 + Math.cos(r)*8} ${14 + Math.sin(r)*8})`}/>
            })}
            <circle cx="50" cy="14" r="5" fill="#FFD700"/>
            {/* Side leaves + small flowers */}
            <ellipse cx="26" cy="25" rx="8" ry="4" fill="#56C45E" transform="rotate(-45 26 25)"/>
            <ellipse cx="74" cy="25" rx="8" ry="4" fill="#56C45E" transform="rotate(45 74 25)"/>
            <circle cx="22" cy="22" r="4" fill="#FFB3D1"/>
            <circle cx="78" cy="22" r="4" fill="#FFB3D1"/>
          </>
        )}

        {/* ── Happy/okay: leaves */}
        {(isHappy || state === "okay") && !isThrive && (
          <>
            <ellipse cx="50" cy="16" rx="7" ry="10" fill="#47A84B"/>
            <ellipse cx="50" cy="14" rx="5" ry="7" fill="#5AC55E"/>
            <ellipse cx="28" cy="26" rx="8" ry="4" fill="#47A84B" transform="rotate(-40 28 26)"/>
            <ellipse cx="72" cy="26" rx="8" ry="4" fill="#47A84B" transform="rotate(40 72 26)"/>
          </>
        )}

        {/* ── Tired: droopy leaves */}
        {isTired && (
          <>
            <ellipse cx="50" cy="20" rx="6" ry="9" fill="#5CAF60"/>
            <ellipse cx="32" cy="30" rx="8" ry="3.5" fill="#5CAF60" transform="rotate(-20 32 30)"/>
            <ellipse cx="68" cy="30" rx="8" ry="3.5" fill="#5CAF60" transform="rotate(20 68 30)"/>
          </>
        )}

        {/* ── Wilting: bent sad plants */}
        {isWilt && (
          <>
            <ellipse cx="44" cy="21" rx="5" ry="8" fill="#7CB87E" transform="rotate(25 44 21)"/>
            <ellipse cx="32" cy="40" rx="6" ry="3" fill="#7CB87E" transform="rotate(-15 32 40)"/>
          </>
        )}

        {/* ── Screaming: wild splayed leaves */}
        {isScream && (
          <>
            <ellipse cx="50" cy="16" rx="6" ry="11" fill="#47A84B"/>
            <ellipse cx="22" cy="20" rx="9" ry="4" fill="#47A84B" transform="rotate(-65 22 20)"/>
            <ellipse cx="78" cy="20" rx="9" ry="4" fill="#47A84B" transform="rotate(65 78 20)"/>
          </>
        )}

        {/* ── POT FEET ────────────────────────────── */}
        <rect x="27" y="95" width="16" height="13" rx="7" fill={bodyDark}/>
        <rect x="57" y="95" width="16" height="13" rx="7" fill={bodyDark}/>

        {/* ── POT BODY ────────────────────────────── */}
        <rect x="15" y="46" width="70" height="52" rx="14" fill={body}/>
        {/* Highlight panel */}
        <rect x="20" y="51" width="60" height="42" rx="11" fill="none" stroke={bodyHighlight} strokeWidth="2" opacity="0.7"/>
        {/* Subtle bottom shadow */}
        <rect x="15" y="82" width="70" height="16" rx="14" fill={bodyDark} opacity="0.2"/>

        {/* ── ARMS ────────────────────────────────── */}
        <rect x="1"  y="57" width="17" height="12" rx="6" fill={body}
              transform={`rotate(${lArmR} 9 63)`}/>
        <rect x="82" y="57" width="17" height="12" rx="6" fill={body}
              transform={`rotate(${rArmR} 91 63)`}/>
        {/* Arm highlights */}
        <rect x="3"  y="59" width="13" height="8" rx="4" fill={bodyHighlight} opacity="0.5"
              transform={`rotate(${lArmR} 9 63)`}/>
        <rect x="84" y="59" width="13" height="8" rx="4" fill={bodyHighlight} opacity="0.5"
              transform={`rotate(${rArmR} 91 63)`}/>

        {/* ── EYES ────────────────────────────────── */}
        {/* Whites */}
        <circle cx="38" cy="68" r={isScream ? 8 : 6.5} fill="white"/>
        <circle cx="62" cy="68" r={isScream ? 8 : 6.5} fill="white"/>
        {/* Tired eyelids */}
        {isTired && (
          <>
            <path d="M31.5 68 Q38 61 44.5 68" fill={body}/>
            <path d="M55.5 68 Q62 61 68.5 68" fill={body}/>
          </>
        )}
        {/* Pupils */}
        <circle cx={39}  cy={isTired ? 70 : 68.5} r={isScream ? 4 : 3} fill="#1C3A1C"/>
        <circle cx={63}  cy={isTired ? 70 : 68.5} r={isScream ? 4 : 3} fill="#1C3A1C"/>
        {/* Shines */}
        <circle cx={40.5} cy={isTired ? 68.5 : 67} r="1.3" fill="white"/>
        <circle cx={64.5} cy={isTired ? 68.5 : 67} r="1.3" fill="white"/>

        {/* ── BLUSH ───────────────────────────────── */}
        {isHappy && (
          <>
            <ellipse cx="27" cy="77" rx="5.5" ry="3.5" fill="#FF9090" opacity="0.4"/>
            <ellipse cx="73" cy="77" rx="5.5" ry="3.5" fill="#FF9090" opacity="0.4"/>
          </>
        )}

        {/* ── MOUTH ───────────────────────────────── */}
        {isThrive && (
          <path d="M39 81 Q50 91 61 81" fill="none" stroke="#1C3A1C" strokeWidth="2.5" strokeLinecap="round"/>
        )}
        {state === "happy" && (
          <path d="M40 80 Q50 88 60 80" fill="none" stroke="#1C3A1C" strokeWidth="2.2" strokeLinecap="round"/>
        )}
        {state === "okay" && (
          <line x1="41" y1="80" x2="59" y2="80" stroke="#1C3A1C" strokeWidth="2" strokeLinecap="round"/>
        )}
        {isTired && (
          <path d="M41 82 Q50 78 59 82" fill="none" stroke="#1C3A1C" strokeWidth="2" strokeLinecap="round"/>
        )}
        {isWilt && (
          <>
            <path d="M41 83 Q50 77 59 83" fill="none" stroke="#1C3A1C" strokeWidth="2" strokeLinecap="round"/>
            {/* Tear drop */}
            <path d="M38 72 Q35.5 77.5 38 82 Q40.5 77.5 38 72" fill="#7EC8E3"/>
          </>
        )}
        {isScream && (
          <ellipse cx="50" cy="82" rx="9" ry="11" fill="#B03030"/>
        )}

        {/* ── EXTRAS ──────────────────────────────── */}
        {/* Thriving sparkles */}
        {isThrive && (
          <>
            <text x="6"  y="44" fontSize="12" className="emg-sp1">✨</text>
            <text x="80" y="40" fontSize="10" className="emg-sp2">✨</text>
            <text x="10" y="58" fontSize="8"  className="emg-sp3">⭐</text>
          </>
        )}
        {/* Screaming !!! */}
        {isScream && (
          <>
            <text x="16" y="48" fontSize="18" fontWeight="900" fill="#FF3B30">!</text>
            <text x="27" y="35" fontSize="20" fontWeight="900" fill="#FF3B30">!</text>
            <text x="70" y="44" fontSize="16" fontWeight="900" fill="#FF3B30">!</text>
          </>
        )}
        {/* Tired zzz */}
        {isTired && (
          <>
            <text x="63" y="42" fontSize="9"  fill="#999" className="emg-z1">z</text>
            <text x="68" y="34" fontSize="11" fill="#aaa" className="emg-z2">z</text>
            <text x="74" y="25" fontSize="13" fill="#bbb" className="emg-z3">Z</text>
          </>
        )}
        {/* Wilting small sweat drops */}
        {isWilt && (
          <>
            <circle cx="50" cy="34" r="2.5" fill="#7EC8E3" opacity="0.55"/>
            <circle cx="43" cy="30" r="1.5" fill="#7EC8E3" opacity="0.4"/>
            <circle cx="57" cy="32" r="2"   fill="#7EC8E3" opacity="0.45"/>
          </>
        )}

      </g>
    </svg>
  )
}
