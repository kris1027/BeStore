import { brand } from "../src/lib/brand/brand";
import type { EmailFrame } from "./components/layout";

// Preview props shared by every template (`pnpm email:dev`), never used to send.
export const fixtureFrame: EmailFrame = {
  lang: "en",
  storeName: brand.name,
  contactAddress: "orders@example.com",
  greetingName: "Anna",
};
