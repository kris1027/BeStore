import { notFound } from "next/navigation";

import { Skeleton } from "@/components/ui/skeleton";

import { getCategoryBySlug } from "../queries";

// spec 0013, AC-1 to AC-3: the category's name and plain text description. Reads only the
// path, so a prerendered category serves it from the static shell. An unknown, malformed or
// hidden slug gets the store's 404 page (status 200 under Cache Components, like products).
export async function CategoryHeader({ params }: { readonly params: Promise<{ slug: string }> }) {
  const category = await getCategoryBySlug((await params).slug);
  if (!category) notFound();

  return (
    <header className="flex flex-col gap-3">
      <h1 className="font-heading text-4xl text-balance md:text-5xl">{category.name}</h1>
      {category.description ? (
        <p className="max-w-prose text-lg whitespace-pre-line text-muted-foreground">
          {category.description}
        </p>
      ) : null}
    </header>
  );
}

export function CategoryHeaderSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      <Skeleton className="h-12 w-2/3 max-w-md" />
      <Skeleton className="h-6 w-full max-w-prose" />
    </div>
  );
}
