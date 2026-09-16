import { pool } from '@/lib/db'
import { createAgentRegistrationChallenge } from '@/lib/agent-registrations'
import { authenticateBearer } from '@/lib/oauth'
import { mcpResource } from '@/lib/config'
import { z } from 'zod'

export const schema = z.object({})

export async function execute(args: z.infer<typeof schema>, request: Request) {
  const principal = await authenticateBearer(request, 'profile', mcpResource())
  const { rows } = await pool.query(`SELECT id, registration_hash, handle_hash, controller_address, agent_address,
    scope, valid_from, expires_at, finalized_at, revoked_at, created_at FROM libro_agent_registrations
    WHERE identity_id = $1 ORDER BY created_at DESC`, [principal.identityId])
  return { registrations: rows }
}
