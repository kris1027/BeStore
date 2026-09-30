import { z } from "zod";

import { fractionDigits, parseMoney } from "@/lib/money";

// Pure: the shipping settings form (zodResolver) and updateShippingSettings parse with the same
// schema (spec 0007, AC-10). Money is typed like the catalog price field: a dot as the decimal
// mark, converted by parseMoney without floating point math.

export type ShippingSettingsField = "deliveryFee" | "freeDeliveryFrom";

export type ShippingSettingsFieldErrors = Partial<Record<ShippingSettingsField, string>>;

// Ranges in major units; checked in cents from the currency's own fraction digits.
const MAX_FEE_MAJOR = 1_000;
const MAX_THRESHOLD_MAJOR = 100_000;

function maxLabel(major: number, currency: string): string {
  const digits = fractionDigits(currency);
  return new Intl.NumberFormat("en", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(major);
}

export function settingsMessages(currency: string) {
  return {
    format: "Enter an amount like 9.99.",
    feeTooHigh: `Delivery fee can be at most ${maxLabel(MAX_FEE_MAJOR, currency)}.`,
    thresholdZero: "Enter an amount above 0.",
    thresholdTooHigh: `Free delivery threshold can be at most ${maxLabel(MAX_THRESHOLD_MAJOR, currency)}.`,
  } as const;
}

export function shippingSettingsSchema(currency: string) {
  const messages = settingsMessages(currency);
  const scale = 10 ** fractionDigits(currency);
  const maxFeeCents = MAX_FEE_MAJOR * scale;
  const maxThresholdCents = MAX_THRESHOLD_MAJOR * scale;

  return z
    .object({
      deliveryFee: z.string(),
      freeDelivery: z.boolean(),
      // Ignored, whatever it holds, while free delivery is off.
      freeDeliveryFrom: z.string().optional(),
    })
    .transform((values, ctx) => {
      const fee = parseMoney(values.deliveryFee, currency);
      let flatShippingCents = 0;
      if (!fee.ok) {
        ctx.addIssue({
          code: "custom",
          path: ["deliveryFee"],
          message: fee.error === "too_large" ? messages.feeTooHigh : messages.format,
        });
      } else if (fee.cents > maxFeeCents) {
        ctx.addIssue({ code: "custom", path: ["deliveryFee"], message: messages.feeTooHigh });
      } else {
        flatShippingCents = fee.cents;
      }

      let freeShippingThresholdCents: number | null = null;
      if (values.freeDelivery) {
        const threshold = parseMoney(values.freeDeliveryFrom ?? "", currency);
        const path = ["freeDeliveryFrom"];
        if (!threshold.ok) {
          ctx.addIssue({
            code: "custom",
            path,
            message: threshold.error === "too_large" ? messages.thresholdTooHigh : messages.format,
          });
        } else if (threshold.cents < 1) {
          ctx.addIssue({ code: "custom", path, message: messages.thresholdZero });
        } else if (threshold.cents > maxThresholdCents) {
          ctx.addIssue({ code: "custom", path, message: messages.thresholdTooHigh });
        } else {
          freeShippingThresholdCents = threshold.cents;
        }
      }

      return { flatShippingCents, freeShippingThresholdCents };
    });
}

export type ShippingSettingsValues = z.input<ReturnType<typeof shippingSettingsSchema>>;

export function shippingSettingsFieldErrors(error: z.ZodError): ShippingSettingsFieldErrors {
  const fields: ShippingSettingsFieldErrors = {};
  for (const issue of error.issues) {
    const [field] = issue.path;
    if (field === "deliveryFee" || field === "freeDeliveryFrom") fields[field] ??= issue.message;
  }
  return fields;
}
