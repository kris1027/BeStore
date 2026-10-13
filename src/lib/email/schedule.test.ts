import { beforeEach, describe, expect, it, vi } from "vitest";

// scheduleDelivery is the one after() call (spec 0011, AC-8). It must hand only real ids to
// delivery, skip after() when a transaction queued nothing, and never throw to the caller: a
// webhook answer or an admin action must not fail because scheduling did.

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  deliverAll: vi.fn(),
  logEmailDeliveryError: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("./deliver", () => ({ deliverAll: mocks.deliverAll }));
vi.mock("./log", () => ({ logEmailDeliveryError: mocks.logEmailDeliveryError }));

const { scheduleDelivery } = await import("./schedule");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deliverAll.mockResolvedValue(undefined);
});

describe("scheduleDelivery", () => {
  // covers: AC-8
  it("delivers the queued ids after the response, dropping the nulls", async () => {
    scheduleDelivery(["a", null, "b"]);

    expect(mocks.after).toHaveBeenCalledOnce();
    expect(mocks.deliverAll).not.toHaveBeenCalled();
    const task = mocks.after.mock.calls[0]![0] as () => Promise<void>;
    await task();
    expect(mocks.deliverAll).toHaveBeenCalledWith(["a", "b"]);
  });

  it.each([[[]], [[null]], [[null, null]]])(
    "does not call after() when nothing was queued (%j)",
    (ids) => {
      scheduleDelivery(ids);

      expect(mocks.after).not.toHaveBeenCalled();
    },
  );

  // covers: AC-8 (a scheduling failure never fails the order change)
  it("logs each id and does not throw when after() throws", () => {
    const outsideRequest = new Error("`after` was called outside a request scope");
    mocks.after.mockImplementation(() => {
      throw outsideRequest;
    });

    expect(() => scheduleDelivery(["a", null, "b"])).not.toThrow();
    expect(mocks.logEmailDeliveryError.mock.calls).toEqual([
      ["a", outsideRequest],
      ["b", outsideRequest],
    ]);
  });
});
