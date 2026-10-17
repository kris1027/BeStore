export const adminCategoriesPath = "/admin/categories";
export const newCategoryPath = `${adminCategoriesPath}/new`;

export function adminCategoryPath(id: string): string {
  return `${adminCategoriesPath}/${id}`;
}

// The storefront category page (spec 0013, AC-1).
export function categoryPath(slug: string): string {
  return `/categories/${slug}`;
}
