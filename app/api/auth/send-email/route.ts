import { connection } from "next/server";

import { handleSendEmailHook } from "@/lib/email/send-auth-email";

// Supabase's Send Email Hook (spec 0012, AC-8): every auth email goes out from here.
export async function POST(request: Request) {
  // Request time only: never prerendered or cached.
  await connection();
  return handleSendEmailHook(request);
}
