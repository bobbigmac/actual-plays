import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";
import { auth } from "~auth";
import AuthButtons from "~/components/AuthButtons";
import Providers from "~/components/Providers";

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await auth();

  return (
    <html lang="en">
      <body>
        <Providers session={session}>
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
        </Providers>
      </body>
    </html>
  );
}
