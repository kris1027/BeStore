import { MinusIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import type { Change } from "../change";

type StatCardProps = {
  readonly title: string;
  readonly value: string;
  // Lines under the figure, such as "Gross €1,200.00".
  readonly details?: readonly string[];
  readonly change: Change;
  readonly footer?: React.ReactNode;
};

// The arrow only repeats what the words say (spec 0015, AC-4: never colour or shape alone).
function ChangeIcon({ text }: { readonly text: string }) {
  if (text.startsWith("Up ")) return <TrendingUpIcon aria-hidden="true" className="size-4" />;
  if (text.startsWith("Down ")) return <TrendingDownIcon aria-hidden="true" className="size-4" />;
  return <MinusIcon aria-hidden="true" className="size-4" />;
}

export function StatCard({ title, value, details = [], change, footer }: StatCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
        </CardTitle>
      </CardHeader>
      <CardContent className="gap-2">
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {details.length > 0 ? (
          <ul className="flex flex-col text-sm text-muted-foreground tabular-nums">
            {details.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        <p className="flex items-center gap-1.5 text-sm">
          <ChangeIcon text={change.text} />
          <span>
            {change.text}
            {change.suffix ? <span className="text-muted-foreground"> {change.suffix}</span> : null}
          </span>
        </p>
      </CardContent>
      {footer ? <CardFooter className="mt-auto">{footer}</CardFooter> : null}
    </Card>
  );
}

export function StatCardSkeleton() {
  return (
    <Card aria-hidden="true">
      <CardHeader>
        <Skeleton className="h-4 w-28" />
      </CardHeader>
      <CardContent className="gap-3">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-4 w-44" />
      </CardContent>
    </Card>
  );
}
