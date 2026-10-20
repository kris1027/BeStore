// spec 0017, AC-8 and AC-12: a legal link beside a form opens in a new tab, so what the customer
// typed survives, and its accessible name says so.
export function NewTabLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      aria-label={`${children}, opens in a new tab`}
      className="text-foreground underline underline-offset-4 hover:text-foreground/80"
    >
      {children}
    </a>
  );
}
