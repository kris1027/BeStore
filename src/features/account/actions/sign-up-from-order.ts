"use server";

import { after } from "next/server";

import type { ActionResult } from "@/lib/result";

import { orderSignUpEmail } from "../order-sign-up";
import { sendSignUp } from "../sign-up-email";

// spec 0012, AC-17: the confirmation page's "Create an account" button. The server checks the
// same conditions the page did and runs the AC-1 sign up with the order's email, in after(). If an
// account already exists for that email nothing is sent, and the order links at that customer's
// next sign in (AC-10).
export async function signUpFromOrder(
  sessionId: unknown,
): Promise<ActionResult<null, "not_eligible">> {
  const email = await orderSignUpEmail(sessionId);
  if (email === null) return { ok: false, error: "not_eligible" };
  after(() => sendSignUp(email));
  return { ok: true, data: null };
}
