import { cn } from "@/lib/utils";

type StatusPageProps = {
  // A short code shown above the heading ("404"), or a reference such as an error digest.
  readonly eyebrow?: string;
  readonly title: string;
  readonly description: string;
  readonly actions: React.ReactNode;
  readonly className?: string;
};

// The shared body of the not found and error pages: one h1, a plain message, a way out.
export function StatusPage({ eyebrow, title, description, actions, className }: StatusPageProps) {
  return (
    <section
      className={cn(
        "mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-6 px-4 py-16 text-center md:py-24",
        className,
      )}
    >
      {eyebrow ? (
        <p className="text-sm font-medium tracking-widest text-muted-foreground uppercase">
          {eyebrow}
        </p>
      ) : null}
      <h1 className="font-heading text-4xl text-balance md:text-5xl">{title}</h1>
      <p className="text-lg text-pretty text-muted-foreground">{description}</p>
      <div className="flex flex-col items-center gap-3 sm:flex-row">{actions}</div>
    </section>
  );
}
