import { signOutRequest } from "@/features/admin-auth/sign-out";

// Only POST: a GET gets Next's 405 and never signs anyone out.
export const POST = signOutRequest;
