import { connection } from "next/server";

// Test only: lets the e2e suite prove the error page (spec 0003, AC-13). Gated with the rest
// of /style-guide, so it never exists in production.
export default async function Page() {
  await connection();
  throw new Error("Style guide test error: this message must never reach the page");
}
