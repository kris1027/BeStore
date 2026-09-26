import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { env } from "@/lib/env";

// Cookie session client for server components, server actions and route handlers.
// Use it for Supabase Auth only; data goes through Prisma (never supabase.from).
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server components cannot write cookies. The proxy has already refreshed the
          // session for this request, so a render never needs to.
        }
      },
    },
  });
}

// Stateless client for calls that must not touch the visitor's cookies, such as sending a
// reset email from after(), when the response is already gone. `implicit` skips the PKCE code
// verifier, which the @supabase/ssr client would try to store in a cookie.
export function createSupabaseStatelessClient() {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, flowType: "implicit" },
  });
}

// Removes every Supabase auth cookie on this device. The fallback for a sign out whose call to
// the Auth server failed: auth-js keeps the local session in that case.
export async function clearAuthCookies() {
  const cookieStore = await cookies();
  for (const { name } of cookieStore.getAll()) {
    if (name.startsWith("sb-")) cookieStore.delete(name);
  }
}
