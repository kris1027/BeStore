import { z } from "zod";

// Pure: the inputs of every admin order action (spec 0010, API surface), shared by the forms
// and the actions. Text is trimmed; carrier and tracking save an empty value as null.

export const REASON_MAX_LENGTH = 500;
export const NOTE_MAX_LENGTH = 1000;
export const TRACKING_MAX_LENGTH = 100;

// What the page was rendered with, posted back so the action can refuse a stale form (AC-8).
const orderRef = {
  orderNumber: z.number().int().min(1001).max(2_147_483_647),
  expectedUpdatedAt: z.iso.datetime(),
};

const optionalText = (label: string) =>
  z
    .string()
    .trim()
    .max(TRACKING_MAX_LENGTH, `Keep the ${label} under ${TRACKING_MAX_LENGTH} characters.`)
    .transform((text) => (text === "" ? null : text));

export const reasonField = z
  .string()
  .trim()
  .min(1, "Give a reason.")
  .max(REASON_MAX_LENGTH, `Keep the reason under ${REASON_MAX_LENGTH} characters.`);

export const noteField = z
  .string()
  .trim()
  .min(1, "Write a note.")
  .max(NOTE_MAX_LENGTH, `Keep the note under ${NOTE_MAX_LENGTH} characters.`);

export const trackingSchema = z.object({
  ...orderRef,
  carrier: optionalText("carrier"),
  trackingNumber: optionalText("tracking number"),
});

export const orderOnlySchema = z.object(orderRef);

export const reasonSchema = z.object({ ...orderRef, reason: reasonField });

export const noteSchema = z.object({ orderNumber: orderRef.orderNumber, note: noteField });

export const resolveSchema = z.object({ ...orderRef, note: noteField });

export const refundSchema = z.object({
  ...orderRef,
  lines: z
    .array(
      z.object({
        orderLineId: z.uuid(),
        quantity: z.number().int().min(1).max(100_000),
        restock: z.boolean(),
      }),
    )
    .max(200),
  refundShipping: z.boolean(),
  // In currency units as typed ("12.50"); the action turns it into cents with parseMoney.
  amount: z.string().trim().max(20),
  reason: reasonField,
});

export const cancelSchema = z.object({
  ...orderRef,
  reason: reasonField,
  restockLineIds: z.array(z.uuid()).max(200),
});

export const checkRefundSchema = z.object({
  orderNumber: orderRef.orderNumber,
  refundId: z.uuid(),
});

export function pathErrors(error: z.ZodError): Record<string, readonly string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "root";
    (fields[path] ??= []).push(issue.message);
  }
  return fields;
}
