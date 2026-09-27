export const SLUG_MAX_LENGTH = 80;

// Lowercase words joined by single hyphens; also what a product URL must match.
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// A suggestion from a product name; the admin may still edit it.
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, "");
}
