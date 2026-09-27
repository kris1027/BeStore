// The confirmation page shows who the order is for without printing the address in full
// (spec 0006, Value sourcing): "k•••@gmail.com".
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "•••";
  return `${email.slice(0, 1)}•••${email.slice(at)}`;
}
