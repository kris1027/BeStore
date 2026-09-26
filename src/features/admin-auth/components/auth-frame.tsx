import Link from "next/link";

import { Wordmark } from "@/components/wordmark";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// The plain frame for the sign in, MFA, password and reset link pages: no admin shell, since
// nothing inside it is granted yet. All admin text is Inter, like AdminShell.
export function AuthFrame({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col bg-muted [--font-heading:var(--font-sans)]">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4 md:px-6">
        <Wordmark className="text-lg md:text-xl" />
        <Badge variant="secondary">Admin</Badge>
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center">
        <div className="w-full max-w-md">{children}</div>
      </main>
      <footer className="flex flex-col gap-2 border-t bg-background px-4 py-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between md:px-6">
        <p>For the store team. Every sign in is recorded.</p>
        <Link href="/" className="underline underline-offset-4 hover:text-foreground">
          Back to the store
        </Link>
      </footer>
    </div>
  );
}

type AuthCardProps = {
  readonly title: string;
  readonly description: React.ReactNode;
  readonly children: React.ReactNode;
  readonly footer?: React.ReactNode;
};

// One card per auth page: the page's only h1, a line of help, the form, and a way out.
export function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="text-2xl font-semibold">{title}</h1>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">{children}</CardContent>
      {footer ? (
        <CardFooter className="flex-wrap justify-between gap-2 border-t">{footer}</CardFooter>
      ) : null}
    </Card>
  );
}
