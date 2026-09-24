export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Fail fast at boot when a required environment variable is missing.
    await import("./src/lib/env");
  }
}
