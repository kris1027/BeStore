import type { Thing, WithContext } from "schema-dts";

// spec 0018, AC-11: the one place JSON-LD is written into the page. Every `<` becomes `<`,
// so admin entered text holding `</script>` can never close the tag; JSON parsers read it back
// as the same character.
export function serializeJsonLd(data: WithContext<Thing> | readonly WithContext<Thing>[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function JsonLdScript({
  data,
}: {
  readonly data: WithContext<Thing> | readonly WithContext<Thing>[];
}) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
