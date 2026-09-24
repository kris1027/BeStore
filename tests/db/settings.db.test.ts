import { describe, expect, it } from "vitest";

import { expectViolation, SQLSTATE, testDb, resetDatabaseBeforeEach } from "./client";

resetDatabaseBeforeEach();

// AC-9: the migration inserts the one settings row; a second is impossible.
describe("store settings", () => {
  it("holds exactly one row, id 1, flat shipping 0 and no free shipping threshold", async () => {
    const rows = await testDb.storeSettings.findMany();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 1,
      flatShippingCents: 0,
      freeShippingThresholdCents: null,
    });
  });

  it("rejects a second row", async () => {
    await expectViolation(
      testDb.$executeRaw`INSERT INTO store_settings (id) VALUES (2)`,
      SQLSTATE.check,
      "store_settings_singleton_check",
    );
    await expectViolation(
      testDb.storeSettings.create({ data: {} }),
      SQLSTATE.unique,
      "store_settings_pkey",
    );
  });

  it("rejects negative shipping amounts", async () => {
    await expectViolation(
      testDb.storeSettings.update({ where: { id: 1 }, data: { flatShippingCents: -1 } }),
      SQLSTATE.check,
      "store_settings_flat_shipping_cents_check",
    );
  });
});
