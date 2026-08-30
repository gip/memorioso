import { getAgentRegistrationSigningChallenge } from '@/lib/agent-registrations'
import { AgentSigningClient } from './AgentSigningClient'

export const instant = false

export default async function AgentSigningPage({ params }: { params: Promise<{ capability: string }> }) {
  const { capability } = await params
  const row = await getAgentRegistrationSigningChallenge(capability)
  return <main><div className="card">
    <p className="muted">Libro agent authorization</p>
    <h1>Authorize an agent for @{row.handle}</h1>
    <p>Controller: {row.controller_address}</p>
    <p>Agent key: {row.agent_address}</p>
    <p>Scope: publish agent documents</p>
    <p>Valid until: {new Date(row.expires_at).toISOString()}</p>
    <p className="muted">Registration hash: {row.registration_hash}</p>
    <AgentSigningClient capability={capability} signal={row.signal} />
  </div></main>
}
