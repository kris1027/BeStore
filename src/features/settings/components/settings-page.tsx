import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import type { ShippingSettingsValues } from "../schemas";
import { ShippingSettingsForm } from "./shipping-settings-form";

// spec 0007, AC-10. Later store wide settings (store name, emails) join this page as sections.
export function SettingsPage({ shipping }: { readonly shipping: ShippingSettingsValues }) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Store wide settings.</p>
      </div>
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>
            <h2>Shipping</h2>
          </CardTitle>
          <CardDescription>
            One flat delivery fee per order. Changes apply to the cart and checkout on their next
            load.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ShippingSettingsForm defaultValues={shipping} />
        </CardContent>
      </Card>
    </>
  );
}
