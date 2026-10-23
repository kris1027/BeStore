import type { Metadata } from "next";

import { brandCardPath, brandCardSize } from "./brand-assets";

// Pure: the one metadata shape every indexable storefront page declares (spec 0018, AC-2). No
// env import, so the pages pass the site facts (`site` from ./site) and the tests pass their own.

export type SiteFacts = {
  // NEXT_PUBLIC_SITE_URL: every canonical, share and sitemap URL is absolute on it.
  readonly url: string;
  readonly name: string;
  // STORE_LOCALE, a canonical BCP 47 tag.
  readonly locale: string;
};

export type ShareImage = {
  readonly url: string;
  readonly width?: number;
  readonly height?: number;
  readonly alt: string;
};

export function absoluteUrl(path: string, site: Pick<SiteFacts, "url">): string {
  return new URL(path, site.url).toString();
}

export function brandCard(site: SiteFacts): ShareImage {
  return { url: absoluteUrl(brandCardPath, site), ...brandCardSize, alt: site.name };
}

export function defaultDescription(name: string): string {
  return `${name} online store`;
}

// `pl-PL` → `pl_PL`; a bare language has no Open Graph locale.
export function openGraphLocale(locale: string): string | undefined {
  const { language, region } = new Intl.Locale(locale);
  return region ? `${language}_${region}` : undefined;
}

export type PageSeo = {
  // null keeps the site title (the home page); `absolute` skips the `· Brand` template.
  readonly title: string | { readonly absolute: string } | null;
  readonly description: string | null;
  readonly path: string;
  // The brand card when absent.
  readonly image?: ShareImage;
  // false: `noindex, follow` and no canonical (`/search`, AC-17).
  readonly indexable?: boolean;
};

export function pageMetadata(page: PageSeo, site: SiteFacts): Metadata {
  const indexable = page.indexable ?? true;
  const url = absoluteUrl(page.path, site);
  const image = page.image ?? brandCard(site);
  const shareTitle =
    page.title === null
      ? site.name
      : typeof page.title === "string"
        ? page.title
        : page.title.absolute;
  const description = page.description === null ? {} : { description: page.description };
  const images = [{ url: image.url, width: image.width, height: image.height, alt: image.alt }];
  const locale = openGraphLocale(site.locale);
  return {
    ...(page.title === null ? {} : { title: page.title }),
    ...description,
    ...(indexable
      ? { alternates: { canonical: url } }
      : { robots: { index: false, follow: true } }),
    openGraph: {
      type: "website",
      siteName: site.name,
      url,
      title: shareTitle,
      ...description,
      ...(locale === undefined ? {} : { locale }),
      images,
    },
    // Next fills the twitter title and description from openGraph.
    twitter: { card: "summary_large_image", images },
  };
}
