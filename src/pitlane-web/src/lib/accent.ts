import type { CSSProperties } from 'react'

function luminance(hex: string) {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

/**
 * CSS variables that tint the interface with a team colour. Very dark
 * liveries are lifted so they still read on the graphite background, and
 * the ink colour keeps text on the accent legible.
 */
export function accentStyle(teamColour?: string): CSSProperties | undefined {
  if (!teamColour || !/^[0-9a-f]{6}$/i.test(teamColour)) return undefined
  const light = luminance(teamColour)
  const accent =
    light < 0.07
      ? `color-mix(in srgb, #${teamColour} 60%, #f1efe8)`
      : `#${teamColour}`
  return {
    '--accent': accent,
    '--accent-ink': light > 0.3 ? '#202326' : '#f7f5f0',
  } as CSSProperties
}
