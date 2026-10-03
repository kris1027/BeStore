import Markdown, { type Components } from "react-markdown";

import { cn } from "@/lib/utils";

// spec 0009, AC-6: the one Markdown renderer for product descriptions, shared by the cached
// product page (a server render, no client JavaScript) and the admin Preview (a client render),
// so it carries no server-only import. Only paragraphs, line breaks, bold, italic, lists, level
// 2 and 3 headings and safe links come out; raw HTML is skipped, images and everything else are
// dropped (their text kept), and no HTML is ever injected.

const allowedElements = ["p", "br", "strong", "em", "ul", "ol", "li", "h2", "h3", "a"];

const safeProtocol = /^(https?:|mailto:)/i;

// Only absolute http(s) and mailto links; anything else (javascript:, data:, relative paths)
// becomes no link at all, and the text stays.
export function descriptionUrl(url: string): string {
  return safeProtocol.test(url.trim()) ? url.trim() : "";
}

type HastNode = {
  type: string;
  tagName?: string;
  children?: HastNode[];
};

// The product name is the page's only h1, so "#" renders as h2, and deeper levels as h3.
function demoteHeadings() {
  return (tree: HastNode) => {
    const walk = (node: HastNode) => {
      if (node.type === "element" && node.tagName !== undefined) {
        if (node.tagName === "h1") node.tagName = "h2";
        else if (/^h[4-6]$/.test(node.tagName)) node.tagName = "h3";
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}

const components: Components = {
  p: ({ children }) => <p className="leading-relaxed">{children}</p>,
  h2: ({ children }) => <h2 className="font-heading text-2xl text-foreground">{children}</h2>,
  h3: ({ children }) => <h3 className="font-heading text-xl text-foreground">{children}</h3>,
  ul: ({ children }) => <ul className="flex list-disc flex-col gap-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="flex list-decimal flex-col gap-1 pl-5">{children}</ol>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  a: ({ href, children }) =>
    href ? (
      <a href={href} rel="nofollow" className="text-foreground underline underline-offset-4">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
};

export function ProductDescription({
  markdown,
  className,
}: {
  readonly markdown: string;
  readonly className?: string;
}) {
  return (
    <div className={cn("flex max-w-prose flex-col gap-4 text-muted-foreground", className)}>
      <Markdown
        allowedElements={allowedElements}
        unwrapDisallowed
        skipHtml
        rehypePlugins={[demoteHeadings]}
        urlTransform={descriptionUrl}
        components={components}
      >
        {markdown}
      </Markdown>
    </div>
  );
}
