-- AlterTable
ALTER TABLE "email_sends" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cancelled_wording" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "error_code" TEXT,
ADD COLUMN     "last_attempt_at" TIMESTAMPTZ(3),
ADD COLUMN     "queued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "refund_id" UUID,
ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- CreateIndex
CREATE INDEX "email_sends_refund_id_idx" ON "email_sends"("refund_id");

-- CreateIndex
CREATE INDEX "email_sends_pending_queued_idx" ON "email_sends"("queued_at") WHERE (status = 'pending'::email_send_status);

-- AddForeignKey
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Raw SQL: what Prisma cannot express (spec 0011) ────────────────────────
-- CHECK constraints are invisible to `prisma migrate dev` drift detection, so they live only here.
-- The id default is gen_random_uuid(): Postgres 17 has no uuidv7().

-- A refund email names its refund, and only a refund email does.
ALTER TABLE "email_sends"
  ADD CONSTRAINT "email_sends_refund_id_check"
    CHECK (("kind" = 'order_refunded') = ("refund_id" IS NOT NULL)),
  ADD CONSTRAINT "email_sends_attempts_check" CHECK ("attempts" >= 0),
  -- The "cancelled and refunded" wording exists only on refund emails (AC-3).
  ADD CONSTRAINT "email_sends_cancelled_wording_check"
    CHECK (NOT "cancelled_wording" OR "kind" = 'order_refunded');
