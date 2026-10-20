import Link from "next/link";
import Markdown, { type Components } from "react-markdown";

// spec 0017, Renderer: its own renderer, not the product description one (that one drops
// relative links and demotes headings). The page title is the only h1, so a `#` heading in a
// draft is an error (content.test.ts), never rendered. Raw HTML is skipped (the draft note is an
// HTML comment), and anything outside the list below is unwrapped to its text.

export const allowedElements: readonly string[] = [
  "h2",
  "h3",
  "p",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "a",
  "blockquote",
  "hr",
];

// Relative paths, in page anchors, https and mailto; anything else becomes plain text.
export function legalUrl(url: string): string {
  const trimmed = url.trim();
  if (/^\/(?!\/)/.test(trimmed) || trimmed.startsWith("#")) return trimmed;
  return /^(https:|mailto:)/i.test(trimmed) ? trimmed : "";
}

const linkClass = "text-foreground underline underline-offset-4 hover:text-foreground/80";

const components: Components = {
  h2: ({ children }) => (
    <h2 className="mt-6 font-heading text-2xl text-foreground md:text-3xl">{children}</h2>
  ),
  h3: ({ children }) => <h3 className="mt-2 font-heading text-xl text-foreground">{children}</h3>,
  p: ({ children }) => <p className="leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="flex list-disc flex-col gap-1.5 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="flex list-decimal flex-col gap-1.5 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="flex flex-col gap-3 rounded-md border bg-muted/40 p-5 text-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-border" />,
  a: ({ href, children }) => {
    if (!href) return <span>{children}</span>;
    if (href.startsWith("/")) {
      return (
        <Link href={href} className={linkClass}>
          {children}
        </Link>
      );
    }
    return (
      <a
        href={href}
        className={linkClass}
        {...(href.startsWith("https:") ? { rel: "noopener noreferrer" } : {})}
      >
        {children}
      </a>
    );
  },
};

export function LegalMarkdown({ markdown }: { readonly markdown: string }) {
  return (
    <div className="flex flex-col gap-4">
      <Markdown
        allowedElements={allowedElements}
        unwrapDisallowed
        skipHtml
        urlTransform={legalUrl}
        components={components}
      >
        {markdown}
      </Markdown>
    </div>
  );
}
