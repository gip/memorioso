import type { validateSystems } from '@openship/protocol'

export function composeOpenshipSystems(
  manifest: unknown,
  bundle: { files: Record<string, { encoding: string; content: string }> },
): ReturnType<typeof validateSystems>
