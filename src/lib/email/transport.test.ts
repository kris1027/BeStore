import { beforeEach, describe, expect, it, vi } from "vitest";

// The two transports (spec 0011, AC-7, AC-8, AC-16): `log` must never reach Resend, and `resend`
// must send from EMAIL_FROM with no Reply-To, carry the row's dedupe_key as the idempotency key,
// cap each call, and turn the SDK's { error } answer into a failure the classifier reads.

const mocks = vi.hoisted(() => ({
  env: {
    EMAIL_TRANSPORT: "log" as "log" | "resend" | "mailpit",
    RESEND_API_KEY: "re_test_key" as string | undefined,
    MAILPIT_URL: "http://127.0.0.1:55324",
    EMAIL_FROM: "BeStore <orders@example.com>",
  },
  constructed: vi.fn(),
  send: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: mocks.env }));
vi.mock("resend", () => ({
  Resend: class {
    readonly emails = { send: mocks.send };
    constructor(key: string | undefined) {
      mocks.constructed(key);
    }
  },
}));

const { currentTransport, EMAIL_SEND_TIMEOUT_MS } = await import("./transport");

const email = {
  to: "ada@example.com",
  subject: "Order #1042 confirmed",
  html: "<p>Hi Ada,</p>",
  text: "Hi Ada,",
  idempotencyKey: "order_confirmation:6f1c",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.EMAIL_TRANSPORT = "log";
  mocks.env.RESEND_API_KEY = "re_test_key";
  mocks.send.mockResolvedValue({ data: { id: "re_email_1" }, error: null });
});

describe("the log transport", () => {
  it("is picked by EMAIL_TRANSPORT=log and answers sent with no Resend id", async () => {
    const transport = currentTransport();

    expect(transport.name).toBe("log");
    expect(await transport.send(email)).toEqual({ ok: true, resendId: null });
  });

  it("never builds a Resend client or sends anything", async () => {
    await currentTransport().send(email);

    expect(mocks.constructed).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe("the resend transport", () => {
  beforeEach(() => {
    mocks.env.EMAIL_TRANSPORT = "resend";
  });

  it("is picked by EMAIL_TRANSPORT=resend and uses the API key", async () => {
    const transport = currentTransport();
    await transport.send(email);

    expect(transport.name).toBe("resend");
    expect(mocks.constructed).toHaveBeenCalledWith("re_test_key");
  });

  // covers: AC-7, AC-8
  it("sends from EMAIL_FROM with no Reply-To and the dedupe key as the idempotency key", async () => {
    await currentTransport().send(email);

    expect(mocks.send).toHaveBeenCalledOnce();
    const [payload, options] = mocks.send.mock.calls[0]!;
    expect(payload).toEqual({
      from: "BeStore <orders@example.com>",
      to: "ada@example.com",
      subject: "Order #1042 confirmed",
      html: "<p>Hi Ada,</p>",
      text: "Hi Ada,",
    });
    expect(payload).not.toHaveProperty("replyTo");
    expect(payload).not.toHaveProperty("reply_to");
    expect(options).toMatchObject({ idempotencyKey: "order_confirmation:6f1c" });
  });

  // covers: AC-8 (each call capped at 10 seconds)
  it("caps each call with an abort signal", async () => {
    await currentTransport().send(email);

    const [, options] = mocks.send.mock.calls[0]!;
    expect(EMAIL_SEND_TIMEOUT_MS).toBe(10_000);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.signal.aborted).toBe(false);
  });

  it("returns Resend's id on success", async () => {
    expect(await currentTransport().send(email)).toEqual({ ok: true, resendId: "re_email_1" });
  });

  it("returns a null id when Resend answers no data", async () => {
    mocks.send.mockResolvedValue({ data: null, error: null });

    expect(await currentTransport().send(email)).toEqual({ ok: true, resendId: null });
  });

  // covers: AC-9 (the classifier reads only the name and status code)
  it.each([
    ["validation_error", 422],
    ["invalid_idempotent_request", 409],
    ["rate_limit_exceeded", 429],
    ["application_error", null],
  ])("passes a %s error on as a failure with status %s", async (name, statusCode) => {
    mocks.send.mockResolvedValue({
      data: null,
      error: { name, statusCode, message: "The to address ada@example.com is invalid" },
    });

    expect(await currentTransport().send(email)).toEqual({
      ok: false,
      failure: { name, statusCode },
    });
  });
});

// spec 0012, AC-23: every email lands in Mailpit, so e2e can read it.
describe("the mailpit transport", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    mocks.env.EMAIL_TRANSPORT = "mailpit";
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ID: "abc" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  it("posts the email to Mailpit's send API and never reaches Resend", async () => {
    const transport = currentTransport();
    const result = await transport.send(email);

    expect(transport.name).toBe("mailpit");
    expect(result).toEqual({ ok: true, resendId: null });
    expect(mocks.send).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("http://127.0.0.1:55324/api/v1/send");
    expect(JSON.parse(init.body)).toEqual({
      From: { Email: "orders@example.com", Name: "BeStore" },
      To: [{ Email: "ada@example.com" }],
      Subject: "Order #1042 confirmed",
      HTML: "<p>Hi Ada,</p>",
      Text: "Hi Ada,",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("answers a failure with Mailpit's status", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));

    expect(await currentTransport().send(email)).toEqual({
      ok: false,
      failure: { name: "mailpit_error", statusCode: 500 },
    });
  });

  it("answers a network error as a failure with no status", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    expect(await currentTransport().send(email)).toEqual({
      ok: false,
      failure: { name: "TypeError", statusCode: null },
    });
  });
});
