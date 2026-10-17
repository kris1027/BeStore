export const adminOrdersPath = "/admin/orders";

export function adminOrderPath(number: number): string {
  return `${adminOrdersPath}/${number}`;
}

// spec 0014, AC-14: a code's admin page, linked from an order that used it.
export function adminDiscountPath(id: string): string {
  return `/admin/discounts/${id}`;
}
