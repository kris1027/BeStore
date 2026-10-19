"use client";

import { CalendarRangeIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
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

import { dashboardPath } from "../paths";
import { presetLabels, salesPresets, type SalesPreset } from "../period";

// An empty select sends period="", which the parser reads as the default; the dates win
// whenever both are filled (spec 0015, AC-3).
const customValue = "";

const periodItems = [
  ...salesPresets.map((preset) => ({ value: preset, label: presetLabels[preset] })),
  { value: customValue, label: "Custom range" },
];

type PeriodPickerProps = {
  // null for a custom range.
  readonly preset: SalesPreset | null;
  // The custom range's days (YYYY-MM-DD), empty for a preset.
  readonly from: string;
  readonly to: string;
  // Today in the store's time zone, the latest day the inputs offer.
  readonly today: string;
};

// spec 0015, AC-3: a plain GET form, so it works without JavaScript and every period is a link.
// With JavaScript, picking a preset clears the dates (which would otherwise win) and typing a
// date switches the select to "Custom range".
export function PeriodPicker({ preset, from, to, today }: PeriodPickerProps) {
  const [period, setPeriod] = useState<string>(preset ?? customValue);
  const [dates, setDates] = useState({ from, to });

  function pickPeriod(value: string | null) {
    const next = value ?? customValue;
    setPeriod(next);
    if (next !== customValue) setDates({ from: "", to: "" });
  }

  function pickDate(side: "from" | "to", value: string) {
    setDates((current) => ({ ...current, [side]: value }));
    setPeriod(customValue);
  }

  return (
    <form
      aria-label="Choose a period"
      action={dashboardPath}
      className="flex flex-wrap items-end gap-3"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="dashboard-period">Period</Label>
        <Select items={periodItems} name="period" value={period} onValueChange={pickPeriod}>
          <SelectTrigger id="dashboard-period" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {periodItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="dashboard-from">From</Label>
        <Input
          id="dashboard-from"
          type="date"
          name="from"
          value={dates.from}
          max={today}
          onChange={(event) => pickDate("from", event.target.value)}
          className="w-40"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="dashboard-to">To</Label>
        <Input
          id="dashboard-to"
          type="date"
          name="to"
          value={dates.to}
          max={today}
          onChange={(event) => pickDate("to", event.target.value)}
          className="w-40"
        />
      </div>
      <Button type="submit" variant="outline">
        <CalendarRangeIcon data-icon="inline-start" aria-hidden="true" />
        Apply
      </Button>
    </form>
  );
}
