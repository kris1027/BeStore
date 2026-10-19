"use client";

import { SearchIcon } from "lucide-react";

import { NativeSelectField } from "@/components/native-select-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SEARCH_MAX_LENGTH } from "@/lib/admin-search";

import type { AdminOrdersParams } from "../list-params";
import { adminOrdersPath } from "../paths";

// An empty select sends "", which the parser ignores, so "Paid orders" and "Any" need no
// special case.
const statusItems = [
  { value: "", label: "Paid orders" },
  { value: "all", label: "All orders" },
  { value: "paid", label: "Paid" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
  { value: "pending_payment", label: "Awaiting payment" },
  { value: "expired", label: "Expired" },
];

// spec 0015, AC-13: which date From and To filter. "" is the default, when the order was placed.
const dateItems = [
  { value: "", label: "Order placed" },
  { value: "paid", label: "Paid" },
];

const refundItems = [
  { value: "", label: "Any" },
  { value: "none", label: "Not refunded" },
  { value: "partial", label: "Partly refunded" },
  { value: "full", label: "Fully refunded" },
];

// spec 0010, AC-1 and AC-2: a plain GET form, so every filter lives in the URL and a filtered
// view can be shared or reloaded. Submitting starts again at the newest page.
// spec 0016: a GET form works before the app's JavaScript loads, so its controls are native.
export function OrdersFilters({ params }: { readonly params: AdminOrdersParams }) {
  return (
    <form
      aria-label="Find orders"
      action={adminOrdersPath}
      className="flex flex-wrap items-end gap-3"
    >
      <div className="flex min-w-48 flex-1 flex-col gap-2 sm:max-w-xs">
        <Label htmlFor="orders-q">Order number, email or name</Label>
        <Input
          id="orders-q"
          type="search"
          name="q"
          defaultValue={params.q}
          maxLength={SEARCH_MAX_LENGTH}
          autoComplete="off"
        />
      </div>
      <NativeSelectField
        id="orders-status"
        name="status"
        label="Status"
        items={statusItems}
        defaultValue={params.status === "settled" ? "" : params.status}
        className="w-44"
      />
      <NativeSelectField
        id="orders-refund"
        name="refund"
        label="Refunds"
        items={refundItems}
        defaultValue={params.refund ?? ""}
        className="w-44"
      />
      <NativeSelectField
        id="orders-dates"
        name="dates"
        label="Date"
        items={dateItems}
        defaultValue={params.dates === "created" ? "" : params.dates}
        className="w-44"
      />
      <div className="flex flex-col gap-2">
        <Label htmlFor="orders-from">From</Label>
        <Input
          id="orders-from"
          type="date"
          name="from"
          defaultValue={params.from ?? ""}
          className="w-40"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="orders-to">To</Label>
        <Input
          id="orders-to"
          type="date"
          name="to"
          defaultValue={params.to ?? ""}
          className="w-40"
        />
      </div>
      <div className="flex h-9 items-center gap-2">
        <input
          type="checkbox"
          id="orders-attention"
          name="attention"
          value="1"
          defaultChecked={params.attention}
          className="size-4 shrink-0 accent-primary disabled:cursor-not-allowed"
        />
        <Label htmlFor="orders-attention">Needs attention only</Label>
      </div>
      {/* spec 0014, AC-14: a search keeps the promo code filter; its chip removes it. */}
      {params.discount !== null ? (
        <input type="hidden" name="discount" value={params.discount} />
      ) : null}
      <Button type="submit" variant="outline">
        <SearchIcon data-icon="inline-start" aria-hidden="true" />
        Find orders
      </Button>
    </form>
  );
}
