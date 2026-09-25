type ShowcaseSectionProps = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly level?: "h2" | "h3";
  readonly children: React.ReactNode;
};

export function ShowcaseSection({
  id,
  title,
  description,
  level: Heading = "h3",
  children,
}: ShowcaseSectionProps) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-4 flex-col gap-6">
      <div className="flex max-w-2xl flex-col gap-1">
        <Heading
          id={`${id}-title`}
          className={Heading === "h2" ? "font-heading text-3xl" : "font-heading text-2xl"}
        >
          {title}
        </Heading>
        <p className="text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}
