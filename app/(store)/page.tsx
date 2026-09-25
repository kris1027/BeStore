import { storeContainer } from "@/components/layout/container";
import { brand } from "@/lib/brand/brand";
import { cn } from "@/lib/utils";

export default function StoreHomePage() {
  return (
    <section
      className={cn(
        storeContainer,
        "flex flex-1 flex-col items-start justify-center gap-4 py-12 md:py-16",
      )}
    >
      <h1 className="font-heading text-4xl md:text-5xl">{brand.name}</h1>
      <p className="max-w-prose text-lg text-muted-foreground">The storefront is coming soon.</p>
    </section>
  );
}
