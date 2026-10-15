import "server-only";

import { z } from "zod";

import { db } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Stripe appends `session_id` to the success URL; anything else is not one of ours.
const sessionIdSchema = z.string().regex(/^cs_(test|live)_[A-Za-z0-9]+$/);

const eligibleStatuses = new Set(["paid", "shipped", "delivered"]);

// spec 0012, AC-17: the email of the order this confirmation page shows, when it may offer
// "Create an account to track this order": the order is paid (shipped or delivered too), belongs
// to no account, still has its email, and the visitor has no session. Null otherwise. The email
// always comes from the order, never from the browser.
export async function orderSignUpEmail(sessionIdParam: unknown): Promise<string | null> {
  const sessionId = sessionIdSchema.safeParse(sessionIdParam);
  if (!sessionId.success) return null;

  const order = await db.order.findUnique({
    where: { stripeCheckoutSessionId: sessionId.data },
    select: { status: true, customerId: true, email: true },
  });
  if (!order || !eligibleStatuses.has(order.status) || order.customerId !== null) return null;
  if (order.email === null) return null;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? null : order.email;
}
