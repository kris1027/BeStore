import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { parseArgs } from "node:util";

// Shared by the admin:* scripts: flags, a hidden prompt, and a clean exit on failure.

export function readFlags<const K extends string>(names: readonly K[]) {
  const { values } = parseArgs({
    options: {
      ...Object.fromEntries(names.map((name) => [name, { type: "string" as const }])),
      "env-file": { type: "string" },
    },
    strict: true,
  });
  return values as Partial<Record<K | "env-file", string>>;
}

// The password is typed, never passed as a flag, so it stays out of shell history. One
// interface for the whole script: its line iterator buffers input, so piped lines are not lost.
export function createPrompter() {
  let muted = false;
  const output = new Writable({
    write(chunk: Buffer, encoding: BufferEncoding, callback: () => void) {
      if (!muted) process.stdout.write(chunk, encoding);
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: process.stdin.isTTY });
  const lines = rl[Symbol.asyncIterator]();

  return {
    async hidden(question: string): Promise<string> {
      process.stdout.write(question);
      muted = true;
      try {
        const line = await lines.next();
        if (line.done) throw new Error("No input.");
        return line.value;
      } finally {
        muted = false;
        process.stdout.write("\n");
      }
    },
    close: () => rl.close(),
  };
}

export function run(main: () => Promise<void>) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
