import { NextAuthOptions } from "next-auth";
import PostgresAdapter from "@auth/pg-adapter";
import CredentialsProvider from "next-auth/providers/credentials";
import { Pool } from "pg";
import type { IDKitResult } from "@worldcoin/idkit";
import { WORLD_ID_AUTH_NONCE_COOKIE } from "@/lib/world-id/constants";
import { getWorldIdServerConfig, verifyWorldIdProof } from "@/lib/world-id/server";
import { validateSessionCredentialResponses, validateWorldIdSessionResult } from "@/lib/world-id/proof";
 
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // max: 20,
  // idleTimeoutMillis: 30000,
  // connectionTimeoutMillis: 2000,
});

function getCookieValue(cookieHeader: string | string[] | undefined, name: string): string | null {
  const cookie = Array.isArray(cookieHeader) ? cookieHeader.join("; ") : cookieHeader
  if (!cookie) {
    return null
  }

  const value = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1)

  return value ? decodeURIComponent(value) : null
}

export const authOptions: NextAuthOptions = {
  adapter: PostgresAdapter(pool),
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: "jwt",
  },
  providers: [
    CredentialsProvider({
      id: "world-id",
      name: "World ID",
      credentials: {
        payload: { label: "World ID session proof", type: "text" },
        nonce: { label: "Nonce", type: "text" },
      },
      async authorize(credentials, req) {
        const payloadRaw = credentials?.payload
        const nonce = credentials?.nonce
        const cookieNonce = getCookieValue(req.headers?.cookie, WORLD_ID_AUTH_NONCE_COOKIE)

        if (!payloadRaw || !nonce || !cookieNonce || nonce !== cookieNonce) {
          return null
        }

        let config
        let idkitResult
        let validatedResult
        try {
          config = getWorldIdServerConfig()
          idkitResult = JSON.parse(payloadRaw) as IDKitResult
          validatedResult = validateWorldIdSessionResult(idkitResult, {
            nonce,
            environment: config.environment,
          })
        } catch {
          return null
        }

        const verifyRes = await verifyWorldIdProof(validatedResult, config.rpId)
        if (!verifyRes.ok) {
          return null
        }

        const credentialIdentifiers = validateSessionCredentialResponses(validatedResult.responses)
        const subject = `world-id:${validatedResult.session_id}`
        const sessionNullifier = validatedResult.responses[0]?.session_nullifier?.[0] || null
        const client = await pool.connect()

        try {
          const { rows } = await client.query(
            `INSERT INTO users
              (name, world_id_session_id, world_id_session_nullifier, world_id_credential_identifier)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (world_id_session_id)
             DO UPDATE SET
               name = EXCLUDED.name,
               world_id_session_nullifier = EXCLUDED.world_id_session_nullifier,
               world_id_credential_identifier = EXCLUDED.world_id_credential_identifier,
               modified_at = CURRENT_TIMESTAMP
             RETURNING id, name, world_id_session_id, world_id_credential_identifier`,
            [subject, validatedResult.session_id, sessionNullifier, credentialIdentifiers[0]]
          )

          return {
            id: String(rows[0].id),
            name: rows[0].name,
            worldIdSessionId: rows[0].world_id_session_id,
            worldIdCredentialIdentifier: rows[0].world_id_credential_identifier,
          }
        } finally {
          client.release()
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id
        token.worldIdSessionId = user.worldIdSessionId || null
        token.worldIdCredentialIdentifier = user.worldIdCredentialIdentifier || null
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId
        session.user.worldIdSessionId = token.worldIdSessionId || null
        session.user.worldIdCredentialIdentifier = token.worldIdCredentialIdentifier || null
      }
      return session
    },
  },
  debug: process.env.NODE_ENV === "development",
};
