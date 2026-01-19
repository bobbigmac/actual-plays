"use client";

import Link from "next/link";
import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";

export default function AuthButtons() {
  const clerkConfigured = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!clerkConfigured) {
    return (
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <Link href="/signin">Sign in</Link>
        <small>(auth not configured)</small>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <SignedOut>
        <SignInButton mode="modal">
          <button>Sign in</button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <UserButton afterSignOutUrl="/shows" />
      </SignedIn>
    </div>
  );
}
