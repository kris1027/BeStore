import { z } from "zod";

import { zonedDateTimeToUtc } from "@/lib/dates";
import type { DiscountType } from "@/lib/discounts/rule";
import { DISCOUNT_CODE_PATTERN } from "@/lib/discounts/schema";
import { parseMoney } from "@/lib/money";

// Pure: the promo code form (zodResolver) and the create and update actions parse with the same
// schema (spec 0014, AC-11 and Validation messages). Money is typed like the other admin money
// fields (parseMoney, a dot as the decimal mark); dates are `datetime-local` text read in the
// store's time zone. The form sends its raw values, so the server parses exactly what was typed.

export const NOTE_MAX_LENGTH = 500;

export const discountMessages = {
  codeEmpty: "Enter a code.",
  codeFormat: "Use 3 to 32 letters, digits or hyphens.",
  codeTaken: "A code with this name already exists.",
  type: "Choose a type.",
  percent: "Enter a whole percent from 1 to 100.",
  fixed: "Enter an amount above 0.",
  endBeforeStart: "The end must be after the start.",
  date: "Enter a valid date and time.",
  limit: "Enter a whole number above 0, or leave it empty.",
  minSubtotal: "Enter an amount above 0, or leave it empty.",
  note: "Keep the note under 500 characters.",
  active: "Choose whether the code is active.",
} as const;

export const discountFields = [
  "code",
  "type",
  "value",
  "startsAt",
  "endsAt",
  "maxRedemptions",
  "perCustomerLimit",
  "minSubtotal",
  "active",
  "note",
] as const;

export type DiscountField = (typeof discountFields)[number];

export type DiscountFieldErrors = Partial<Record<DiscountField, string>>;

// A Postgres integer; anything above can never be a real limit.
const MAX_INT = 2_147_483_647;

const text = (message: string) => z.string({ error: message });

export function discountCodeFieldsSchema(currency: string, timeZone: string) {
  return z
    .object({
      code: text(discountMessages.codeEmpty),
      // "" is the unchosen state of the radio group.
      type: z.enum(["percent", "fixed_amount", ""], { error: discountMessages.type }),
      value: text(discountMessages.percent),
      startsAt: text(discountMessages.date),
      endsAt: text(discountMessages.date),
      maxRedemptions: text(discountMessages.limit),
      perCustomerLimit: text(discountMessages.limit),
      minSubtotal: text(discountMessages.minSubtotal),
      active: z.boolean({ error: discountMessages.active }),
      note: text(discountMessages.note),
    })
    .transform((values, ctx) => {
      const issue = (path: DiscountField, message: string) =>
        ctx.addIssue({ code: "custom", path: [path], message });

      const code = values.code.trim().toUpperCase();
      if (code === "") issue("code", discountMessages.codeEmpty);
      else if (!DISCOUNT_CODE_PATTERN.test(code)) issue("code", discountMessages.codeFormat);

      const type = values.type === "" ? null : values.type;
      if (type === null) issue("type", discountMessages.type);

      const value = type === null ? null : codeValue(type, values.value, currency);
      if (value === null) {
        if (type === "percent") issue("value", discountMessages.percent);
        if (type === "fixed_amount") issue("value", discountMessages.fixed);
      }

      const startsAt = optionalDate(values.startsAt, timeZone);
      const endsAt = optionalDate(values.endsAt, timeZone);
      if (startsAt === undefined) issue("startsAt", discountMessages.date);
      if (endsAt === undefined) issue("endsAt", discountMessages.date);
      if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
        issue("endsAt", discountMessages.endBeforeStart);
      }

      const maxRedemptions = optionalLimit(values.maxRedemptions);
      if (maxRedemptions === undefined) issue("maxRedemptions", discountMessages.limit);
      const perCustomerLimit = optionalLimit(values.perCustomerLimit);
      if (perCustomerLimit === undefined) issue("perCustomerLimit", discountMessages.limit);

      const minSubtotalCents = optionalAmount(values.minSubtotal, currency);
      if (minSubtotalCents === undefined) issue("minSubtotal", discountMessages.minSubtotal);

      const note = values.note.trim();
      if (note.length > NOTE_MAX_LENGTH) issue("note", discountMessages.note);

      return {
        code,
        // Only reached as null once an issue was raised, so the parse fails.
        type: type ?? "percent",
        value: value ?? 0,
        startsAt: startsAt ?? null,
        endsAt: endsAt ?? null,
        maxRedemptions: maxRedemptions ?? null,
        perCustomerLimit: perCustomerLimit ?? null,
        minSubtotalCents: minSubtotalCents ?? null,
        active: values.active,
        note: note === "" ? null : note,
      };
    });
}

export type DiscountCodeValues = z.input<ReturnType<typeof discountCodeFieldsSchema>>;
export type DiscountCodeInput = z.output<ReturnType<typeof discountCodeFieldsSchema>>;

export const emptyDiscountValues: DiscountCodeValues = {
  code: "",
  type: "",
  value: "",
  startsAt: "",
  endsAt: "",
  maxRedemptions: "",
  perCustomerLimit: "",
  minSubtotal: "",
  active: true,
  note: "",
};

// The edit form adds the code's id and the updated_at it was loaded with (the stale check).
export const discountCodeRefSchema = z.object({
  id: z.uuid(),
  loadedUpdatedAt: z.iso.datetime().transform((value) => new Date(value)),
});

export const deleteDiscountCodeSchema = z.object({ id: z.uuid() });

function wholeNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const number = Number(trimmed);
  return number > MAX_INT ? null : number;
}

// The value in its column's unit: a whole percent from 1 to 100, or minor units above 0. null
// when it is not one.
function codeValue(type: DiscountType, text: string, currency: string): number | null {
  if (type === "percent") {
    const percent = wholeNumber(text);
    return percent === null || percent < 1 || percent > 100 ? null : percent;
  }
  const amount = parseMoney(text, currency);
  return amount.ok && amount.cents >= 1 ? amount.cents : null;
}

// null for empty, undefined for not an amount above 0.
function optionalAmount(text: string, currency: string): number | null | undefined {
  if (text.trim() === "") return null;
  const amount = parseMoney(text, currency);
  return amount.ok && amount.cents >= 1 ? amount.cents : undefined;
}

// null for empty, undefined for not a whole number above 0.
function optionalLimit(text: string): number | null | undefined {
  if (text.trim() === "") return null;
  const number = wholeNumber(text);
  return number === null || number < 1 ? undefined : number;
}

// null for empty, undefined for not a real moment.
function optionalDate(text: string, timeZone: string): Date | null | undefined {
  if (text.trim() === "") return null;
  return zonedDateTimeToUtc(text.trim(), timeZone) ?? undefined;
}

// The first message per field, in the shape the form maps onto setError. A crafted request with
// a field missing still gets that field's message, never an empty map.
export function discountFieldErrors(error: z.ZodError): DiscountFieldErrors {
  const fields: DiscountFieldErrors = {};
  for (const issue of error.issues) {
    const field = discountFields.find((name) => name === issue.path[0]);
    if (field !== undefined) fields[field] ??= issue.message;
  }
  if (Object.keys(fields).length === 0) fields.code = discountMessages.codeEmpty;
  return fields;
}

const comparedFields = [
  "code",
  "type",
  "value",
  "startsAt",
  "endsAt",
  "maxRedemptions",
  "perCustomerLimit",
  "minSubtotalCents",
  "active",
  "note",
] as const satisfies readonly (keyof DiscountCodeInput)[];

// spec 0014, AC-18: the names of the fields an update changes, compared with the row read under
// the code lock. Dates compare by instant.
export function changedDiscountFields(
  before: Readonly<Record<(typeof comparedFields)[number], unknown>>,
  after: DiscountCodeInput,
): readonly string[] {
  const same = (a: unknown, b: unknown) =>
    a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;
  return comparedFields.filter((field) => !same(before[field], after[field]));
}

// AC-12: once a code has a redemption, these never change.
export function changesLockedFields(
  before: Pick<DiscountCodeInput, "code" | "type" | "value">,
  after: DiscountCodeInput,
): boolean {
  return before.code !== after.code || before.type !== after.type || before.value !== after.value;
}
