import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import AuthButtons from "~/components/AuthButtons";

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ClerkProvider>
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
        </ClerkProvider>
      </body>
    </html>
  );
}
