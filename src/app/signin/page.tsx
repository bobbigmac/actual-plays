"use client";

import { signIn } from "next-auth/react";

export default function SignInPage() {
  return (
    <div className="card" style={{ maxWidth: 520 }}>
      <h2 style={{ marginTop: 0 }}>Sign in</h2>
      <p style={{ opacity: 0.85 }}>Use OAuth (best) or email magic link (if configured).</p>

      <div style={{ display: "grid", gap: 10 }}>
        <button onClick={() => signIn("google", { callbackUrl: "/shows" })}>Continue with Google</button>
        <button onClick={() => signIn("discord", { callbackUrl: "/shows" })}>Continue with Discord</button>
        <button onClick={() => signIn("email", { callbackUrl: "/shows" })}>Continue with Email</button>
      </div>
    </div>
  );
}

