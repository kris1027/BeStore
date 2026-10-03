-- CreateEnum
CREATE TYPE "stock_movement_kind" AS ENUM ('initial', 'adjustment', 'sale');

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "kind" "stock_movement_kind" NOT NULL,
    "delta" INTEGER NOT NULL,
    "stock_after" INTEGER NOT NULL,
    "actor_type" "actor_type" NOT NULL,
    "admin_id" UUID,
    "order_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_movements_variant_id_created_at_idx" ON "stock_movements"("variant_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_order_id_idx" ON "stock_movements"("order_id");

-- CreateIndex
CREATE INDEX "stock_movements_admin_id_idx" ON "stock_movements"("admin_id");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Raw SQL: what Prisma cannot express (spec 0009) ────────────────────────
-- CHECK constraints are invisible to `prisma migrate dev` drift detection, so they live only here.

ALTER TABLE "stock_movements"
  -- stock_after is the variant's new stock_quantity, which its own CHECK keeps at 0 or more.
  ADD CONSTRAINT "stock_movements_stock_after_check" CHECK ("stock_after" >= 0),
  -- Only the opening row may record no change (a variant created at stock 0).
  ADD CONSTRAINT "stock_movements_delta_check" CHECK ("delta" <> 0 OR "kind" = 'initial'),
  ADD CONSTRAINT "stock_movements_actor_check" CHECK (("actor_type" = 'admin') = ("admin_id" IS NOT NULL)),
  ADD CONSTRAINT "stock_movements_sale_order_check" CHECK (("kind" = 'sale') = ("order_id" IS NOT NULL)),
  ADD CONSTRAINT "stock_movements_sale_actor_check" CHECK ("kind" <> 'sale' OR "actor_type" = 'system'),
  ADD CONSTRAINT "stock_movements_adjustment_actor_check" CHECK ("kind" <> 'adjustment' OR "actor_type" = 'admin'),
  ADD CONSTRAINT "stock_movements_note_check"
    CHECK ("note" IS NULL OR ("kind" = 'adjustment' AND char_length("note") <= 200));

-- Every variant that exists before this migration starts its history from a known count
-- (AC-12). Ids are UUID v7 built inline, since Postgres 17 has no uuidv7(): a 48 bit
-- millisecond timestamp over gen_random_uuid(), with the version nibble set from 4 to 7.
INSERT INTO "stock_movements" ("id", "variant_id", "kind", "delta", "stock_after", "actor_type", "created_at")
SELECT
  encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
          FROM 1 FOR 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid,
  "id", 'initial', "stock_quantity", "stock_quantity", 'system', now()
FROM "product_variants";

-- Row level security: on, no policies (reached only through Prisma on the server).
ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;
