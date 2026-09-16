import {
  OpenShipValidationError,
  assertSafePath,
  validateMcpDiscovery,
  validateSystems,
  validateSources,
  type SourcesManifest,
  type VerifiedSourceFile,
  type VerifiedSources,
} from '@openship/protocol'
import { ServiceError } from './errors'
import { serviceOrigin } from './config'
import { getOpenshipManifest, getOpenshipBundleJson } from '../../../lib/openship/manifest'
import { composeLibroSkills, LIBRO_SKILLS_DESCRIPTION } from '../../../lib/openship/skills'
import mcpModel from './openship-system.json'

const MCP_SYSTEM_PATH = 'libro/service/lib/openship-system.json'

export const MAX_OPENSHIP_SOURCE_BYTES = 16 * 1024 * 1024

type Snapshot = {
  origin: string
  manifest: SourcesManifest
  verified: VerifiedSources
}

let cachedSnapshot: Snapshot | null = null
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

// The generated module is captured by the service build. No website request is needed,
// including on a cold instance; validate once and retain it for this process.
export async function getOpenShipSnapshot(): Promise<Snapshot> {
  if (cachedSnapshot) return cachedSnapshot
  const origin = serviceOrigin()
  try {
    const verified = validateSources(getOpenshipManifest(), JSON.parse(getOpenshipBundleJson()), {
      maxDecodedBytes: MAX_OPENSHIP_SOURCE_BYTES,
    })
    cachedSnapshot = { origin, manifest: verified.manifest, verified }
    return cachedSnapshot
  } catch (error) {
    validationError(error)
  }
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
}

export async function readOpenShipDocument(kind: 'discovery' | 'bundle' | 'systems' | 'policy' | 'skill' | 'skills'): Promise<unknown> {
  const snapshot = await getOpenShipSnapshot()
  const { verified } = snapshot
  let skills
  if (kind === 'discovery' || kind === 'skills') {
    try {
      skills = composeLibroSkills(verified.bundle.files)
    } catch (error) {
      validationError(error)
    }
  }
  if (kind === 'skills' && skills?.skills.length) return skills
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
        ...(skills?.skills.length ? {
          skills: {
            description: LIBRO_SKILLS_DESCRIPTION,
            document: { operation: 'document', kind: 'skills' },
          },
        } : {}),
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
    const path = 'skills/openship/SKILL.md'
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
