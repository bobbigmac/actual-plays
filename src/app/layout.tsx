import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import AuthButtons from "~/components/AuthButtons";

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const clerkConfigured = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  const body = (
    <>
      <header>
        <nav>
          <Link href="/shows">
            <b>ActualPlay Hub</b>
          </Link>
          <Link href="/shows">Shows</Link>
        </nav>
        <AuthButtons />
      </header>
      <main>{children}</main>
    </>
  );

  return (
    <html lang="en">
      <body>
        {clerkConfigured ? <ClerkProvider>{body}</ClerkProvider> : body}
      </body>
    </html>
  );
}
