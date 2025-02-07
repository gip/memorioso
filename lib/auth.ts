import { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import PostgresAdapter from '@auth/pg-adapter'
import { Pool } from 'pg'
 
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

export const authOptions: NextAuthOptions = {
  adapter: PostgresAdapter(pool),
  secret: process.env.NEXTAUTH_SECRET,
  providers: [
    GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || ''
    }),
    {
      id: 'worldcoin',
      name: 'Worldcoin',
      type: 'oauth',
      wellKnown: 'https://id.worldcoin.org/.well-known/openid-configuration',
      authorization: { params: { scope: 'openid' } },
      clientId: process.env.WLD_CLIENT_ID,
      clientSecret: process.env.WLD_CLIENT_SECRET,
      idToken: true,
      checks: ['state', 'nonce', 'pkce'],
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.sub,
          verificationLevel:
            profile['https://id.worldcoin.org/v1'].verification_level,
        };
      },
    },
  ],
  callbacks: {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async signIn({ user }) {
      return true;
    },
  },
  debug: process.env.NODE_ENV === 'development',
}