import NextAuth, { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import { authAPI } from '@/lib/api';

// Extend the built-in session types
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email: string;
      image?: string | null;
      username: string;
      role: string;
      accessToken: string;
    }
  }
  interface User {
    id: string;
    username: string;
    role: string;
    token: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    username: string;
    role: string;
    accessToken: string;
  }
}

const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    }),
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        try {
          const response = await authAPI.login({
            email: credentials?.email,
            password: credentials?.password,
          });

          if (response.data.success && response.data.token) {
            return {
              id: response.data.user.id,
              email: response.data.user.email,
              name: response.data.user.fullName,
              username: response.data.user.username,
              image: response.data.user.avatar,
              role: response.data.user.role,
              token: response.data.token,
            };
          }
          return null;
        } catch (error) {
          console.error('Login error:', error);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, account }) {
      // Helper to set token data
      const setTokenData = (userData: any, accessToken: string) => {
        token.id = userData.id;
        token.username = userData.username;
        token.name = userData.fullName;
        token.email = userData.email;
        token.image = userData.avatar;
        token.role = userData.role;
        token.accessToken = accessToken;
      };

      if (account && user) {
        // Initial sign in
        if (account.provider === 'google') {
          try {
            // Call backend to login/register with Google
            const response = await authAPI.googleLogin({
              email: user.email,
              name: user.name || "",
              avatar: user.image || "",
              googleId: user.id || "",
            });

            if (response.data.success && response.data.token) {
              setTokenData(response.data.user, response.data.token);
            }
          } catch (error) {
            console.error('Google login error in JWT callback:', error);
          }
        } else if (account.provider === 'credentials') {
          token.id = user.id;
          token.username = user.username;
          token.role = user.role;
          token.accessToken = user.token;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.username = token.username as string;
        session.user.role = token.role as string;
        session.user.accessToken = token.accessToken as string;
        // Ensure other fields are also synced if changed
        session.user.name = token.name;
        session.user.image = token.image as string;
      }
      return session;
    },
  },
  pages: {
    signIn: '/auth/login',
    signOut: '/auth/login',
    error: '/auth/login',
  },
  session: {
    strategy: 'jwt',
    maxAge: 7 * 24 * 60 * 60, // 7 days
  },
  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
