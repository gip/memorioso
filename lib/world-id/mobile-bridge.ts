import { IDKit, decodeSessionBridgeResponse, hashSignal, type ConstraintNode } from '@worldcoin/idkit-core'
import { callbackUrl, type MobileFlow } from './mobile-store'

const BRIDGE = 'https://bridge.worldcoin.org'

export async function createMobileRequest(flow: MobileFlow, constraints: ConstraintNode, origin: string): Promise<string> {
  const config = { ...flow.config, return_to: origin.startsWith('https://') ? callbackUrl(flow.id, origin) : undefined }
  const builder = flow.existingSessionId
    ? IDKit.proveSession(flow.existingSessionId, config)
    : IDKit.createSession(config)
  return (await builder.constraints(constraints)).connectorURI
}

export function signalHashes(node: ConstraintNode): Record<string, string> {
  if ('type' in node) return node.signal === undefined ? {} : { [node.type]: hashSignal(node.signal) }
  const children = 'any' in node ? node.any : 'all' in node ? node.all : node.enumerate
  return Object.assign({}, ...children.map(signalHashes))
}

function bytes(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
}

/** Only the connector produced locally by IDKit is read; callback query data is never a proof. */
export async function pollMobileRequest(flow: MobileFlow, signal?: AbortSignal) {
  const connector = new URL(flow.connectorURI!)
  const id = connector.searchParams.get('i')
  const key = connector.searchParams.get('k')
  if (!id || !/^[0-9a-f-]{36}$/.test(id) || !key
    || (connector.searchParams.has('b') && connector.searchParams.get('b') !== BRIDGE)) {
    throw new Error('Invalid saved World ID request')
  }
  const timeout = AbortSignal.timeout(15_000)
  const response = await fetch(`${BRIDGE}/response/${id}`, {
    cache: 'no-store', credentials: 'omit', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  if (!response.ok) throw new Error('Could not check World ID. Try resuming verification.')
  const body = await response.json()
  if (body.status === 'initialized' || body.status === 'retrieved') return null
  if (body.status !== 'completed' || !body.response) throw new Error('Unexpected World ID response')
  const cryptoKey = await crypto.subtle.importKey('raw', bytes(key), 'AES-GCM', false, ['decrypt'])
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes(body.response.iv) }, cryptoKey, bytes(body.response.payload),
  )
  // This small pinned SDK export uses its existing WASM parser, including proof
  // encoding and session-nullifier conversion, rather than a second protocol parser.
  const result = await decodeSessionBridgeResponse(JSON.parse(new TextDecoder().decode(plaintext)), {
    nonce: flow.config.rp_context.nonce,
    environment: flow.config.environment ?? 'production',
    signal_hashes: flow.signalHashes,
    require_user_presence: flow.config.require_user_presence ?? false,
  })
  if (flow.existingSessionId && result.session_id !== flow.existingSessionId) throw new Error('World ID session does not match')
  return result
}
