import "server-only";

import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { orderHoldsUse } from "@/lib/discounts/codes";
import { type CodeStatus, codeStatus, type DiscountType } from "@/lib/discounts/rule";
import { escapeLike } from "@/lib/like";

import type { DiscountListParams } from "./list-params";

// Not cached: the admin always sees the live tables. Callers run requireAdmin() first.

// spec 0014, AC-10: one page, no paging.
export const DISCOUNT_LIST_LIMIT = 200;

export type DiscountCodeSummary = {
  readonly id: string;
  readonly code: string;
  readonly type: DiscountType;
  readonly value: number;
  readonly status: CodeStatus;
  // Under the AC-3 use rule: paid, or pending and under 35 minutes old.
  readonly uses: number;
  readonly maxRedemptions: number | null;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  // Sum of orders.discount_cents over paid orders with the code.
  readonly discountGivenCents: number;
};

export type DiscountCodeList = {
  readonly rows: readonly DiscountCodeSummary[];
  // More codes match than the page shows ("Showing the newest 200 codes").
  readonly truncated: boolean;
};

type RawSummary = {
  id: string;
  code: string;
  type: DiscountType;
  value: number;
  active: boolean;
  starts_at: Date | null;
  ends_at: Date | null;
  max_redemptions: number | null;
  uses: bigint;
  given: bigint;
  db_now: Date;
};

// Uses and discount given from grouped subqueries, the status worked out in SQL with the
// database clock (the same rule as codeStatus), so the filter applies before the 200 cap.
function summaries(where: Prisma.Sql, limit: number) {
  return db.$queryRaw<RawSummary[]>`
    SELECT * FROM (
      SELECT c.id, c.code, c.type::text AS type, c.value, c.active, c.starts_at, c.ends_at,
             c.max_redemptions, c.created_at, now() AS db_now,
             coalesce(u.uses, 0) AS uses, coalesce(g.given, 0) AS given,
             CASE
               WHEN NOT c.active THEN 'inactive'
               WHEN c.max_redemptions IS NOT NULL AND coalesce(u.uses, 0) >= c.max_redemptions
                 THEN 'used_up'
               WHEN c.ends_at IS NOT NULL AND c.ends_at <= now() THEN 'expired'
               WHEN c.starts_at IS NOT NULL AND c.starts_at > now() THEN 'scheduled'
               ELSE 'active'
             END AS status
      FROM discount_codes c
      LEFT JOIN (
        SELECT r.discount_code_id, count(*) AS uses
        FROM discount_redemptions r JOIN orders o ON o.id = r.order_id
        WHERE ${orderHoldsUse}
        GROUP BY r.discount_code_id
      ) u ON u.discount_code_id = c.id
      LEFT JOIN (
        SELECT discount_code_id, sum(discount_cents) AS given
        FROM orders WHERE paid_at IS NOT NULL AND discount_code_id IS NOT NULL
        GROUP BY discount_code_id
      ) g ON g.discount_code_id = c.id
    ) listed
    WHERE ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}`;
}

function toSummary(row: RawSummary): DiscountCodeSummary {
  const uses = Number(row.uses);
  return {
    id: row.id,
    code: row.code,
    type: row.type,
    value: row.value,
    status: codeStatus(
      {
        active: row.active,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        maxRedemptions: row.max_redemptions,
      },
      uses,
      row.db_now,
    ),
    uses,
    maxRedemptions: row.max_redemptions,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    discountGivenCents: Number(row.given),
  };
}

// spec 0014, AC-10: newest first; search and the status filter first, then at most 200 rows.
export async function getDiscountCodes(params: DiscountListParams): Promise<DiscountCodeList> {
  const terms: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (params.q !== "") terms.push(Prisma.sql`code ILIKE ${`%${escapeLike(params.q)}%`}`);
  if (params.status !== null) terms.push(Prisma.sql`status = ${params.status}`);
  const rows = await summaries(Prisma.join(terms, " AND "), DISCOUNT_LIST_LIMIT + 1);
  return {
    rows: rows.slice(0, DISCOUNT_LIST_LIMIT).map(toSummary),
    truncated: rows.length > DISCOUNT_LIST_LIMIT,
  };
}

export type DiscountCodeForEdit = DiscountCodeSummary & {
  readonly perCustomerLimit: number | null;
  readonly minSubtotalCents: number | null;
  readonly active: boolean;
  readonly note: string | null;
  // The form's copy for the stale check, to the millisecond.
  readonly updatedAt: string;
  // AC-12: code, type and value lock once any redemption exists.
  readonly redeemed: boolean;
};

const idSchema = z.uuid();

// spec 0014, AC-12: one code with its uses and discount given, or null for a bad or unknown id.
export async function getDiscountCodeForEdit(
  idParam: unknown,
): Promise<DiscountCodeForEdit | null> {
  const id = idSchema.safeParse(idParam);
  if (!id.success) return null;
  const [summary] = await summaries(Prisma.sql`id = ${id.data}::uuid`, 1);
  if (summary === undefined) return null;
  const code = await db.discountCode.findUnique({
    where: { id: id.data },
    select: {
      perCustomerLimit: true,
      minSubtotalCents: true,
      active: true,
      note: true,
      updatedAt: true,
      _count: { select: { redemptions: true } },
    },
  });
  if (code === null) return null;
  return {
    ...toSummary(summary),
    perCustomerLimit: code.perCustomerLimit,
    minSubtotalCents: code.minSubtotalCents,
    active: code.active,
    note: code.note,
    updatedAt: code.updatedAt.toISOString(),
    redeemed: code._count.redemptions > 0,
  };
}
