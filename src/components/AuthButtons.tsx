"use client";

import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";

export default function AuthButtons() {
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
