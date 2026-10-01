-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "pii_purged_at" TIMESTAMPTZ(3),
ALTER COLUMN "email" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "orders_purge_due_idx" ON "orders"("expired_at") WHERE (status = 'expired'::order_status AND pii_purged_at IS NULL);

-- ─── Raw SQL: what Prisma cannot express (spec 0008) ────────────────────────
-- CHECK constraints are invisible to `prisma migrate dev` drift detection, so they live only here.

-- An expired order from before markExpired stamped expired_at gets its last change as the expiry
-- time, so the expired_at CHECK below holds for old rows too.
UPDATE "orders" SET "expired_at" = "updated_at" WHERE "status" = 'expired' AND "expired_at" IS NULL;

ALTER TABLE "orders"
  -- Every order the purge has not reached still has an email.
  ADD CONSTRAINT "orders_email_present_check" CHECK ("email" IS NOT NULL OR "pii_purged_at" IS NOT NULL),
  -- Only an expired order can be purged, so no code path can strip a paid order's customer data.
  ADD CONSTRAINT "orders_purge_only_expired_check" CHECK ("pii_purged_at" IS NULL OR "status" = 'expired'),
  -- The purge finds due orders by expired_at, so an expired order without one would be kept forever.
  ADD CONSTRAINT "orders_expired_at_present_check" CHECK ("status" <> 'expired' OR "expired_at" IS NOT NULL);
