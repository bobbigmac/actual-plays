import type { NextAuthConfig } from "next-auth";
import Discord from "next-auth/providers/discord";
import Email from "next-auth/providers/email";
import Google from "next-auth/providers/google";

const providers = [
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? Google({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET
      })
    : null,
  process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET
    ? Discord({
        clientId: process.env.DISCORD_CLIENT_ID,
        clientSecret: process.env.DISCORD_CLIENT_SECRET
      })
    : null,
  process.env.EMAIL_SERVER && process.env.EMAIL_FROM
    ? Email({
        server: process.env.EMAIL_SERVER,
        from: process.env.EMAIL_FROM
      })
    : null
].filter(Boolean);

export default {
  providers: providers as NonNullable<NextAuthConfig["providers"]>,
  session: { strategy: "database" },
  trustHost: true,
  pages: { signIn: "/signin" },
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        // @ts-expect-error augmented in src/types/next-auth.d.ts
        session.user.id = user.id;
        // @ts-expect-error augmented in src/types/next-auth.d.ts
        session.user.handle = user.handle ?? null;
      }
      return session;
    }
  }
} satisfies NextAuthConfig;

