import { auth, currentUser } from "@clerk/nextjs/server";
import prisma from "~/lib/prisma";

function emailIsEnvAdmin(email: string | null | undefined) {
  const raw = process.env.ADMIN_EMAILS ?? "";
  const allowed = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return !!email && allowed.includes(email.toLowerCase());
}

export function canAdmin(localUser: { isAdmin: boolean } | null | undefined, envAdmin: boolean) {
  return !!envAdmin || !!localUser?.isAdmin;
}

export async function ensureLocalUser() {
  const { userId: clerkUserId } = auth();
  if (!clerkUserId) return { clerkUserId: null, localUser: null as any, envAdmin: false };

  const clerkUser = await currentUser();
  const email = clerkUser?.primaryEmailAddress?.emailAddress ?? null;
  const name =
    clerkUser?.fullName ??
    [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(" ") ||
    null;
  const image = clerkUser?.imageUrl ?? null;

  const envAdmin = emailIsEnvAdmin(email);

  const localUser = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { clerkUserId } });
    if (existing) {
      return tx.user.update({
        where: { clerkUserId },
        data: { email, name, image }
      });
    }

    const adminCount = await tx.user.count({ where: { isAdmin: true } });
    return tx.user.create({
      data: {
        clerkUserId,
        email,
        name,
        image,
        isAdmin: adminCount === 0
      }
    });
  });

  return { clerkUserId, localUser, envAdmin };
}
