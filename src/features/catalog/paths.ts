// The catalog's admin routes, shared by server pages and client forms.
export const adminProductsPath = "/admin/products";
export const newProductPath = `${adminProductsPath}/new`;
export const arrangeProductsPath = `${adminProductsPath}/arrange`;

// By id, not slug: the slug can change (spec 0009, Decision).
export function adminProductPath(id: string): string {
  return `${adminProductsPath}/${id}`;
}

// The storefront product page.
export function productPath(slug: string): string {
  return `/products/${slug}`;
}
