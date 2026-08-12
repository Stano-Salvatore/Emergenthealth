"use client"

import { useEffect } from "react"
import type { EmergyState } from "./EmergySVG"

export type { EmergyState }

export type EmergyFit = "full" | "icon" | "bust"

// The custom element registers itself on import; React just renders the tag.
declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- augmenting React's JSX requires the namespace form
  namespace JSX {
    interface IntrinsicElements {
      "emergy-avatar": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        mood?: string
        fit?: string
        gesture?: string
      }
    }
  }
}

interface Props {
  mood: EmergyState
  /** `icon` = whole figure incl. pot in a square (nav, avatars); `full` = portrait; `bust` = head close-up — never in small square slots. */
  fit?: EmergyFit
  /** Square edge in px (icon), or width — pair with `height` for portrait slots. */
  size?: number
  height?: number
  gesture?: "wave" | "sigh" | "bob" | "shake"
  className?: string
}

/**
 * The 3D Emergy mascot. All instances on a page share one WebGL context
 * (see emergy-avatar.js), so it is cheap enough for chat rows and nav buttons.
 */
export function EmergyAvatar({ mood, fit = "icon", size, height, gesture, className }: Props) {
  useEffect(() => {
    // Register the <emergy-avatar> custom element, client-only.
    import("./emergy-avatar.js")
  }, [])

  return (
    <emergy-avatar
      mood={mood}
      fit={fit}
      gesture={gesture}
      className={className}
      style={size ? { width: size, height: height ?? size } : undefined}
    />
  )
}
