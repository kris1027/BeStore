// "1 product", "12 products": the result count, the Sheet's close button and each filter count.
export function productCount(count: number): string {
  return `${count} ${count === 1 ? "product" : "products"}`;
}
