-- spec 0014, AC-19. created_by_admin_id is NOT NULL with no default: no code exists before this
-- feature ships, so the table is empty when this runs.
-- AlterTable
ALTER TABLE "discount_codes" ADD COLUMN     "created_by_admin_id" UUID NOT NULL,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "updated_by_admin_id" UUID;

-- CreateIndex
CREATE INDEX "discount_codes_created_by_admin_id_idx" ON "discount_codes"("created_by_admin_id");

-- CreateIndex
CREATE INDEX "discount_codes_updated_by_admin_id_idx" ON "discount_codes"("updated_by_admin_id");

-- AddForeignKey
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_updated_by_admin_id_fkey" FOREIGN KEY ("updated_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Raw SQL: what Prisma cannot express (spec 0014) ────────────────────────
-- CHECK constraints are invisible to `prisma migrate dev` drift detection, so they live only here.
-- orders.discount_code_id already has its index (orders_discount_code_id_idx, spec 0002).

ALTER TABLE "discount_codes"
  ADD CONSTRAINT "discount_codes_code_format_check" CHECK ("code" ~ '^[A-Z0-9-]{3,32}$'),
  ADD CONSTRAINT "discount_codes_note_length_check" CHECK (char_length("note") <= 500);
