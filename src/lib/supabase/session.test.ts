import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { endLocalSession } from "./session";

const { clearAuthCookies } = vi.hoisted(() => ({ clearAuthCookies: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("./server", () => ({ clearAuthCookies }));

function clientSigningOut(result: { error: unknown }) {
  const signOut = vi.fn().mockResolvedValue(result);
  return { signOut, client: { auth: { signOut } } as unknown as SupabaseClient };
}

beforeEach(() => {
  clearAuthCookies.mockReset();
});

describe("endLocalSession", () => {
  it("signs out on this device only, never globally", async () => {
    const { signOut, client } = clientSigningOut({ error: null });

    await endLocalSession(client);

    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(clearAuthCookies).not.toHaveBeenCalled();
  });

  it("clears the auth cookies by hand when the Auth server call fails", async () => {
    const { client } = clientSigningOut({ error: { status: 503 } });

    await endLocalSession(client);

    expect(clearAuthCookies).toHaveBeenCalledOnce();
  });
});
