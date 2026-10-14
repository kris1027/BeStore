import { PlusIcon, TriangleAlertIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { addressNeedsCheck, MAX_SAVED_ADDRESSES } from "@/lib/customer/address-rules";
import { listSavedAddresses, type SavedAddress } from "@/lib/customer/addresses";
import { requireCustomer } from "@/lib/customer/session";
import { env } from "@/lib/env";
import { countryDisplayName } from "@/lib/shipping/address";

import { DeleteAddressButton, MakeDefaultButton } from "./address-actions";
import { AddressDialog } from "./address-dialog";

function formValues(address: SavedAddress) {
  return {
    fullName: address.fullName,
    line1: address.line1,
    line2: address.line2 ?? "",
    postalCode: address.postalCode,
    city: address.city,
    phone: address.phone ?? "",
  };
}

function shortLabel(address: SavedAddress): string {
  return `${address.fullName}, ${address.line1}, ${address.city}`;
}

// spec 0012, AC-14: the saved addresses, default first, then the newest.
export async function AddressBook() {
  const customer = await requireCustomer();
  const addresses = await listSavedAddresses(customer.id);
  const country = env.STORE_COUNTRY;
  const countryName = countryDisplayName(country, env.STORE_LOCALE);
  const full = addresses.length >= MAX_SAVED_ADDRESSES;

  return (
    <div className="flex flex-col gap-6">
      {full ? (
        <p className="text-muted-foreground">You can save up to {MAX_SAVED_ADDRESSES} addresses.</p>
      ) : (
        <div>
          <AddressDialog
            mode="add"
            country={country}
            countryName={countryName}
            trigger={
              <>
                <PlusIcon data-icon="inline-start" aria-hidden="true" />
                Add an address
              </>
            }
          />
        </div>
      )}
      {addresses.length === 0 ? (
        <p className="text-muted-foreground">
          No saved addresses yet. Add one here, or tick &quot;Save this address&quot; at checkout.
        </p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2" aria-label="Saved addresses">
          {addresses.map((address) => {
            const label = shortLabel(address);
            const needsCheck = addressNeedsCheck(address, country);
            return (
              <li key={address.id} className="flex flex-col gap-4 rounded-md border p-5">
                <div className="flex flex-wrap items-center gap-2">
                  {address.isDefault ? <Badge variant="secondary">Default</Badge> : null}
                  {needsCheck ? (
                    <Badge variant="destructive">
                      <TriangleAlertIcon data-icon="inline-start" aria-hidden="true" />
                      Check this address
                    </Badge>
                  ) : null}
                </div>
                <address className="flex flex-col not-italic">
                  <span className="font-medium">{address.fullName}</span>
                  <span>{address.line1}</span>
                  {address.line2 ? <span>{address.line2}</span> : null}
                  <span>
                    {address.postalCode} {address.city}
                  </span>
                  <span>{countryDisplayName(address.countryCode, env.STORE_LOCALE)}</span>
                  {address.phone ? (
                    <span className="text-muted-foreground">{address.phone}</span>
                  ) : null}
                </address>
                <div className="mt-auto flex flex-wrap gap-2">
                  <AddressDialog
                    mode="edit"
                    country={country}
                    countryName={countryName}
                    address={{ id: address.id, values: formValues(address), label }}
                    trigger="Edit"
                    triggerLabel={`Edit: ${label}`}
                  />
                  {address.isDefault ? null : <MakeDefaultButton id={address.id} label={label} />}
                  <DeleteAddressButton id={address.id} label={label} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function AddressBookSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2" aria-hidden="true">
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
