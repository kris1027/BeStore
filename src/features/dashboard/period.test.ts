import { describe, expect, it } from "vitest";

import { bucketLabel, formatStoreDay, parseSalesWindow, windowBuckets } from "./period";

// spec 0015, AC-2 to AC-4 and AC-11. Today is Sunday 18 October 2026 in Warsaw.
const today = { y: 2026, m: 10, d: 18 };
const zone = "Europe/Warsaw";
const parse = (params: Record<string, unknown>) => parseSalesWindow(params, today, zone);

const days = (n: number) => n * 86_400_000;

describe("parseSalesWindow presets", () => {
  it("defaults to the last 30 days", () => {
    const window = parse({});
    expect(window.preset).toBe("30d");
    expect(window.rejectedRange).toBe(false);
    expect(window.current.firstDay).toBe("2026-09-19");
    expect(window.current.lastDay).toBe("2026-10-18");
    expect(window.dayCount).toBe(30);
    expect(parse({ period: "bogus" }).preset).toBe("30d");
  });

  it.each([
    ["today", "2026-10-18", 1],
    ["7d", "2026-10-12", 7],
    ["30d", "2026-09-19", 30],
    ["month", "2026-10-01", 18],
    ["12m", "2025-11-01", 352],
  ])("%s starts on %s and spans %i days", (period, firstDay, dayCount) => {
    const window = parse({ period });
    expect(window.current.firstDay).toBe(firstDay);
    expect(window.current.lastDay).toBe("2026-10-18");
    expect(window.dayCount).toBe(dayCount);
  });

  it("runs from the start of the first store day to the start of the day after the last", () => {
    const window = parse({ period: "today" });
    // Warsaw is UTC+2 until the clocks go back on 25 October.
    expect(window.current.start.toISOString()).toBe("2026-10-17T22:00:00.000Z");
    expect(window.current.end.toISOString()).toBe("2026-10-18T22:00:00.000Z");
  });

  it("follows the store's clock across a daylight saving change", () => {
    const window = parseSalesWindow({ period: "today" }, { y: 2026, m: 10, d: 25 }, zone);
    // 25 October has 25 hours in Warsaw.
    expect(window.current.start.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(window.current.end.toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });
});

describe("the previous window", () => {
  it("has the same number of days and ends the day before", () => {
    // 1 to 18 October is 18 days, so 13 to 30 September. (AC-4's own example says 12 to 29
    // September, which breaks its rule by a day; the rule wins.)
    const month = parse({ period: "month" });
    expect(month.previous.firstDay).toBe("2026-09-13");
    expect(month.previous.lastDay).toBe("2026-09-30");
    expect(month.previous.end).toEqual(month.current.start);

    const year = parse({ period: "12m" });
    expect(year.previous.lastDay).toBe("2025-10-31");
    expect(year.previous.firstDay).toBe("2024-11-14");

    const day = parse({ period: "today" });
    expect(day.previous.firstDay).toBe("2026-10-17");
    expect(day.previous.lastDay).toBe("2026-10-17");
  });
});

describe("parseSalesWindow custom ranges", () => {
  it("uses a valid range over the preset", () => {
    const window = parse({ period: "7d", from: "2026-08-01", to: "2026-08-31" });
    expect(window.preset).toBeNull();
    expect(window.current.firstDay).toBe("2026-08-01");
    expect(window.current.lastDay).toBe("2026-08-31");
    expect(window.dayCount).toBe(31);
    expect(window.rejectedRange).toBe(false);
  });

  it("clamps a future end to today", () => {
    const window = parse({ from: "2026-10-10", to: "2026-12-31" });
    expect(window.current.lastDay).toBe("2026-10-18");
    expect(window.rejectedRange).toBe(false);
  });

  it("accepts 366 days and no more", () => {
    expect(parse({ from: "2025-10-18", to: "2026-10-18" }).dayCount).toBe(366);
    expect(parse({ from: "2025-10-17", to: "2026-10-18" }).rejectedRange).toBe(true);
  });

  it.each([
    ["a missing side", { from: "2026-10-01" }],
    ["a day that does not exist", { from: "2026-02-30", to: "2026-03-05" }],
    ["from after to", { from: "2026-10-10", to: "2026-10-01" }],
    ["a future start", { from: "2026-10-19", to: "2026-10-25" }],
    ["a range over 366 days", { from: "2024-01-01", to: "2026-01-01" }],
  ])("falls back to the last 30 days with a notice on %s", (_, params) => {
    const window = parse(params);
    expect(window.rejectedRange).toBe(true);
    expect(window.preset).toBe("30d");
    expect(window.current.firstDay).toBe("2026-09-19");
  });

  it("lets a preset win over the dates when the form came from a custom range", () => {
    const window = parse({ period: "7d", shown: "custom", from: "2026-08-01", to: "2026-08-31" });
    expect(window.preset).toBe("7d");
    expect(window.current.firstDay).toBe("2026-10-12");
    expect(window.rejectedRange).toBe(false);
  });

  it("keeps the dates when the form came from a custom range with no preset picked", () => {
    const window = parse({ period: "", shown: "custom", from: "2026-08-01", to: "2026-08-31" });
    expect(window.preset).toBeNull();
    expect(window.current.firstDay).toBe("2026-08-01");
  });

  it("ignores an unknown shown value", () => {
    const window = parse({ period: "7d", shown: "x", from: "2026-08-01", to: "2026-08-31" });
    expect(window.preset).toBeNull();
  });

  it("treats empty date fields as missing", () => {
    const window = parse({ period: "7d", from: "", to: "" });
    expect(window.preset).toBe("7d");
    expect(window.rejectedRange).toBe(false);
  });
});

describe("buckets", () => {
  it("picks day, week or month from the window's length", () => {
    expect(parse({ from: "2026-09-18", to: "2026-10-18" }).unit).toBe("day");
    expect(parse({ from: "2026-09-17", to: "2026-10-18" }).unit).toBe("week");
    expect(parse({ from: "2026-04-20", to: "2026-10-18" }).unit).toBe("week");
    expect(parse({ from: "2026-04-19", to: "2026-10-18" }).unit).toBe("month");
    expect(parse({ period: "12m" }).unit).toBe("month");
  });

  it("lists every day of a short window", () => {
    const window = parse({ period: "7d" });
    expect(window.buckets.map((bucket) => bucket.key)).toEqual([
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
    ]);
  });

  it("keys weeks by their Monday and clips the first one to the window", () => {
    const first = Date.UTC(2026, 9, 15) / days(1); // Thursday 15 October
    const last = Date.UTC(2026, 9, 27) / days(1);
    expect(windowBuckets(first, last, "week")).toEqual([
      { key: "2026-10-12", firstDay: "2026-10-15" },
      { key: "2026-10-19", firstDay: "2026-10-19" },
      { key: "2026-10-26", firstDay: "2026-10-26" },
    ]);
  });

  it("keys months by their 1st", () => {
    const window = parse({ period: "12m" });
    expect(window.buckets).toHaveLength(12);
    expect(window.buckets[0]).toEqual({ key: "2025-11-01", firstDay: "2025-11-01" });
    expect(window.buckets.at(-1)).toEqual({ key: "2026-10-01", firstDay: "2026-10-01" });
    const clipped = parse({ from: "2026-03-15", to: "2026-10-18" });
    expect(clipped.buckets[0]).toEqual({ key: "2026-03-01", firstDay: "2026-03-15" });
  });

  it("labels each bucket from its first day inside the window", () => {
    expect(bucketLabel({ key: "2026-10-18", firstDay: "2026-10-18" }, "day", "en")).toBe("Oct 18");
    expect(bucketLabel({ key: "2026-10-12", firstDay: "2026-10-15" }, "week", "en")).toBe(
      "Week of Oct 15",
    );
    expect(bucketLabel({ key: "2026-03-01", firstDay: "2026-03-15" }, "month", "en")).toBe(
      "Mar 2026",
    );
  });
});

describe("formatStoreDay", () => {
  it("shows the calendar day itself, whatever the server's zone", () => {
    expect(formatStoreDay("2026-10-18", "en")).toBe("Oct 18, 2026");
  });
});

describe("calendar edges", () => {
  const on = (y: number, m: number, d: number, params: Record<string, unknown>) =>
    parseSalesWindow(params, { y, m, d }, zone);

  // covers: AC-2
  it("12m reaches back into the previous year from January and February", () => {
    expect(on(2027, 1, 5, { period: "12m" }).current.firstDay).toBe("2026-02-01");
    expect(on(2027, 2, 10, { period: "12m" }).current.firstDay).toBe("2026-03-01");
    expect(on(2027, 1, 5, { period: "12m" }).buckets).toHaveLength(12);
  });

  // covers: AC-2, AC-4
  it("This month on the 1st is one day, compared with the last day of the month before", () => {
    const window = on(2026, 11, 1, { period: "month" });
    expect(window.dayCount).toBe(1);
    expect(window.current.firstDay).toBe("2026-11-01");
    expect(window.previous.firstDay).toBe("2026-10-31");
    expect(window.previous.lastDay).toBe("2026-10-31");
  });

  // covers: AC-4
  it("a previous window can cross a year boundary", () => {
    const window = on(2027, 1, 3, { period: "7d" });
    expect(window.current.firstDay).toBe("2026-12-28");
    expect(window.previous.firstDay).toBe("2026-12-21");
    expect(window.previous.lastDay).toBe("2026-12-27");
  });

  // covers: AC-3
  it("knows 29 February only in a leap year", () => {
    expect(on(2028, 3, 1, { from: "2028-02-01", to: "2028-02-29" }).dayCount).toBe(29);
    expect(on(2027, 3, 1, { from: "2027-02-01", to: "2027-02-29" }).rejectedRange).toBe(true);
  });

  // covers: AC-3
  it("allows a full leap year of 366 days", () => {
    const window = on(2028, 12, 31, { from: "2028-01-01", to: "2028-12-31" });
    expect(window.rejectedRange).toBe(false);
    expect(window.dayCount).toBe(366);
    expect(window.unit).toBe("month");
    expect(window.buckets).toHaveLength(12);
  });

  // covers: AC-3
  it("accepts a range of one day that ends today", () => {
    const window = on(2026, 10, 18, { from: "2026-10-18", to: "2026-10-18" });
    expect(window.preset).toBeNull();
    expect(window.dayCount).toBe(1);
    expect(window.unit).toBe("day");
  });

  // covers: AC-3. Clamping can't rescue a range that starts in the future.
  it("refuses a range wholly in the future even though its end would clamp", () => {
    expect(on(2026, 10, 18, { from: "2026-10-20", to: "2027-01-01" }).rejectedRange).toBe(true);
  });
});

describe("repeated and malformed params", () => {
  // covers: AC-2, AC-3. `?period=7d&period=12m` arrives as an array; the first value wins.
  it("takes the first value of a repeated param", () => {
    expect(parse({ period: ["7d", "12m"] }).preset).toBe("7d");
    const window = parse({ from: ["2026-08-01", "bogus"], to: ["2026-08-31"] });
    expect(window.current.firstDay).toBe("2026-08-01");
    expect(window.rejectedRange).toBe(false);
  });

  it.each([
    ["a date in another format", { from: "01/08/2026", to: "2026-08-31" }],
    ["a date with a time", { from: "2026-08-01T00:00", to: "2026-08-31" }],
    ["a missing to", { from: "2026-08-01", to: "" }],
    ["a missing from", { to: "2026-08-31" }],
  ])("refuses %s with the notice, never an error", (_, params) => {
    expect(parse(params).rejectedRange).toBe(true);
  });

  it("ignores a period that is not a string", () => {
    expect(parse({ period: 7 }).preset).toBe("30d");
    expect(parse({ period: { x: 1 } }).preset).toBe("30d");
  });
});

describe("bucket coverage", () => {
  // covers: AC-11. Every day of the window sits in exactly one bucket, so the chart's bars add
  // up to the cards.
  it.each([
    ["30 days", { period: "30d" }, "day", 30],
    ["91 days, Monday to Sunday", { from: "2026-07-20", to: "2026-10-18" }, "week", 13],
    ["12 months", { period: "12m" }, "month", 12],
  ])("splits %s into contiguous buckets", (_, params, unit, count) => {
    const window = parse(params);
    expect(window.unit).toBe(unit);
    expect(window.buckets).toHaveLength(count);
    expect(window.buckets[0]?.firstDay).toBe(window.current.firstDay);
    const firstDays = window.buckets.map((bucket) => bucket.firstDay);
    expect([...firstDays].sort()).toEqual(firstDays);
    expect(new Set(window.buckets.map((bucket) => bucket.key)).size).toBe(count);
  });

  it("starts every later week on a Monday", () => {
    const window = parse({ from: "2026-07-20", to: "2026-10-18" });
    for (const bucket of window.buckets.slice(1)) {
      expect(new Date(`${bucket.firstDay}T00:00:00Z`).getUTCDay()).toBe(1);
      expect(bucket.firstDay).toBe(bucket.key);
    }
  });
});
