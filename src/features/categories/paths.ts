export const adminCategoriesPath = "/admin/categories";
export const newCategoryPath = `${adminCategoriesPath}/new`;

export function adminCategoryPath(id: string): string {
  return `${adminCategoriesPath}/${id}`;
}
