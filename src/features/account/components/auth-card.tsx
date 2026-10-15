import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type AccountAuthCardProps = {
  readonly title: string;
  readonly description?: React.ReactNode;
  readonly children: React.ReactNode;
  readonly footer?: React.ReactNode;
};

// One card per account auth page (sign in, sign up, links, passwords): the page's only h1, a line
// of help, the form, and a way out.
export function AccountAuthCard({ title, description, children, footer }: AccountAuthCardProps) {
  return (
    <Card>
      <CardHeader>
        <h1 className="font-heading text-3xl">{title}</h1>
        {description ? (
          <CardDescription className="text-base">{description}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-6">{children}</CardContent>
      {footer ? (
        <CardFooter className="flex-wrap justify-between gap-x-4 gap-y-2 border-t text-sm">
          {footer}
        </CardFooter>
      ) : null}
    </Card>
  );
}

// What an auth form shows while the session check behind it streams in.
export function AuthFormSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
}

export const footerLinkClass =
  "text-muted-foreground underline underline-offset-4 hover:text-foreground";
