"use client";

import {
  ArrowRightIcon,
  CircleAlertIcon,
  InfoIcon,
  LogOutIcon,
  PackageOpenIcon,
  SettingsIcon,
  UserIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";

import { ShowcaseSection } from "./showcase-section";

const sizes = [
  { value: "s", label: "Small" },
  { value: "m", label: "Medium" },
  { value: "l", label: "Large" },
];

const sampleRows = [
  { id: "1001", product: "Linen shirt", quantity: 1 },
  { id: "1002", product: "Wool scarf", quantity: 2 },
  { id: "1003", product: "Canvas tote", quantity: 1 },
];

export function ComponentShowcase() {
  return (
    <div className="flex flex-col gap-12">
      <ShowcaseSection
        id="button"
        title="Button"
        description="One primary action per view. Loading is a Spinner plus disabled, never a custom prop. Tab to a button to see the focus ring."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button>Default</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="xs">Extra small</Button>
          <Button size="sm">Small</Button>
          <Button>Default</Button>
          <Button size="lg">Large</Button>
          <Button size="icon" aria-label="Settings">
            <SettingsIcon aria-hidden="true" />
          </Button>
          <Button>
            Continue
            <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled>Disabled</Button>
          <Button disabled>
            <Spinner data-icon="inline-start" />
            Saving
          </Button>
        </div>
      </ShowcaseSection>

      <ShowcaseSection
        id="form"
        title="Input, Textarea, Select and Field"
        description="Forms use FieldGroup and Field. An invalid field sets data-invalid on Field and aria-invalid on the control, with the error text below it."
      >
        <form className="max-w-md" noValidate onSubmit={(event) => event.preventDefault()}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="sg-name">Full name</FieldLabel>
              <Input id="sg-name" autoComplete="name" placeholder="Ada Lovelace" />
            </Field>
            <Field>
              <FieldLabel htmlFor="sg-email">Email</FieldLabel>
              <Input id="sg-email" type="email" autoComplete="email" />
              <FieldDescription>We send the order confirmation here.</FieldDescription>
            </Field>
            <Field data-invalid>
              <FieldLabel htmlFor="sg-postcode">Postcode</FieldLabel>
              <Input
                id="sg-postcode"
                defaultValue="12"
                aria-invalid
                aria-describedby="sg-postcode-error"
              />
              <FieldError id="sg-postcode-error">Enter a postcode like 00-950.</FieldError>
            </Field>
            <Field data-disabled>
              <FieldLabel htmlFor="sg-country">Country</FieldLabel>
              <Input id="sg-country" defaultValue="Poland" disabled />
              <FieldDescription>We ship to one country.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="sg-size">Size</FieldLabel>
              <Select items={sizes}>
                <SelectTrigger id="sg-size" className="w-48">
                  <SelectValue placeholder="Choose a size" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {sizes.map((size) => (
                      <SelectItem key={size.value} value={size.value}>
                        {size.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field data-invalid>
              <FieldLabel htmlFor="sg-size-invalid">Size (invalid)</FieldLabel>
              <Select items={sizes}>
                <SelectTrigger
                  id="sg-size-invalid"
                  className="w-48"
                  aria-invalid
                  aria-describedby="sg-size-error"
                >
                  <SelectValue placeholder="Choose a size" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {sizes.map((size) => (
                      <SelectItem key={size.value} value={size.value}>
                        {size.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldError id="sg-size-error">Choose a size.</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="sg-notes">Delivery notes</FieldLabel>
              <Textarea id="sg-notes" placeholder="Leave it with the neighbour" />
            </Field>
            <Field data-invalid>
              <FieldLabel htmlFor="sg-notes-invalid">Gift message (invalid)</FieldLabel>
              <Textarea
                id="sg-notes-invalid"
                aria-invalid
                aria-describedby="sg-notes-error"
                defaultValue="…"
              />
              <FieldError id="sg-notes-error">Write at least 10 characters.</FieldError>
            </Field>
            <Field data-disabled>
              <FieldLabel htmlFor="sg-notes-disabled">Internal note</FieldLabel>
              <Textarea id="sg-notes-disabled" disabled defaultValue="Only admins can edit this." />
            </Field>
            <Field orientation="horizontal">
              <Button type="submit">Save address</Button>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </ShowcaseSection>

      <ShowcaseSection
        id="choice"
        title="Checkbox and Radio group"
        description="Group related choices in a FieldSet with a FieldLegend."
      >
        <div className="grid gap-8 md:grid-cols-2">
          <FieldSet>
            <FieldLegend variant="label">Emails</FieldLegend>
            <FieldGroup className="gap-3">
              <Field orientation="horizontal">
                <Checkbox id="sg-news" />
                <FieldLabel htmlFor="sg-news">Unchecked</FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <Checkbox id="sg-orders" defaultChecked />
                <FieldLabel htmlFor="sg-orders">Checked</FieldLabel>
              </Field>
              <Field orientation="horizontal" data-disabled>
                <Checkbox id="sg-disabled" disabled />
                <FieldLabel htmlFor="sg-disabled">Disabled</FieldLabel>
              </Field>
              <Field orientation="horizontal" data-invalid>
                <Checkbox id="sg-terms" aria-invalid aria-describedby="sg-terms-error" />
                <FieldContent>
                  <FieldLabel htmlFor="sg-terms">I accept the terms (invalid)</FieldLabel>
                  <FieldError id="sg-terms-error">Accept the terms to continue.</FieldError>
                </FieldContent>
              </Field>
            </FieldGroup>
          </FieldSet>
          <FieldSet>
            <FieldLegend variant="label">Delivery</FieldLegend>
            <RadioGroup defaultValue="standard">
              <Field orientation="horizontal">
                <RadioGroupItem value="standard" id="sg-standard" />
                <FieldLabel htmlFor="sg-standard">Standard (checked)</FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <RadioGroupItem value="express" id="sg-express" />
                <FieldLabel htmlFor="sg-express">Express (unchecked)</FieldLabel>
              </Field>
              <Field orientation="horizontal" data-disabled>
                <RadioGroupItem value="pickup" id="sg-pickup" disabled />
                <FieldLabel htmlFor="sg-pickup">Pickup (disabled)</FieldLabel>
              </Field>
            </RadioGroup>
            <RadioGroup aria-describedby="sg-wrap-error">
              <Field orientation="horizontal" data-invalid>
                <RadioGroupItem value="wrap" id="sg-wrap" aria-invalid />
                <FieldContent>
                  <FieldLabel htmlFor="sg-wrap">Gift wrap (invalid)</FieldLabel>
                  <FieldError id="sg-wrap-error">Choose a wrapping option.</FieldError>
                </FieldContent>
              </Field>
            </RadioGroup>
          </FieldSet>
        </div>
      </ShowcaseSection>

      <ShowcaseSection
        id="card"
        title="Card"
        description="Always the full composition: header, title, description, content and footer."
      >
        <Card className="max-w-sm">
          <CardHeader>
            <CardTitle>Order summary</CardTitle>
            <CardDescription>Three items, shipped together.</CardDescription>
            <CardAction>
              <Badge variant="secondary">Paid</Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Cards group one object. Keep one primary action in the footer.
            </p>
          </CardContent>
          <CardFooter>
            <Button className="w-full">View order</Button>
          </CardFooter>
        </Card>
      </ShowcaseSection>

      <ShowcaseSection
        id="badge"
        title="Badge"
        description="Short status labels. Never color alone: the word carries the meaning."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="destructive">Destructive</Badge>
          <Badge variant="ghost">Ghost</Badge>
          <Badge variant="link">Link</Badge>
        </div>
      </ShowcaseSection>

      <ShowcaseSection
        id="alert"
        title="Alert"
        description="Callouts that stay on the page. For a passing confirmation use a toast."
      >
        <div className="flex max-w-xl flex-col gap-4">
          <Alert>
            <InfoIcon aria-hidden="true" />
            <AlertTitle>Shipping is a flat rate</AlertTitle>
            <AlertDescription>One price for every order, shown before you pay.</AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <CircleAlertIcon aria-hidden="true" />
            <AlertTitle>Payment failed</AlertTitle>
            <AlertDescription>Your card was declined. Try another card.</AlertDescription>
          </Alert>
        </div>
      </ShowcaseSection>

      <ShowcaseSection
        id="overlays"
        title="Dialog and Sheet"
        description="Both trap focus, close on Escape and return focus to the trigger. Every one has a title."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Dialog>
            <DialogTrigger render={<Button variant="outline" />}>Open dialog</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Remove this item?</DialogTitle>
                <DialogDescription>
                  It leaves your cart. You can add it again later.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>Keep it</DialogClose>
                <DialogClose render={<Button />}>Remove</DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Sheet>
            <SheetTrigger render={<Button variant="outline" />}>Open sheet</SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Your cart</SheetTitle>
                <SheetDescription>
                  A side panel for a task that keeps the page in view.
                </SheetDescription>
              </SheetHeader>
              <SheetFooter>
                <Button>Go to checkout</Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </div>
      </ShowcaseSection>

      <ShowcaseSection
        id="dropdown-menu"
        title="Dropdown menu"
        description="Items always sit inside a group. Arrow keys move between items."
      >
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" />}>
            <UserIcon data-icon="inline-start" aria-hidden="true" />
            Account
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Signed in as ada@example.com</DropdownMenuLabel>
              <DropdownMenuItem>Orders</DropdownMenuItem>
              <DropdownMenuItem>Addresses</DropdownMenuItem>
              <DropdownMenuItem disabled>Wishlist (soon)</DropdownMenuItem>
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
      </ShowcaseSection>

      <ShowcaseSection
        id="toast"
        title="Toast"
        description="A short confirmation that disappears on its own. Screen readers announce it."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            onClick={() =>
              toast.add({
                title: "Added to cart",
                description: "Linen shirt, size M.",
                type: "success",
              })
            }
          >
            Show success toast
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              toast.add({
                title: "Couldn't save",
                description: "Check your connection and try again.",
                type: "error",
              })
            }
          >
            Show error toast
          </Button>
        </div>
      </ShowcaseSection>

      <ShowcaseSection
        id="table"
        title="Table"
        description="Tabular data only. On phones the table scrolls sideways inside its own box."
      >
        <Table>
          <TableCaption>Recent orders</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sampleRows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">#{row.id}</TableCell>
                <TableCell>{row.product}</TableCell>
                <TableCell className="text-right tabular-nums">{row.quantity}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Table>
          <TableCaption>Refunds</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={2}>
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <PackageOpenIcon aria-hidden="true" />
                    </EmptyMedia>
                    <EmptyTitle>No refunds yet</EmptyTitle>
                    <EmptyDescription>Refunds you issue show up here.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </ShowcaseSection>

      <ShowcaseSection
        id="feedback"
        title="Skeleton, Spinner, Empty and Separator"
        description="Skeleton while content loads, Spinner for a running action, Empty when there is nothing yet."
      >
        <div className="flex flex-col gap-3" aria-hidden="true">
          <Skeleton className="h-4 w-64 max-w-full" />
          <Skeleton className="h-4 w-48 max-w-full" />
        </div>
        <Spinner />
        <Separator />
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PackageOpenIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>Your cart is empty</EmptyTitle>
            <EmptyDescription>Browse the shop and add something you like.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button>Start shopping</Button>
          </EmptyContent>
        </Empty>
      </ShowcaseSection>
    </div>
  );
}
