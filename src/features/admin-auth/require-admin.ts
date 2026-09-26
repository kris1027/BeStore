import "server-only";

import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { db } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import {
  type AccessInput,
  type Admin,
  type AssuranceLevel,
  decideAdminAccess,
  isResetSession,
} from "./access";
import { logAuthEvent, requestIp } from "./log";
import { adminPathHeader } from "./proxy-decision";
import { mfaPath, safeAdminPath, signInPath } from "./safe-admin-path";

export type AdminSession = {
  readonly admin: Admin;
  readonly aal: AssuranceLevel;
  // Opened by a password reset link: may verify a factor, never enroll one (AC-4).
  readonly fromResetLink: boolean;
};

type SessionState = Omit<AccessInput, "nowMs" | "allowAal1">;

// Once per request: the layout, the page and an action in the same request share it.
const loadSessionState = cache(async (): Promise<SessionState> => {
  const supabase = await createSupabaseServerClient();
  // getUser() asks the Auth server, so a signed out, revoked or deleted session fails at once.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { userId: null, aal: null, amr: null, adminRow: null };

  // Decodes the token getUser() just confirmed; no second network call.
  const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const adminRow = await db.adminUser.findUnique({
    where: { id: user.id },
    select: { id: true, email: true, name: true, disabledAt: true },
  });
  return {
    userId: user.id,
    aal: level?.currentLevel === "aal2" ? "aal2" : "aal1",
    amr: level?.currentAuthenticationMethods ?? null,
    adminRow,
  };
});

// The one guard for every admin page, layout, action and route handler (spec 0004). It checks
// the session with the Auth server, the 12 hour cap, the live admin_users row and aal2, then
// redirects or 404s; it only returns for an active admin.
export async function requireAdminSession(
  options: { readonly allowAal1?: boolean } = {},
): Promise<AdminSession> {
  const state = await loadSessionState();
  const verdict = decideAdminAccess({
    ...state,
    nowMs: Date.now(),
    allowAal1: options.allowAal1 ?? false,
  });
  const requestHeaders = await headers();
  const path = requestHeaders.get(adminPathHeader) ?? undefined;

  switch (verdict.kind) {
    case "allow":
      return {
        admin: verdict.admin,
        aal: state.aal ?? "aal1",
        fromResetLink: isResetSession(state.amr),
      };
    case "sign-in":
      redirect(
        verdict.reason === "expired"
          ? signInPath({ reason: "expired" })
          : signInPath(path === undefined ? {} : { next: path }),
      );
    case "mfa":
      redirect(mfaPath(path));
    case "not-found":
      logAuthEvent("auth.access.denied", { adminId: state.userId, ip: requestIp(requestHeaders) });
      notFound();
  }
}

// Next.js resolves metadata apart from the page render, so a static `metadata` export still
// sends the page's title to a visitor the page itself 404s (AC-6: no hint the panel exists).
// Admin segments behind the guard build their metadata here: only an allowed visitor gets it.
// Anyone else gets a page title matching app/not-found.tsx (empty page metadata would stream the
// bare store name, unlike every other 404), and nothing from a layout, so the root title
// template still applies. It never 404s itself (a notFound() from a layout's metadata drops the
// 404 title entirely); the page's own guard does that.
export async function adminMetadata(
  metadata: Metadata,
  options: { readonly allowAal1?: boolean; readonly layout?: boolean } = {},
): Promise<Metadata> {
  const state = await loadSessionState();
  const verdict = decideAdminAccess({
    ...state,
    nowMs: Date.now(),
    allowAal1: options.allowAal1 ?? false,
  });
  if (verdict.kind === "allow") return metadata;
  return options.layout ? {} : { title: "Page not found" };
}

export async function requireAdmin(): Promise<Admin> {
  const { admin } = await requireAdminSession();
  return admin;
}

// AC-17: the sign in and forgot password pages send an admin who is already signed in onward.
// Anyone else (no session, expired, not an admin) sees the page.
export async function redirectIfSignedIn(next: unknown): Promise<void> {
  const state = await loadSessionState();
  if (state.userId === null) return;
  const verdict = decideAdminAccess({ ...state, nowMs: Date.now() });
  const target = typeof next === "string" ? next : undefined;
  if (verdict.kind === "mfa") redirect(mfaPath(target));
  if (verdict.kind === "allow") redirect(safeAdminPath(target));
}
