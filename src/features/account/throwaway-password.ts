import { randomBytes } from "node:crypto";

// spec 0012, AC-1: sign up hands Supabase a password nobody knows, and the customer chooses the
// real one after confirming (AC-3), so a password set by whoever signed up first never survives a
// confirm. Never shown, stored or logged. 32 random bytes, plus a suffix with every character
// class the password policy asks for; 47 characters, under the 72 byte limit.
const classSuffix = "aA1!";

export function throwawayPassword(): string {
  return `${randomBytes(32).toString("base64url")}${classSuffix}`;
}
