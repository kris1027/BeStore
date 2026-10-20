-- spec 0017, AC-11: the terms of sale version accepted at Pay, and when. Both nullable: orders
-- from before this feature keep both null and the admin shows "not recorded". orders already has
-- RLS on, and the columns are never filtered on, so no index.
-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "terms_accepted_at" TIMESTAMPTZ(3),
ADD COLUMN     "terms_version" DATE;

-- ─── Raw SQL: what Prisma cannot express (spec 0017) ────────────────────────
-- CHECK constraints are invisible to `prisma migrate dev` drift detection, so they live only here.

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_terms_acceptance_check"
  CHECK (("terms_version" IS NULL) = ("terms_accepted_at" IS NULL));
