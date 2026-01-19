"use client";

import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="card" style={{ maxWidth: 520 }}>
      <h2 style={{ marginTop: 0 }}>Sign up</h2>
      <div style={{ marginTop: 12 }}>
        <SignUp routing="path" path="/signup" />
      </div>
    </div>
  );
}

