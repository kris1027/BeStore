export const adminDiscountsPath = "/admin/discounts";
export const newDiscountPath = `${adminDiscountsPath}/new`;

export function adminDiscountPath(id: string): string {
  return `${adminDiscountsPath}/${id}`;
}

// spec 0014, AC-14: the orders that used a code, by its id (a deleted code's text can be reused).
export function discountOrdersPath(id: string): string {
  return `/admin/orders?discount=${id}`;
}
