import { z } from "zod";

import { parseCalendarDay } from "@/lib/dates";

// Pure. A legal text's `---` block (spec 0017, AC-1): only `key: value` lines, so no YAML parser
// is needed. `updated` is the text's version, a real calendar day (no 2026-02-31).

const frontMatterSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  updated: z.string().refine((value) => parseCalendarDay(value) !== null, {
    error: "updated must be a real YYYY-MM-DD date",
  }),
});

export type FrontMatter = z.output<typeof frontMatterSchema>;

export type ParsedText = { readonly meta: FrontMatter; readonly body: string };

// A leading BOM goes and CRLF becomes LF first, so a file saved on Windows parses the same.
export function normalizeText(raw: string): string {
  return raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

// Throws on a missing block, a line that is not `key: value`, or a bad value: a broken legal
// file must fail the build, never render half a page.
export function parseFrontMatter(raw: string, name: string): ParsedText {
  const text = normalizeText(raw);
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!match) throw new Error(`${name}: missing the --- front matter block`);
  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? "").split("\n")) {
    if (line.trim() === "") continue;
    const pair = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (!pair) throw new Error(`${name}: front matter line is not "key: value": ${line}`);
    fields[pair[1] ?? ""] = (pair[2] ?? "").trim();
  }
  const parsed = frontMatterSchema.safeParse(fields);
  if (!parsed.success) {
    throw new Error(`${name}: bad front matter (${z.prettifyError(parsed.error)})`);
  }
  return { meta: parsed.data, body: text.slice(match[0].length) };
}
