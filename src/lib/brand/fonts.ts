import { Inter, Newsreader } from "next/font/google";

// Kept apart from brand.ts because next/font only runs inside the Next.js app, never in emails.
// next/font downloads the files at build time and self hosts them: the browser never calls Google.
export const fontSans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const fontHeading = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  variable: "--font-heading",
  display: "swap",
});
