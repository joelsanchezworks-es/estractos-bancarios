import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';

const SEVEN_DAYS = 7 * 24 * 60 * 60;

/**
 * Single-user credential auth. The owner's email/password live in environment
 * variables (OWNER_EMAIL / OWNER_PASSWORD); there is no user database.
 */
export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credenciales',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Contraseña', type: 'password' },
      },
      async authorize(credentials) {
        const ownerEmail = process.env.OWNER_EMAIL;
        const ownerPassword = process.env.OWNER_PASSWORD;

        if (!ownerEmail || !ownerPassword) {
          console.error(
            '[auth] OWNER_EMAIL / OWNER_PASSWORD no configurados en el entorno.',
          );
          return null;
        }

        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password ?? '';

        if (email === ownerEmail.trim().toLowerCase() && password === ownerPassword) {
          return { id: 'owner', email: ownerEmail, name: 'Joel' };
        }

        return null;
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: SEVEN_DAYS,
  },
  jwt: {
    maxAge: SEVEN_DAYS,
  },
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.name = user.name ?? token.name;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.id as string) ?? 'owner';
        session.user.name = (token.name as string) ?? session.user.name;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
