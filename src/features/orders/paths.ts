export const adminOrdersPath = "/admin/orders";

export function adminOrderPath(number: number): string {
  return `${adminOrdersPath}/${number}`;
}
