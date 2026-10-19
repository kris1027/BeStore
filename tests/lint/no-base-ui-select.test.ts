import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

// spec 0016, Enforcement: ESLint bans the Base UI Select outside the style guide, because a GET
// form that uses it is dead before the app's JavaScript loads, and nothing else says so. The
// files below don't exist; ESLint matches the project's config against their paths only.

const baseUiSelect = `import { Select } from "@/components/ui/select";\nexport const s = Select;\n`;
const nativeSelect = `import { NativeSelect } from "@/components/ui/native-select";\nexport const s = NativeSelect;\n`;

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: process.cwd() });
});

async function bannedImports(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((message) => message.ruleId === "no-restricted-imports");
}

describe("the Base UI Select lint ban", () => {
  it("fails a feature file that imports the Base UI Select, pointing to NativeSelect", async () => {
    const messages = await bannedImports(
      baseUiSelect,
      "src/features/orders/components/new-filter.tsx",
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.severity).toBe(2);
    expect(messages[0]?.message).toContain("Use NativeSelect from @/components/ui/native-select");
  });

  it("fails the import in app routes and shared components too", async () => {
    for (const filePath of ["app/(store)/new-page.tsx", "src/components/new-widget.tsx"]) {
      expect(await bannedImports(baseUiSelect, filePath), filePath).toHaveLength(1);
    }
  });

  it("allows the style guide to keep showing the Base UI Select (spec 0003)", async () => {
    const messages = await bannedImports(
      baseUiSelect,
      "src/features/style-guide/components/component-showcase.tsx",
    );

    expect(messages).toEqual([]);
  });

  it("allows NativeSelect anywhere", async () => {
    const messages = await bannedImports(
      nativeSelect,
      "src/features/orders/components/new-filter.tsx",
    );

    expect(messages).toEqual([]);
  });
});
