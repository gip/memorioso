import { oauthResourceMetadataUrl } from '@/lib/config'
import { z } from 'zod'
import { authorizationContext, authorize } from './oauth_authorization'
import * as oauth from './oauth_transport'
import * as health from './health'
import * as deliver_events from './deliver_events'
import type { McpServer } from '@modelcontextprotocol/server'
import { ServiceError } from '@/lib/errors'
import { assertBrowserOrigin, currentMcpRequest } from './context'
import * as identity_context from './identity_context'
import * as identity_verify from './identity_verify'
import * as identity_hint from './identity_hint'
import * as identity_handle from './identity_handle'
import * as update_profile from './update_profile'
import * as publication_counts from './publication_counts'
import * as publication_sitemap from './publication_sitemap'
import * as get_publication_by_signal from './get_publication_by_signal'
import * as get_author from './get_author'
import * as create_human_publication from './create_human_publication'
import * as list_agent_registrations from './list_agent_registrations'
import * as browser_review from './browser_review'
import * as user_operation_receipt from './user_operation_receipt'
import * as sponsorship_context from './sponsorship_context'
import * as sponsorship_verify from './sponsorship_verify'
import * as signing_context from './signing_context'
import * as signing_prepare from './signing_prepare'
import * as signing_relay from './signing_relay'
import * as signing_finalize from './signing_finalize'
import * as signing_submission from './signing_submission'
import * as agent_signing_context from './agent_signing_context'
import * as agent_signing_prepare from './agent_signing_prepare'
import * as agent_signing_relay from './agent_signing_relay'
import * as agent_signing_finalize from './agent_signing_finalize'
import * as handle_signing_context from './handle_signing_context'
import * as handle_signing_prepare from './handle_signing_prepare'
import * as handle_signing_relay from './handle_signing_relay'
import * as handle_signing_finalize from './handle_signing_finalize'

async function toolResult(operation: () => Promise<object>, browser: boolean) {
  try {
    if (browser) assertBrowserOrigin()
    const value = await operation()
    return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: { ...value } }
  } catch (error) {
    const failure = error instanceof ServiceError ? error : new ServiceError('INTERNAL_ERROR', 'Libro could not complete the tool call', 500)
    const value = { error: { code: failure.code, message: failure.message, status: failure.status, retryable: failure.retryable } }
    return { isError: true, ...(failure.status === 401 ? { _meta: { 'mcp/www_authenticate': [`Bearer resource_metadata="${oauthResourceMetadataUrl()}"`] } } : {}), content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: value }
  }
}

export function registerApplicationTools(server: McpServer): void {
  server.registerTool('oauth_authorization_context', {
    description: 'Bind a browser OAuth request to the verified identity, redirect URI, resource, scopes, and PKCE challenge.',
    inputSchema: z.object({ query: z.string() }),
  }, (args) => toolResult(() => authorizationContext(args.query), true))

  server.registerTool('oauth_authorize', {
    description: 'Complete a bound browser OAuth request and return its redirect URL.',
    inputSchema: z.object({ consent: z.string().min(1), decision: z.literal('deny').optional() }),
  }, (args) => toolResult(() => authorize(args.consent, args.decision), true))

  server.registerTool('oauth_register', {
    description: 'Register an untrusted public OAuth client. Registration grants no author namespace or identity authority.',
    inputSchema: oauth.registerSchema,
  }, (args) => toolResult(() => oauth.registerClient(args), false))

  server.registerTool('oauth_token', {
    description: 'Exchange an authorization code with PKCE or rotate a refresh token using the client credentials.',
    inputSchema: oauth.formSchema,
  }, (args) => toolResult(() => oauth.token(currentMcpRequest(), args), false))

  server.registerTool('oauth_revoke', {
    description: 'Revoke a token after authenticating its owning OAuth client.',
    inputSchema: oauth.formSchema,
  }, (args) => toolResult(() => oauth.revoke(currentMcpRequest(), args), false))

  server.registerTool('health', {
    description: 'Check Libro availability and whether canonical writes are enabled.',
    inputSchema: health.schema,
  }, () => toolResult(() => health.execute(), false))

  server.registerTool('deliver_events', {
    description: 'Deliver pending webhook events. Requires the internal operations credential, not an OAuth user token.',
    inputSchema: deliver_events.schema,
  }, () => toolResult(() => deliver_events.execute(currentMcpRequest()), false))

  server.registerTool('identity_context', {
    description: 'Start a World ID login or signup proof.',
    inputSchema: identity_context.schema,
  }, (args) => toolResult(() => identity_context.execute(args, currentMcpRequest()), true))

  server.registerTool('identity_verify', {
    description: 'Verify a World ID proof and establish the browser identity session.',
    inputSchema: identity_verify.schema,
  }, (args) => toolResult(() => identity_verify.execute(args), true))

  server.registerTool('identity_hint', {
    description: 'Read the remembered browser identity hint; a hint does not authenticate.',
    inputSchema: identity_hint.schema,
  }, (args) => toolResult(() => identity_hint.execute(args), true))

  server.registerTool('identity_handle', {
    description: 'Check handle availability and whether it has a login identity.',
    inputSchema: identity_handle.schema,
  }, (args) => toolResult(() => identity_handle.execute(args), false))

  server.registerTool('update_profile', {
    description: 'Update the OAuth author profile and notify connected clients.',
    inputSchema: update_profile.schema,
  }, (args) => toolResult(() => update_profile.execute(args, currentMcpRequest()), false))

  server.registerTool('publication_counts', {
    description: 'Count an author\u2019s publications belonging to the authenticated service client.',
    inputSchema: publication_counts.schema,
  }, (args) => toolResult(() => publication_counts.execute(args, currentMcpRequest()), false))

  server.registerTool('publication_sitemap', {
    description: 'List sitemap entries belonging to the authenticated service client.',
    inputSchema: publication_sitemap.schema,
  }, (args) => toolResult(() => publication_sitemap.execute(args, currentMcpRequest()), false))

  server.registerTool('get_publication_by_signal', {
    description: 'Get a canonical publication by its signal hash.',
    inputSchema: get_publication_by_signal.schema,
  }, (args) => toolResult(() => get_publication_by_signal.execute(args), false))

  server.registerTool('get_author', {
    description: 'Get a canonical author by ID or handle.',
    inputSchema: get_author.schema,
  }, (args) => toolResult(() => get_author.execute(args), false))

  server.registerTool('create_human_publication', {
    description: 'Create a human publication challenge and return its signing URL for a browser client.',
    inputSchema: create_human_publication.schema,
  }, (args) => toolResult(() => create_human_publication.execute(args, currentMcpRequest()), false))

  server.registerTool('list_agent_registrations', {
    description: 'List the current OAuth identity\u2019s registered agents.',
    inputSchema: list_agent_registrations.schema,
  }, (args) => toolResult(() => list_agent_registrations.execute(args, currentMcpRequest()), false))

  server.registerTool('browser_review', {
    description: 'Review a signing request belonging to the authenticated browser identity.',
    inputSchema: browser_review.schema,
  }, (args) => toolResult(() => browser_review.execute(args), true))

  server.registerTool('user_operation_receipt', {
    description: 'Resolve a World wallet operation to its transaction hash, or report pending.',
    inputSchema: user_operation_receipt.schema,
  }, (args) => toolResult(() => user_operation_receipt.execute(args), false))

  server.registerTool('sponsorship_context', {
    description: 'Start a browser gas sponsorship proof.',
    inputSchema: sponsorship_context.schema,
  }, (args) => toolResult(() => sponsorship_context.execute(args, currentMcpRequest()), true))

  server.registerTool('sponsorship_verify', {
    description: 'Verify a browser gas sponsorship proof.',
    inputSchema: sponsorship_verify.schema,
  }, (args) => toolResult(() => sponsorship_verify.execute(args), true))

  server.registerTool('signing_context', {
    description: 'Context the signing operation, bound to its browser identity and signing capability.',
    inputSchema: signing_context.schema,
  }, (args) => toolResult(() => signing_context.execute(args, currentMcpRequest()), true))

  server.registerTool('signing_prepare', {
    description: 'Prepare the signing operation, bound to its browser identity and signing capability.',
    inputSchema: signing_prepare.schema,
  }, (args) => toolResult(() => signing_prepare.execute(args), true))

  server.registerTool('signing_relay', {
    description: 'Relay the signing operation, bound to its browser identity and signing capability.',
    inputSchema: signing_relay.schema,
  }, (args) => toolResult(() => signing_relay.execute(args), true))

  server.registerTool('signing_finalize', {
    description: 'Finalize the signing operation, bound to its browser identity and signing capability.',
    inputSchema: signing_finalize.schema,
  }, (args) => toolResult(() => signing_finalize.execute(args), true))

  server.registerTool('signing_submission', {
    description: 'Submission the signing operation, bound to its browser identity and signing capability.',
    inputSchema: signing_submission.schema,
  }, (args) => toolResult(() => signing_submission.execute(args), true))

  server.registerTool('agent_signing_context', {
    description: 'Context the agent signing operation, bound to its browser identity and signing capability.',
    inputSchema: agent_signing_context.schema,
  }, (args) => toolResult(() => agent_signing_context.execute(args, currentMcpRequest()), true))

  server.registerTool('agent_signing_prepare', {
    description: 'Prepare the agent signing operation, bound to its browser identity and signing capability.',
    inputSchema: agent_signing_prepare.schema,
  }, (args) => toolResult(() => agent_signing_prepare.execute(args), true))

  server.registerTool('agent_signing_relay', {
    description: 'Relay the agent signing operation, bound to its browser identity and signing capability.',
    inputSchema: agent_signing_relay.schema,
  }, (args) => toolResult(() => agent_signing_relay.execute(args), true))

  server.registerTool('agent_signing_finalize', {
    description: 'Finalize the agent signing operation, bound to its browser identity and signing capability.',
    inputSchema: agent_signing_finalize.schema,
  }, (args) => toolResult(() => agent_signing_finalize.execute(args), true))

  server.registerTool('handle_signing_context', {
    description: 'Context the handle signing operation, bound to its browser identity and signing capability.',
    inputSchema: handle_signing_context.schema,
  }, (args) => toolResult(() => handle_signing_context.execute(args, currentMcpRequest()), true))

  server.registerTool('handle_signing_prepare', {
    description: 'Prepare the handle signing operation, bound to its browser identity and signing capability.',
    inputSchema: handle_signing_prepare.schema,
  }, (args) => toolResult(() => handle_signing_prepare.execute(args), true))

  server.registerTool('handle_signing_relay', {
    description: 'Relay the handle signing operation, bound to its browser identity and signing capability.',
    inputSchema: handle_signing_relay.schema,
  }, (args) => toolResult(() => handle_signing_relay.execute(args), true))

  server.registerTool('handle_signing_finalize', {
    description: 'Finalize the handle signing operation, bound to its browser identity and signing capability.',
    inputSchema: handle_signing_finalize.schema,
  }, (args) => toolResult(() => handle_signing_finalize.execute(args), true))

}
