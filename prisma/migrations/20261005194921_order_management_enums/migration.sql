-- Enum values for admin order management (spec 0010). A separate migration because Postgres
-- refuses to use a new enum value in the transaction that adds it, and the next migration's
-- CHECKs name 'return'.

-- AlterEnum
ALTER TYPE "order_event_type" ADD VALUE 'tracking_updated';
ALTER TYPE "order_event_type" ADD VALUE 'attention_cleared';

-- AlterEnum
ALTER TYPE "stock_movement_kind" ADD VALUE 'return';
