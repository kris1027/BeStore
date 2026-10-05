-- AlterTable
ALTER TABLE "refund_lines" ADD COLUMN     "restock" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "returned_quantity" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "refunds" ADD COLUMN     "includes_shipping" BOOLEAN NOT NULL DEFAULT false;

-- ─── Raw SQL: what Prisma cannot express (spec 0010) ────────────────────────
-- CHECK constraints are invisible to `prisma migrate dev` drift detection, so they live only here.

-- A line is only marked restocked when the admin asked for it, and restocked means some units
-- came back: returned_quantity is what the refund's `return` movement put back for this line,
-- never more than the line refunded.
ALTER TABLE "refund_lines"
  ADD CONSTRAINT "refund_lines_restocked_check" CHECK (NOT "restocked" OR "restock"),
  ADD CONSTRAINT "refund_lines_returned_quantity_check"
    CHECK ("returned_quantity" BETWEEN 0 AND "quantity"),
  ADD CONSTRAINT "refund_lines_returned_restocked_check"
    CHECK ("restocked" = ("returned_quantity" > 0));

-- A refund puts stock back for one order, so `return` carries the order like `sale` does, and
-- it is always an admin's refund (system refunds from the Stripe dashboard never restock).
-- The existing stock_movements_note_check already keeps a note off a `return` row.
ALTER TABLE "stock_movements"
  DROP CONSTRAINT "stock_movements_sale_order_check",
  ADD CONSTRAINT "stock_movements_order_check"
    CHECK (("kind" IN ('sale', 'return')) = ("order_id" IS NOT NULL)),
  ADD CONSTRAINT "stock_movements_return_actor_check"
    CHECK ("kind" <> 'return' OR "actor_type" = 'admin');
