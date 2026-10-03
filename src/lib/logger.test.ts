import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { createAdminEventLogger, createLogger, redactedKeys } from "./logger";

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { logger: createLogger(stream), lines };
}

describe("logger redaction (spec 0004, AC-13)", () => {
  it.each(redactedKeys)("hides %s at every depth", (key) => {
    const { logger, lines } = capture();
    const secret = `leak-${key}`;
    logger.info({
      [key]: secret,
      a: { [key]: secret, b: { [key]: secret, c: { [key]: secret, d: { [key]: secret } } } },
    });
    expect(lines.join("")).not.toContain(secret);
    expect(lines.join("")).toContain("[redacted]");
  });
});

describe("createAdminEventLogger", () => {
  it("logs the event name as the message with the admin id and fields", () => {
    const { logger, lines } = capture();
    const log = createAdminEventLogger<{ "thing.done": { readonly count: number } }>(logger);
    log("thing.done", { adminId: "admin-1", count: 3 });
    expect(JSON.parse(lines.join(""))).toMatchObject({
      level: 30,
      msg: "thing.done",
      event: "thing.done",
      adminId: "admin-1",
      count: 3,
    });
  });
});
