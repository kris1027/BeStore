"use client";

import { SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

const refundItems = [
  { value: "", label: "Any" },
  { value: "none", label: "Not refunded" },
  { value: "partial", label: "Partly refunded" },
  { value: "full", label: "Fully refunded" },
];

function FilterSelect({
  id,
  name,
  label,
  items,
  value,
}: {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly items: readonly { readonly value: string; readonly label: string }[];
  readonly value: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select items={items} name={name} defaultValue={value}>
        <SelectTrigger id={id} className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

// spec 0010, AC-1 and AC-2: a plain GET form, so every filter lives in the URL and a filtered
// view can be shared or reloaded. Submitting starts again at the newest page.
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
      <FilterSelect
        id="orders-status"
        name="status"
        label="Status"
        items={statusItems}
        value={params.status === "settled" ? "" : params.status}
      />
      <FilterSelect
        id="orders-refund"
        name="refund"
        label="Refunds"
        items={refundItems}
        value={params.refund ?? ""}
      />
      <div className="flex flex-col gap-2">
        <Label htmlFor="orders-from">Placed from</Label>
        <Input
          id="orders-from"
          type="date"
          name="from"
          defaultValue={params.from ?? ""}
          className="w-40"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="orders-to">Placed to</Label>
        <Input
          id="orders-to"
          type="date"
          name="to"
          defaultValue={params.to ?? ""}
          className="w-40"
        />
      </div>
      <div className="flex h-9 items-center gap-2">
        <Checkbox
          id="orders-attention"
          name="attention"
          value="1"
          defaultChecked={params.attention}
          aria-labelledby="orders-attention-label"
        />
        <Label id="orders-attention-label" htmlFor="orders-attention">
          Needs attention only
        </Label>
      </div>
      <Button type="submit" variant="outline">
        <SearchIcon data-icon="inline-start" aria-hidden="true" />
        Find orders
      </Button>
    </form>
  );
}
