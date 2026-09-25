import { beforeEach, describe, expect, it, vi } from "vitest";

const env: { VERCEL_ENV?: string } = {};
vi.mock("@/lib/env", () => ({ env }));

const { default: StyleGuideLayout } = await import("./layout");

// The e2e suite runs with VERCEL_ENV unset, so the production gate is proven here.
describe("style guide gate", () => {
  beforeEach(() => {
    delete env.VERCEL_ENV;
  });

  it("returns 404 on a production deploy", () => {
    env.VERCEL_ENV = "production";

    expect(() => StyleGuideLayout({ children: "page" } as never)).toThrow(
      expect.objectContaining({ digest: expect.stringContaining("404") }),
    );
  });

  it.each([undefined, "preview", "development"])("renders when VERCEL_ENV is %s", (value) => {
    if (value) env.VERCEL_ENV = value;

    expect(StyleGuideLayout({ children: "page" } as never)).toBe("page");
  });
});
