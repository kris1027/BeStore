import { LayoutDashboardIcon } from "lucide-react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

import type { Admin } from "../access";

// The panel's landing page until the dashboard (feature 15) takes its place.
export function Welcome({ admin }: { readonly admin: Admin }) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Welcome</h1>
        <p className="text-sm text-muted-foreground">Signed in as {admin.name}</p>
      </div>
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LayoutDashboardIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>
            <h2>Nothing to manage yet</h2>
          </EmptyTitle>
          <EmptyDescription>
            Products, orders and the sales dashboard appear in the sidebar as each part of the store
            is built.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </>
  );
}
