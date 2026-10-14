import { Webhook } from "standardwebhooks";
import { beforeEach, describe, expect, it, vi } from "vitest";

// spec 0012, AC-8 and AC-24: the hook route checks the signature over the raw body, picks the
// email, sends it once with a short timeout, and answers in the shape Supabase reads.

const secret = "v1,whsec_dGVzdC1ob29rLXNlY3JldC0wMTIzNDU2Nzg5";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  runsTheStore: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  env: {
    SEND_EMAIL_HOOK_SECRET: "v1,whsec_dGVzdC1ob29rLXNlY3JldC0wMTIzNDU2Nzg5",
    NEXT_PUBLIC_SITE_URL: "https://shop.example",
    STORE_LOCALE: "en",
    EMAIL_FROM_ADDRESS: "orders@example.com",
  },
}));
vi.mock("@/lib/customer/store-admin", () => ({ runsTheStore: mocks.runsTheStore }));
vi.mock("./transport", () => ({ currentTransport: () => ({ name: "log", send: mocks.send }) }));
vi.mock("@/lib/logger", () => ({
  logger: { info: mocks.info, warn: mocks.warn, error: mocks.error },
}));

const { AUTH_EMAIL_TIMEOUT_MS, handleSendEmailHook } = await import("./send-auth-email");

const userId = "8b4a7e2c-3f6d-4c1a-9e8b-2d5f7a1c3e9b";

function payload(type: string, tokenHash = "pkce_token_hash") {
  return JSON.stringify({
    user: { id: userId, email: "ada@example.com", aud: "authenticated" },
    email_data: {
      token: "123456",
      token_hash: tokenHash,
      redirect_to: "https://shop.example/account/set-password",
      email_action_type: type,
      site_url: "https://shop.example",
    },
  });
}

function signedRequest(body: string, key = secret) {
  const id = "msg_1";
  const signature = new Webhook(key.replace("v1,whsec_", "")).sign(id, new Date(), body);
  return new Request("https://shop.example/api/auth/send-email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
      "webhook-signature": signature,
    },
    body,
  });
}

function loggedText(): string {
  return JSON.stringify([
    ...mocks.info.mock.calls,
    ...mocks.warn.mock.calls,
    ...mocks.error.mock.calls,
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.send.mockResolvedValue({ ok: true, resendId: "re_1" });
  mocks.runsTheStore.mockResolvedValue(false);
});

describe("handleSendEmailHook", () => {
  it("sends the confirm email to the signed recipient with a hashed idempotency key", async () => {
    const response = await handleSendEmailHook(signedRequest(payload("signup")));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    const [email, options] = mocks.send.mock.calls[0]!;
    expect(email.to).toBe("ada@example.com");
    expect(email.subject).toBe("Confirm your email");
    expect(email.html).toContain(
      "https://shop.example/account/confirm?token_hash=pkce_token_hash&amp;type=signup",
    );
    expect(email.text).toContain("/account/confirm?token_hash=pkce_token_hash&type=signup");
    expect(email.idempotencyKey).toMatch(/^auth:signup:[0-9a-f]{64}$/);
    expect(options).toEqual({ timeoutMs: AUTH_EMAIL_TIMEOUT_MS });
    expect(AUTH_EMAIL_TIMEOUT_MS).toBe(4_000);
    expect(mocks.runsTheStore).not.toHaveBeenCalled();
    expect(mocks.info).toHaveBeenCalledWith(
      { event: "auth_email.sent", kind: "confirm_signup", userId },
      "auth_email.sent",
    );
  });

  it("sends the customer reset to someone who does not run the store", async () => {
    await handleSendEmailHook(signedRequest(payload("recovery")));

    const [email] = mocks.send.mock.calls[0]!;
    expect(mocks.runsTheStore).toHaveBeenCalledWith(userId);
    expect(email.subject).toBe("Reset your password");
    expect(email.html).toContain("/account/confirm?token_hash=pkce_token_hash&amp;type=recovery");
  });

  it("sends the admin reset to /auth/confirm for an admin, whatever the redirect says", async () => {
    mocks.runsTheStore.mockResolvedValue(true);

    await handleSendEmailHook(signedRequest(payload("recovery")));

    const [email] = mocks.send.mock.calls[0]!;
    expect(email.subject).toBe("Reset your admin password");
    expect(email.html).toContain("/auth/confirm?token_hash=pkce_token_hash&amp;type=recovery");
    expect(email.html).not.toContain("/account/confirm");
  });

  it("refuses a bad signature with 401 and sends nothing", async () => {
    const response = await handleSendEmailHook(
      signedRequest(payload("signup"), "v1,whsec_b3RoZXItc2VjcmV0LW90aGVyLXNlY3JldA=="),
    );

    expect(response.status).toBe(401);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith(
      { event: "auth_email.bad_signature" },
      "auth_email.bad_signature",
    );
  });

  it("refuses a body changed after signing", async () => {
    const request = signedRequest(payload("signup"));
    const tampered = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: payload("signup", "another_hash"),
    });

    expect((await handleSendEmailHook(tampered)).status).toBe(401);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("refuses a stale timestamp", async () => {
    const body = payload("signup");
    const old = new Date(Date.now() - 10 * 60 * 1000);
    const signature = new Webhook(secret.replace("v1,whsec_", "")).sign("msg_2", old, body);
    const request = new Request("https://shop.example/api/auth/send-email", {
      method: "POST",
      headers: {
        "webhook-id": "msg_2",
        "webhook-timestamp": String(Math.floor(old.getTime() / 1000)),
        "webhook-signature": signature,
      },
      body,
    });

    expect((await handleSendEmailHook(request)).status).toBe(401);
  });

  it.each(["magiclink", "invite", "email_change", "reauthentication"])(
    "answers 400 to the unused type %s and sends nothing",
    async (type) => {
      const response = await handleSendEmailHook(signedRequest(payload(type)));

      expect(response.status).toBe(400);
      expect(mocks.send).not.toHaveBeenCalled();
      expect(mocks.warn).toHaveBeenCalledWith(
        { event: "auth_email.unexpected_type" },
        "auth_email.unexpected_type",
      );
    },
  );

  it("answers 500 in Supabase's error shape when the send fails, and logs it as an error", async () => {
    mocks.send.mockResolvedValue({
      ok: false,
      failure: { name: "application_error", statusCode: null },
    });

    const response = await handleSendEmailHook(signedRequest(payload("signup")));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { http_code: 500, message: "send failed" } });
    expect(mocks.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "auth_email.failed",
        kind: "confirm_signup",
        errorName: "application_error",
      }),
      "auth_email.failed",
    );
  });

  it("answers 500 when the admin lookup throws", async () => {
    mocks.runsTheStore.mockRejectedValue(new Error("connection refused"));

    expect((await handleSendEmailHook(signedRequest(payload("recovery")))).status).toBe(500);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("counts a send Resend already took under this key as sent", async () => {
    mocks.send.mockResolvedValue({
      ok: false,
      failure: { name: "invalid_idempotent_request", statusCode: 409 },
    });

    expect((await handleSendEmailHook(signedRequest(payload("signup")))).status).toBe(200);
  });

  it("never logs the address, the token hash or the link", async () => {
    await handleSendEmailHook(signedRequest(payload("signup")));
    mocks.send.mockResolvedValue({ ok: false, failure: { name: "x", statusCode: 500 } });
    await handleSendEmailHook(signedRequest(payload("recovery")));

    const logged = loggedText();
    expect(logged).not.toContain("ada@example.com");
    expect(logged).not.toContain("pkce_token_hash");
    expect(logged).not.toContain("auth:");
  });
});
