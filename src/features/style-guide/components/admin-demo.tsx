"use client";

import {
  LayoutDashboardIcon,
  LogOutIcon,
  PackageIcon,
  ShoppingCartIcon,
  TagIcon,
  UserIcon,
} from "lucide-react";

import type { AdminNavItem } from "@/components/layout/admin-nav";
import { AdminShell } from "@/components/layout/admin-shell";
import { Price } from "@/components/price";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Demo only: real admin routes pass adminNavItems from src/components/layout/admin-nav.ts.
const demoNav: readonly AdminNavItem[] = [
  { href: "/style-guide/admin", label: "Dashboard", icon: LayoutDashboardIcon },
  { href: "/style-guide/admin/orders", label: "Orders", icon: ShoppingCartIcon },
  { href: "/style-guide/admin/products", label: "Products", icon: PackageIcon },
  { href: "/style-guide/admin/discounts", label: "Discounts", icon: TagIcon },
];

const orders = [
  { id: "1042", customer: "Ada Lovelace", status: "Paid", total: 12900 },
  { id: "1041", customer: "Grace Hopper", status: "Shipped", total: 4900 },
  { id: "1040", customer: "Alan Turing", status: "Refunded", total: -2500 },
];

const stats = [
  { label: "Sales today", value: 45800 },
  { label: "Sales this week", value: 312500 },
  { label: "Average order", value: 8900 },
];

function UserMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
        <UserIcon data-icon="inline-start" aria-hidden="true" />
        Ada
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>ada@example.com</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <LogOutIcon aria-hidden="true" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AdminDemo() {
  return (
    <AdminShell nav={demoNav} userMenu={<UserMenu />}>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Admin shell demo. The sidebar collapses on desktop and becomes an off canvas sheet on
          phones.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader>
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="text-2xl">
                <Price cents={stat.value} />
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Recent orders</h2>
          </CardTitle>
          <CardDescription>The last three orders across the store.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableCaption className="sr-only">Recent orders</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-medium">#{order.id}</TableCell>
                  <TableCell>{order.customer}</TableCell>
                  <TableCell>
                    <Badge variant={order.status === "Refunded" ? "outline" : "secondary"}>
                      {order.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Price cents={order.total} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AdminShell>
  );
}
