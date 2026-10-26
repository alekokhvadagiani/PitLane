export type Mode = 'live' | 'replay' | 'telemetry' | 'radio'
export type Capabilities = {
  stage: string
  modes: { id: Mode; status: string; reason: string }[]
}

export async function getCapabilities(
  signal: AbortSignal,
): Promise<Capabilities> {
  const response = await fetch('/api/capabilities', { signal })
  if (!response.ok) throw new Error(`API returned ${response.status}`)
  const data: unknown = await response.json()
  if (!isCapabilities(data)) throw new Error('Unexpected capability response')
  return data
}

function isCapabilities(value: unknown): value is Capabilities {
  if (
    !value ||
    typeof value !== 'object' ||
    !('stage' in value) ||
    typeof value.stage !== 'string' ||
    !('modes' in value) ||
    !Array.isArray(value.modes)
  )
    return false
  const ids = new Set(['live', 'replay', 'telemetry', 'radio'])
  return (
    value.modes.length === ids.size &&
    value.modes.every((mode: unknown) => {
      if (
        !mode ||
        typeof mode !== 'object' ||
        !('id' in mode) ||
        typeof mode.id !== 'string' ||
        !ids.delete(mode.id)
      )
        return false
      return (
        'status' in mode &&
        typeof mode.status === 'string' &&
        'reason' in mode &&
        typeof mode.reason === 'string'
      )
    })
  )
}
