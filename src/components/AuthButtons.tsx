"use client";

import { signIn, signOut, useSession } from "next-auth/react";

export default function AuthButtons() {
  const { data, status } = useSession();
  const user = data?.user;

  if (status === "loading") return <small>…</small>;

  if (!user) {
    return (
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => signIn(undefined, { callbackUrl: "/shows" })}>Sign in</button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <small>{user.email ?? user.name ?? "Signed in"}</small>
      <button onClick={() => signOut({ callbackUrl: "/shows" })}>Sign out</button>
    </div>
  );
}

