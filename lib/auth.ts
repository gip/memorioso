import { NextAuthOptions } from "next-auth";
import PostgresAdapter from "@auth/pg-adapter";
import CredentialsProvider from "next-auth/providers/credentials";
import { Pool } from "pg";
import { verifySiweMessage } from "@worldcoin/minikit-js/siwe";
import {
  WORLD_CHAIN_ID,
  WORLD_ID_WALLET_AUTH_STATEMENT,
  WORLD_WALLET_NONCE_COOKIE,
} from "@/lib/world-id/constants";
 
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

function getExpectedAppOrigin(): URL {
  if (!process.env.NEXT_PUBLIC_APP_URL) {
    throw new Error("NEXT_PUBLIC_APP_URL is required")
  }

  return new URL(process.env.NEXT_PUBLIC_APP_URL)
}

export const authOptions: NextAuthOptions = {
  adapter: PostgresAdapter(pool),
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: "jwt",
  },
  providers: [
    CredentialsProvider({
      id: "world-wallet",
      name: "World App Wallet",
      credentials: {
        payload: { label: "Wallet auth payload", type: "text" },
        nonce: { label: "Nonce", type: "text" },
      },
      async authorize(credentials, req) {
        const payloadRaw = credentials?.payload
        const nonce = credentials?.nonce
        const cookieNonce = getCookieValue(req.headers?.cookie, WORLD_WALLET_NONCE_COOKIE)

        if (!payloadRaw || !nonce || !cookieNonce || nonce !== cookieNonce) {
          return null
        }

        let payload
        let verification
        try {
          payload = JSON.parse(payloadRaw)
          verification = await verifySiweMessage(
            payload,
            nonce,
            WORLD_ID_WALLET_AUTH_STATEMENT
          )
        } catch {
          return null
        }

        if (!verification.isValid) {
          return null
        }

        let expectedOrigin
        let messageUri
        try {
          expectedOrigin = getExpectedAppOrigin()
          messageUri = new URL(verification.siweMessageData.uri)
        } catch {
          return null
        }

        if (
          verification.siweMessageData.domain !== expectedOrigin.host ||
          messageUri.origin !== expectedOrigin.origin ||
          verification.siweMessageData.chain_id !== WORLD_CHAIN_ID
        ) {
          return null
        }

        const walletAddress = payload.address.toLowerCase()
        const subject = `wallet:${walletAddress}`
        const client = await pool.connect()

        try {
          const { rows } = await client.query(
            `INSERT INTO users (name, wallet_address)
             VALUES ($1, $2)
             ON CONFLICT (wallet_address)
             DO UPDATE SET name = EXCLUDED.name, modified_at = CURRENT_TIMESTAMP
             RETURNING id, name, wallet_address`,
            [subject, walletAddress]
          )

          return {
            id: String(rows[0].id),
            name: rows[0].name,
            walletAddress: rows[0].wallet_address,
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
        token.walletAddress = user.walletAddress || null
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId
        session.user.walletAddress = token.walletAddress || null
      }
      return session
    },
  },
  debug: process.env.NODE_ENV === "development",
};
