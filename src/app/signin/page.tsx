"use client";

import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="card" style={{ maxWidth: 520 }}>
      <h2 style={{ marginTop: 0 }}>Sign in</h2>
      <div style={{ marginTop: 12 }}>
        <SignIn routing="path" path="/signin" />
      </div>
    </div>
  );
}
