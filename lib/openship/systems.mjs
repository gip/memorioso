import { validateSystems } from '@openship/protocol'

// Read the design from the captured bundle, never from a second live filesystem read.
export function composeOpenshipSystems(manifest, bundle) {
  const entry = bundle.files['lib/openship/system.json']
  if (!entry || entry.encoding !== 'utf-8') throw new Error('Missing UTF-8 OpenShip system model')
  return validateSystems({
    openship: '1.0',
    capability: 'systems',
    source: { manifest, bundle },
    system: JSON.parse(entry.content),
  })
}
