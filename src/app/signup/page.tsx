"use client";

import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  const clerkConfigured = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (!clerkConfigured) {
    return (
      <div className="card" style={{ maxWidth: 520 }}>
        <h2 style={{ marginTop: 0 }}>Sign up</h2>
        <p style={{ opacity: 0.85 }}>Clerk is not configured. Set Clerk env vars to enable sign-up.</p>
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: 520 }}>
      <h2 style={{ marginTop: 0 }}>Sign up</h2>
      <div style={{ marginTop: 12 }}>
        <SignUp routing="path" path="/signup" />
      </div>
    </div>
  );
}
