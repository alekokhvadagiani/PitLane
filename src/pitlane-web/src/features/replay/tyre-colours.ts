/** Compound colours as used in F1 broadcast graphics. */
export const COMPOUND_COLOURS: Record<string, string> = {
  SOFT: '#e8002d',
  MEDIUM: '#ffd12e',
  HARD: '#f0f0ec',
  INTERMEDIATE: '#43b02a',
  WET: '#0067ad',
}

export function compoundColour(compound: string | null | undefined) {
  return COMPOUND_COLOURS[compound?.toUpperCase() ?? ''] ?? '#6b7280'
}
