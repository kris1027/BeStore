import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { formatDate } from "@/lib/dates";

import { OrderEmail, PersonalDataField, type PersonalDataPlacement } from "./personal-data";

const purgedAt = new Date("2026-09-01T04:00:00Z");
const dateFormat = { locale: "en-GB", timeZone: "Europe/Warsaw" };
const removedOn = `Personal data removed on ${formatDate(purgedAt, dateFormat)}`;

type Order = { readonly email: string | null; readonly piiPurgedAt: Date | null };

const listEmail = (order: Order) =>
  renderToStaticMarkup(createElement(OrderEmail, { order, placement: "list" }));

const detailEmail = (order: Order) =>
  renderToStaticMarkup(createElement(OrderEmail, { order, placement: "detail", dateFormat }));

describe("OrderEmail", () => {
  it("shows the email as plain text in a list cell", () => {
    expect(listEmail({ email: "ada@example.com", piiPurgedAt: null })).toBe("ada@example.com");
  });

  it("lets a long email wrap on the detail page", () => {
    expect(detailEmail({ email: "ada@example.com", piiPurgedAt: null })).toBe(
      '<span class="break-all">ada@example.com</span>',
    );
  });

  // covers: AC-8
  it("says the data was removed, without a date, in a list cell", () => {
    expect(listEmail({ email: null, piiPurgedAt: purgedAt })).toBe(
      '<span class="text-muted-foreground">Personal data removed</span>',
    );
  });

  // covers: AC-8
  it("says when the data was removed on the detail page", () => {
    expect(detailEmail({ email: null, piiPurgedAt: purgedAt })).toBe(
      `<span class="text-muted-foreground">${removedOn}</span>`,
    );
  });

  // covers: AC-9 (the CHECK on orders makes this unreachable through the database)
  it("flags a missing email on a list row instead of rendering an empty cell", () => {
    expect(listEmail({ email: null, piiPurgedAt: null })).toBe(
      '<span class="text-destructive">Email missing</span>',
    );
  });
});

type FieldProps = Parameters<typeof PersonalDataField>[0];

// createElement's types want children in props, the lint wants them as an argument.
const field = (props: PersonalDataPlacement & { readonly purgedAt: Date | null }) =>
  renderToStaticMarkup(createElement(PersonalDataField, props as FieldProps, "Warsaw, PL"));

describe("PersonalDataField", () => {
  it("renders the field itself when the order was not purged", () => {
    expect(field({ purgedAt: null, placement: "detail", dateFormat })).toBe("Warsaw, PL");
  });

  // covers: AC-8
  it("replaces the field once the purge ran", () => {
    expect(field({ purgedAt, placement: "detail", dateFormat })).toBe(
      `<span class="text-muted-foreground">${removedOn}</span>`,
    );
  });

  it("drops the date in a list cell", () => {
    expect(field({ purgedAt, placement: "list" })).toBe(
      '<span class="text-muted-foreground">Personal data removed</span>',
    );
  });
});
