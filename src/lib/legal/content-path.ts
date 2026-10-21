// The legal texts that bundle as raw strings, shared by the Turbopack rule in next.config.ts and
// the Vitest transform, so the two never disagree. Turbopack matches the path relative to its
// root, the folder holding the lockfile: the app folder here, a parent one for the build guard's
// copy (tests/build/legal-guard.build.test.ts), so the prefix may be any folder. Vitest matches
// the absolute path.
export const legalContent = /(?:^|\/)src\/lib\/legal\/content\/[^/]+\.md$/;
