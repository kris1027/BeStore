// Pure: the line under each figure that compares it with the previous window (spec 0015, AC-4
// and AC-7). The words carry the meaning, never the colour.

export type Change = {
  readonly text: string;
  // "vs previous 30 days", only after a percent.
  readonly suffix: string | null;
};

const noEarlierFigure: Change = { text: "No earlier figure to compare", suffix: null };

function previousDays(dayCount: number): string {
  return `vs previous ${dayCount} ${dayCount === 1 ? "day" : "days"}`;
}

// A figure against its previous window's value: a percent only when the previous value is
// above 0. N is rounded half away from zero, so 0.5% reads "Up 1%" and -0.5% "Down 1%".
export function figureChange(current: number, previous: number, dayCount: number): Change {
  if (previous <= 0) return noEarlierFigure;
  const percent = ((current - previous) * 100) / previous;
  const rounded = Math.sign(percent) * Math.round(Math.abs(percent));
  const text = rounded > 0 ? `Up ${rounded}%` : rounded < 0 ? `Down ${-rounded}%` : "No change";
  return { text, suffix: previousDays(dayCount) };
}

// Gross over orders, to a whole cent, half up (AC-7); null with no orders.
export function averageOrderValue(grossCents: number, orders: number): number | null {
  return orders === 0 ? null : Math.round(grossCents / orders);
}

type OrderFigures = { readonly orders: number; readonly grossCents: number };

// AC-7: with no orders this window there is no average, so the line says why instead.
export function averageChange(
  current: OrderFigures,
  previous: OrderFigures,
  dayCount: number,
): Change {
  const now = averageOrderValue(current.grossCents, current.orders);
  const before = averageOrderValue(previous.grossCents, previous.orders);
  if (now === null) {
    return previous.orders > 0
      ? { text: "No orders in this period", suffix: null }
      : noEarlierFigure;
  }
  return before === null ? noEarlierFigure : figureChange(now, before, dayCount);
}
