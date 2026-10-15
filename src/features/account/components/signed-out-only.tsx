import { redirectIfSignedIn } from "../guards";

// Renders its children only for a visitor with no session (AC-4); the session read streams in
// behind the page's Suspense boundary.
export async function SignedOutOnly({ children }: { readonly children: React.ReactNode }) {
  await redirectIfSignedIn();
  return children;
}
