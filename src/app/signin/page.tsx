"use client";

import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  const clerkConfigured = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (!clerkConfigured) {
    return (
      <div className="card" style={{ maxWidth: 520 }}>
        <h2 style={{ marginTop: 0 }}>Sign in</h2>
        <p style={{ opacity: 0.85 }}>Clerk is not configured. Set Clerk env vars to enable sign-in.</p>
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: 520 }}>
      <h2 style={{ marginTop: 0 }}>Sign in</h2>
      <div style={{ marginTop: 12 }}>
        <SignIn routing="path" path="/signin" />
      </div>
    </div>
  );
}
