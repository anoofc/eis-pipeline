import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { db } from "./db";
import type { Staff } from "./model";

export const localDemo = () => process.env.NODE_ENV === "development" && process.env.EIS_LOCAL_DEMO === "1";
export async function authClient() {
  const jar = await cookies();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Managed authentication is not configured.");
  return createServerClient(url, key, { cookies: {
    getAll: () => jar.getAll(),
    setAll: entries => { for (const { name, value, options } of entries) jar.set(name, value, options); },
  } });
}

export async function identity() {
  const auth = await authClient();
  const { data: { user } } = await auth.auth.getUser();
  return user ? { auth, user } : null;
}

export async function currentStaff(): Promise<Staff | null> {
  if (localDemo()) {
    const { rows } = await db().query("SELECT * FROM staff WHERE email = $1 AND active", [process.env.EIS_DEMO_EMAIL || "anoof@example.test"]);
    return rows[0] ?? null;
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return null;
  const session = await identity();
  if (!session?.user.email || !session.user.email_confirmed_at) return null;
  const { data } = await session.auth.auth.mfa.getAuthenticatorAssuranceLevel();
  if (data?.currentLevel !== "aal2") return null;
  const { rows } = await db().query(
    "UPDATE staff SET auth_id = $1 WHERE email = $2 AND active AND (auth_id IS NULL OR auth_id = $1) RETURNING id,email,name,role,active,permissions",
    [session.user.id, session.user.email.toLowerCase()],
  );
  return rows[0] ?? null;
}
