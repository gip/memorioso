import {
  ResourceNotFoundError,
  ResourceTemplate,
  createRequestStateCodec,
  inputRequired,
  type AuthInfo,
  type ServerContext,
} from '@modelcontextprotocol/server'
import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { z } from 'zod'
import {
  OPENSHIP_MCP_FILE_RESOURCE_TEMPLATE,
  OPENSHIP_MCP_MANIFEST_RESOURCE_URI,
  OPENSHIP_MCP_TOOL_NAME,
} from '@openship/protocol'
import { mcpResource, mcpStateSecret, serviceOrigin } from '@/lib/config'
import { sha256 } from '@/lib/crypto'
import { ServiceError } from '@/lib/errors'
import { createHumanChallenge, publicationStatus } from '@/lib/human-publications'
import { authenticateBearer, assertPrincipalScope, type OAuthPrincipal } from '@/lib/oauth'
import { getPublication, listPublications } from '@/lib/publications'
import { canonicalPublicationSignal, hashPublicationSignal, verifyLibroManifestOnChain } from '@libro/core'
import { finalizeAgentDocument, prepareAgentDocument } from '@/lib/agent-documents'
import {
  agentRegistrationStatus,
  createAgentRegistrationChallenge,
} from '@/lib/agent-registrations'
import {
  createHandleClaimChallenge,
  handleClaimStatus,
} from '@/lib/handle-claims'
import { importPublication, publicationManifest } from '@/lib/imports'
import { chainConfig } from '@/lib/chain'
import { revokeAgent } from '@/lib/agent-revocation'
import { getOpenShipSnapshot, readOpenShipFile } from '@/lib/openship'

type PublishState = {
  tool: 'publish_human'
  argumentDigest: string
  challengeId: string
  subject: string
}

type AgentRegistrationState = {
  tool: 'register_agent'
  argumentDigest: string
  registrationId: string
  subject: string
}

type HandleClaimState = {
  tool: 'claim_handle'
  requestId: string
  subject: string
}

type McpState = PublishState | AgentRegistrationState | HandleClaimState

function text(value: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true as const } : {}),
  }
}

function principal(ctx: ServerContext, scope?: string): OAuthPrincipal {
  const value = ctx.http?.authInfo?.extra?.principal as OAuthPrincipal | undefined
  if (!value) throw new ServiceError('AUTH_REQUIRED', 'OAuth authorization is required', 401)
  if (scope) assertPrincipalScope(value, scope)
  return value
}

function toolError(error: unknown) {
  if (error instanceof ServiceError) {
    return text({ error: { code: error.code, message: error.message, retryable: error.retryable } }, true)
  }
  return text({ error: { code: 'INTERNAL_ERROR', message: 'Libro could not complete the tool call', retryable: false } }, true)
}

let routeHandler: ((request: Request) => Promise<Response>) | undefined

function createHandler() {
  const stateCodec = createRequestStateCodec<McpState>({
    key: mcpStateSecret(),
    ttlSeconds: 10 * 60,
    bind: (ctx) => `${ctx.mcpReq.method}\0${ctx.http?.authInfo?.clientId || ''}`,
  })
  const handler = createMcpHandler((server) => {
    server.registerTool(OPENSHIP_MCP_TOOL_NAME, {
      description: 'Inspect the verified OpenShip Sources manifest or read one exact source file. No authentication is required.',
      inputSchema: z.discriminatedUnion('operation', [
        z.object({ operation: z.literal('manifest') }),
        z.object({ operation: z.literal('read'), path: z.string().min(1) }),
      ]),
    }, async (args) => {
      try {
        if (args.operation === 'manifest') {
          const snapshot = await getOpenShipSnapshot()
          return text({ origin: snapshot.origin, manifest: snapshot.manifest })
        }
        const { snapshot, file, content } = await readOpenShipFile(args.path)
        return text({
          origin: snapshot.origin,
          digest: snapshot.manifest.digest,
          file: file.metadata,
          content,
        })
      } catch (error) {
        return toolError(error)
      }
    })

    server.registerResource('openship-manifest', OPENSHIP_MCP_MANIFEST_RESOURCE_URI, {
      title: 'OpenShip Sources manifest',
      description: 'The complete validated manifest for this MCP server’s OpenShip source project.',
      mimeType: 'application/json',
    }, async (uri) => {
      const snapshot = await getOpenShipSnapshot()
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(snapshot.manifest, null, 2),
        }],
      }
    })

    server.registerResource(
      'openship-source-file',
      new ResourceTemplate(OPENSHIP_MCP_FILE_RESOURCE_TEMPLATE, {
        list: async () => {
          const snapshot = await getOpenShipSnapshot()
          return {
            resources: snapshot.manifest.files.map((file) => {
              const uri = new URL('openship://sources/file')
              uri.searchParams.set('path', file.path)
              return {
                uri: uri.href,
                name: file.path,
                description: `OpenShip source file from ${snapshot.manifest.digest}`,
                mimeType: file.mediaType,
                size: file.size,
              }
            }),
          }
        },
        complete: {
          path: async (value) => {
            const snapshot = await getOpenShipSnapshot()
            return snapshot.manifest.files
              .map((file) => file.path)
              .filter((path) => path.startsWith(value))
              .slice(0, 100)
          },
        },
      }),
      {
        title: 'OpenShip source file',
        description: 'One exact file from the validated OpenShip Sources snapshot.',
      },
      async (uri, variables) => {
        const path = typeof variables.path === 'string' ? variables.path : ''
        try {
          const { file, content } = await readOpenShipFile(path)
          return {
            contents: [file.metadata.encoding === 'utf-8'
              ? { uri: uri.href, mimeType: file.metadata.mediaType, text: content }
              : { uri: uri.href, mimeType: file.metadata.mediaType, blob: content }],
          }
        } catch (error) {
          if (error instanceof ServiceError && (error.code === 'INVALID_PATH' || error.code === 'NOT_FOUND')) {
            throw new ResourceNotFoundError(uri.href, error.message)
          }
          throw error
        }
      },
    )

    server.registerTool('get_publication', {
      description: 'Get a canonical Libro publication, including its complete signed body and proof.',
      inputSchema: z.object({ publicationId: z.string().min(1) }),
    }, async ({ publicationId }) => {
      try {
        const publication = await getPublication(publicationId)
        return publication ? text(publication) : text({ error: { code: 'NOT_FOUND', message: 'Publication not found', retryable: false } }, true)
      } catch (error) {
        return toolError(error)
      }
    })

    server.registerTool('list_publications', {
      description: 'List canonical Libro publication summaries.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
        authorId: z.string().uuid().optional(),
        kind: z.enum(['article', 'short', 'all']).default('all'),
      }),
    }, async (args) => {
      try {
        return text(await listPublications(args))
      } catch (error) {
        return toolError(error)
      }
    })

    server.registerTool('verify_publication', {
      description: 'Recompute the canonical signal hash for a stored Libro publication.',
      inputSchema: z.object({ publicationId: z.string().min(1) }),
    }, async ({ publicationId }) => {
      try {
        const publication = await getPublication(publicationId)
        if (!publication) return text({ error: { code: 'NOT_FOUND', message: 'Publication not found', retryable: false } }, true)
        const computed = hashPublicationSignal(canonicalPublicationSignal(publication.signal))
        const verification = await verifyLibroManifestOnChain(publicationManifest(publication), chainConfig().rpcUrls)
        return text({
          publicationId,
          signalHash: publication.signalHash,
          computedSignalHash: computed,
          canonicalPayloadMatches: computed.toLowerCase() === publication.signalHash.toLowerCase(),
          proof: publication.proof,
          verifiedBy: verification.verifiedBy,
          rpcOutcomes: verification.outcomes,
        })
      } catch (error) {
        return toolError(error)
      }
    })

    server.registerTool('whoami', {
      description: 'Return the Libro identity authorized for this OAuth token.',
    }, async (ctx) => {
      try {
        const value = principal(ctx)
        return text({ identityId: value.identityId, authorId: value.authorId, handle: value.handle, scopes: value.scope })
      } catch (error) {
        return toolError(error)
      }
    })

    server.registerTool('publish_human', {
      description: 'Create or resume a human publication. The author completes World ID signing in a Libro page.',
      inputSchema: z.object({
        publication: z.record(z.string(), z.unknown()),
        clientReference: z.string().min(1).max(256).optional(),
      }),
    }, async (args, ctx) => {
      try {
        const identity = principal(ctx, 'publish')
        const argumentDigest = sha256(JSON.stringify(args))
        const echoed = ctx.mcpReq.requestState<PublishState>()
        if (echoed) {
          if (echoed.tool !== 'publish_human' || echoed.subject !== identity.identityId || echoed.argumentDigest !== argumentDigest) {
            throw new ServiceError('INVALID_REQUEST_STATE', 'Publication request state does not match this call', 400)
          }
          const status = await publicationStatus({ principal: identity, challengeId: echoed.challengeId })
          if (status.state === 'finalized') return text(status)
          return inputRequired({ requestState: await stateCodec.mint(echoed, ctx) })
        }
        const challenge = await createHumanChallenge({
          principal: identity,
          publication: args.publication,
          clientReference: args.clientReference,
        })
        const state: PublishState = {
          tool: 'publish_human',
          argumentDigest,
          challengeId: challenge.challengeId,
          subject: identity.identityId,
        }
        const requestState = await stateCodec.mint(state, ctx)
        if (!challenge.signingUrl) return inputRequired({ requestState })
        return inputRequired({
          requestState,
          inputRequests: {
            sign: inputRequired.elicitUrl({
              url: challenge.signingUrl,
              message: `Review and sign publication ${challenge.signalHash} with World ID`,
            }),
          },
        })
      } catch (error) {
        return toolError(error)
      }
    })

    server.registerTool('publication_status', {
      description: 'Read a human publication operation using the same OAuth subject that initiated it.',
      inputSchema: z.object({ challengeId: z.string().uuid() }),
    }, async ({ challengeId }, ctx) => {
      try {
        return text(await publicationStatus({ principal: principal(ctx), challengeId }))
      } catch (error) {
        return toolError(error)
      }
    })

    server.registerTool('publish_agent_document', {
      description: 'Prepare or finalize an agent publication using EIP-712 agent-key authority. OAuth and human proof are not accepted as substitutes.',
      inputSchema: z.discriminatedUnion('stage', [
        z.object({
          stage: z.literal('prepare'),
          publication: z.record(z.string(), z.unknown()),
          documentNonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
          signedAt: z.number().int().positive(),
          signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
        }),
        z.object({
          stage: z.literal('finalize'),
          documentRegistrationId: z.string().uuid(),
          transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
          userOpHash: z.string().optional(),
          signedAt: z.number().int().positive(),
          signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
        }),
      ]),
    }, async (args) => {
      try {
        return text(args.stage === 'prepare'
          ? await prepareAgentDocument(args)
          : await finalizeAgentDocument(args))
      } catch (error) {
        return toolError(error)
      }
    })

    server.registerTool('register_agent', {
      description: 'Register an agent under the OAuth identity. A fresh registration-bound human session proof is completed on a Libro page.',
      inputSchema: z.object({
        controllerAddress: z.string(),
        agentAddress: z.string(),
        expiresAt: z.string().datetime(),
      }),
    }, async (args, ctx) => {
      try {
        const identity = principal(ctx, 'register_agent')
        const argumentDigest = sha256(JSON.stringify(args))
        const echoed = ctx.mcpReq.requestState<AgentRegistrationState>()
        if (echoed) {
          if (echoed.tool !== 'register_agent' || echoed.subject !== identity.identityId || echoed.argumentDigest !== argumentDigest) {
            throw new ServiceError('INVALID_REQUEST_STATE', 'Agent request state does not match this call', 400)
          }
          const status = await agentRegistrationStatus(identity, echoed.registrationId)
          if (status.state === 'finalized') return text(status)
          return inputRequired({ requestState: await stateCodec.mint(echoed, ctx) })
        }
        const challenge = await createAgentRegistrationChallenge({ principal: identity, ...args })
        const state: AgentRegistrationState = {
          tool: 'register_agent', argumentDigest, registrationId: challenge.registrationId, subject: identity.identityId,
        }
        return inputRequired({
          requestState: await stateCodec.mint(state, ctx),
          inputRequests: {
            sign: inputRequired.elicitUrl({
              url: challenge.signingUrl,
              message: `Review and authorize agent ${args.agentAddress} for @${identity.handle}`,
            }),
          },
        })
      } catch (error) {
        return toolError(error)
      }
    })

    server.registerTool('revoke_agent', {
      description: 'Prepare a revocation transaction for the controller wallet, or confirm its on-chain receipt. OAuth alone cannot revoke the on-chain authority.',
      inputSchema: z.object({ registrationId: z.string().uuid(), transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional() }),
    }, async (args, ctx) => {
      try { return text(await revokeAgent(principal(ctx, 'revoke_agent'), args.registrationId, args.transactionHash)) }
      catch (error) { return toolError(error) }
    })

    server.registerTool('claim_handle', {
      description: 'Claim the OAuth identity’s fixed handle on Libro using a fresh handle-bound World session proof.',
    }, async (ctx) => {
      try {
        const identity = principal(ctx, 'claim_handle')
        const echoed = ctx.mcpReq.requestState<HandleClaimState>()
        if (echoed) {
          if (echoed.tool !== 'claim_handle' || echoed.subject !== identity.identityId) {
            throw new ServiceError('INVALID_REQUEST_STATE', 'Handle request state does not match this identity', 400)
          }
          const status = await handleClaimStatus(identity, echoed.requestId)
          if (status.state === 'finalized') return text(status)
          return inputRequired({ requestState: await stateCodec.mint(echoed, ctx) })
        }
        const challenge = await createHandleClaimChallenge(identity)
        if (challenge.finalized) return text(challenge)
        const state: HandleClaimState = { tool: 'claim_handle', requestId: challenge.requestId!, subject: identity.identityId }
        return inputRequired({
          requestState: await stateCodec.mint(state, ctx),
          inputRequests: {
            sign: inputRequired.elicitUrl({ url: challenge.signingUrl!, message: `Claim @${identity.handle} with World ID` }),
          },
        })
      } catch (error) { return toolError(error) }
    })

    server.registerTool('import_publication', {
      description: 'Import an existing canonical publication after local-integrity and multi-RPC on-chain verification.',
      inputSchema: z.object({
        manifest: z.record(z.string(), z.unknown()),
        clientReference: z.string().min(1).max(256).optional(),
      }),
    }, async (args, ctx) => {
      try {
        return text(await importPublication({ principal: principal(ctx, 'import'), ...args }))
      } catch (error) {
        return toolError(error)
      }
    })
  }, {
    serverInfo: { name: 'libro', version: '1.0.0' },
    requestState: { verify: stateCodec.verify },
    maxSubscriptions: 0,
  })

  return withMcpAuth(handler, async (request, bearerToken): Promise<AuthInfo | undefined> => {
    if (!bearerToken) return undefined
    const principal = await authenticateBearer(request)
    return {
      token: bearerToken,
      clientId: principal.clientId,
      scopes: principal.scope,
      resource: new URL(principal.resource),
      extra: { principal },
    }
  }, {
    required: false,
    resourceMetadataPath: '/.well-known/oauth-protected-resource/mcp',
    resourceUrl: mcpResource(),
  })
}

async function handle(request: Request): Promise<Response> {
  routeHandler ??= createHandler()
  return routeHandler(request)
}

export { handle as GET, handle as POST }

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    },
  })
}
