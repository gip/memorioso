import {
  OpenShipValidationError,
  assertSafePath,
  normalizeOpenShipOrigin,
  validateDiscovery,
  validateMcpDiscovery,
  validateSystems,
  validateSources,
  validateSourcesManifest,
  type DiscoveryDocument,
  type SourcesManifest,
  type VerifiedSourceFile,
  type VerifiedSources,
} from '@openship/protocol'
import { ServiceError } from './errors'
import mcpModel from './openship-system.json'

const MCP_SYSTEM_PATH = 'libro/service/lib/openship-system.json'

export const MAX_OPENSHIP_SOURCE_BYTES = 16 * 1024 * 1024

type Snapshot = {
  origin: string
  discovery: DiscoveryDocument
  manifest: SourcesManifest
  verified: VerifiedSources
}

let cachedSnapshot: Snapshot | null = null
let pendingSnapshot: Promise<Snapshot> | null = null

function sourceOrigin(): string {
  const value = process.env.OPENSHIP_SOURCE_ORIGIN
  if (!value) {
    throw new ServiceError(
      'OPENSHIP_UNAVAILABLE',
      'OPENSHIP_SOURCE_ORIGIN is not configured for this MCP server',
      503,
      true,
    )
  }
  try {
    return normalizeOpenShipOrigin(value, { allowLoopbackHttp: true })
  } catch {
    throw new ServiceError('OPENSHIP_UNAVAILABLE', 'OPENSHIP_SOURCE_ORIGIN is invalid', 503, false)
  }
}

async function fetchJson(url: string, label: string): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new ServiceError('OPENSHIP_UNAVAILABLE', `OpenShip ${label} could not be fetched`, 503, true)
  }
  if (!response.ok) {
    throw new ServiceError(
      'OPENSHIP_UNAVAILABLE',
      `OpenShip ${label} returned HTTP ${response.status}`,
      503,
      response.status >= 500,
    )
  }
  try {
    return await response.json()
  } catch {
    throw new ServiceError('OPENSHIP_INVALID', `OpenShip ${label} is not JSON`, 502, false)
  }
}

function validationError(error: unknown): never {
  if (error instanceof ServiceError) throw error
  if (error instanceof OpenShipValidationError && error.code === 'source_too_large') {
    throw new ServiceError(
      'SOURCE_TOO_LARGE',
      `OpenShip source exceeds ${MAX_OPENSHIP_SOURCE_BYTES} decoded bytes`,
      502,
      false,
    )
  }
  throw new ServiceError('OPENSHIP_INVALID', 'OpenShip source failed integrity validation', 502, false)
}

async function loadOnce(): Promise<Snapshot> {
  const origin = sourceOrigin()
  try {
    const discovery = validateDiscovery(
      await fetchJson(`${origin}/.well-known/openship.json`, 'discovery'),
    )
    const manifest = validateSourcesManifest(
      await fetchJson(discovery.capabilities.sources.manifest, 'manifest'),
    )

    if (
      cachedSnapshot &&
      cachedSnapshot.origin === origin &&
      cachedSnapshot.manifest.digest === manifest.digest &&
      JSON.stringify(cachedSnapshot.manifest.files) === JSON.stringify(manifest.files)
    ) {
      const snapshot = {
        ...cachedSnapshot,
        discovery,
        manifest,
        verified: { ...cachedSnapshot.verified, manifest },
      }
      cachedSnapshot = snapshot
      return snapshot
    }

    const bundle = await fetchJson(discovery.capabilities.sources.bundle, 'bundle')
    const verified = validateSources(manifest, bundle, {
      maxDecodedBytes: MAX_OPENSHIP_SOURCE_BYTES,
    })
    const snapshot = { origin, discovery, manifest: verified.manifest, verified }
    cachedSnapshot = snapshot
    return snapshot
  } catch (error) {
    validationError(error)
  }
}

async function loadWithDeployRaceRetry(): Promise<Snapshot> {
  try {
    return await loadOnce()
  } catch (error) {
    if (!(error instanceof ServiceError) || error.code !== 'OPENSHIP_INVALID') throw error
    return loadOnce()
  }
}

export async function getOpenShipSnapshot(): Promise<Snapshot> {
  pendingSnapshot ??= loadWithDeployRaceRetry().finally(() => {
    pendingSnapshot = null
  })
  return pendingSnapshot
}

export async function readOpenShipFile(path: string): Promise<{
  snapshot: Snapshot
  file: VerifiedSourceFile
  content: string
}> {
  try {
    assertSafePath(path, 'path')
  } catch {
    throw new ServiceError('INVALID_PATH', 'OpenShip path must be a safe repository-relative path', 400)
  }
  const snapshot = await getOpenShipSnapshot()
  const file = snapshot.verified.files.find((entry) => entry.metadata.path === path)
  if (!file) throw new ServiceError('NOT_FOUND', `No OpenShip source file exists at ${path}`, 404)
  const entry = snapshot.verified.bundle.files[path]
  return { snapshot, file, content: entry.content }
}

export function resetOpenShipSnapshotCacheForTests(): void {
  cachedSnapshot = null
  pendingSnapshot = null
}

export async function readOpenShipDocument(kind: 'discovery' | 'bundle' | 'systems' | 'policy' | 'skill'): Promise<unknown> {
  const snapshot = await getOpenShipSnapshot()
  const { discovery, verified } = snapshot
  if (kind === 'bundle') return verified.bundle
  if (kind === 'discovery') {
    return validateMcpDiscovery({
      openship: '1.0',
      capability: 'discovery',
      mcpBinding: '1.0',
      project: mcpModel.project,
      agent: {
        summary: 'OpenShip describes Libro MCP: its identity and canonical publishing service, dependencies, and verifiable sources. The source snapshot may include other applications outside this system boundary.',
        instructions: 'Call openship with agent.skill and read the returned skill before using the advertised capabilities. Read referenced skill files with the read operation.',
        skill: { operation: 'document', kind: 'skill' },
      },
      capabilities: {
        sources: {
          description: 'Retrieve the verified repository source snapshot. Files may include other components outside the Libro MCP system boundary.',
          manifest: { operation: 'manifest' },
          bundle: { operation: 'document', kind: 'bundle' },
        },
        ...(verified.bundle.files[MCP_SYSTEM_PATH] ? {
          systems: {
            description: 'Retrieve the Libro MCP system and its dependencies, with the verified source snapshot. Repository source coverage may exceed this system boundary.',
            document: { operation: 'document', kind: 'systems' },
          },
        } : {}),
      },
    })
  }
  if (kind === 'skill') {
    // Read the advertised skill from verified bytes, never from a separate HTTP response.
    const prefix = `${snapshot.origin}/openship/file/`
    if (!discovery.agent.skill.startsWith(prefix)) {
      throw new ServiceError('OPENSHIP_INVALID', 'OpenShip skill must identify a snapshot file', 502)
    }
    let path: string
    try {
      path = decodeURIComponent(discovery.agent.skill.slice(prefix.length))
      assertSafePath(path, 'skill')
    } catch {
      throw new ServiceError('OPENSHIP_INVALID', 'OpenShip skill path is invalid', 502)
    }
    const entry = verified.bundle.files[path]
    if (!entry || entry.encoding !== 'utf-8') {
      throw new ServiceError('OPENSHIP_INVALID', 'OpenShip skill is missing from the verified snapshot', 502)
    }
    return entry.content
  }
  if (kind === 'systems' && verified.bundle.files[MCP_SYSTEM_PATH]) {
    try {
      const entry = verified.bundle.files[MCP_SYSTEM_PATH]
      if (entry.encoding !== 'utf-8') throw new Error('MCP system must be UTF-8')
      return validateSystems({
        openship: '1.0',
        capability: 'systems',
        systemsVersion: '2.0',
        source: { manifest: snapshot.manifest, bundle: verified.bundle },
        system: JSON.parse(entry.content).system,
      }, { maxDecodedBytes: MAX_OPENSHIP_SOURCE_BYTES })
    } catch (error) {
      validationError(error)
    }
  }
  throw new ServiceError('NOT_FOUND', `OpenShip ${kind} is not advertised by this MCP server`, 404)
}
