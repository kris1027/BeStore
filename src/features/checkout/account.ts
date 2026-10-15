import "server-only";

import { addressFields } from "@/lib/customer/address-rules";
import { saveAddress } from "@/lib/customer/addresses";
import { lockCustomer } from "@/lib/customer/lock";
import type { CustomerIdentity } from "@/lib/customer/setup";
import type { Tx } from "@/lib/db";
import type { ShipTo } from "@/lib/shipping/address";

// What a signed in checkout adds to the order's transaction (spec 0012, AC-15), kept apart from
// freezing the cart so startCheckout changes for one reason at a time.

export type CheckoutAccount = {
  readonly customer: CustomerIdentity;
  readonly saveAddress: boolean;
};

// Takes the customer lock (before any cart lock) and returns the profile name, read under it.
export async function lockAccount(tx: Tx, account: CheckoutAccount): Promise<string | null> {
  await lockCustomer(tx, account.customer.id);
  const profile = await tx.customer.findUnique({
    where: { id: account.customer.id },
    select: { name: true },
  });
  return profile?.name ?? null;
}

// spec 0012, AC-15: the buyer's name as best we know it before payment. A profile name the
// customer chose wins; otherwise (blank profile, or a guest) the delivery full name. Blank is null
// or "", the same test the profile fills use. Written only here, when the order is created.
export function orderCustomerName(profileName: string | null, fullName: string): string {
  return profileName === null || profileName === "" ? fullName : profileName;
}

// spec 0012, AC-15, inside the order's transaction and under the customer lock: a blank name and
// phone on the profile are filled from this order whether or not the box is ticked, and the
// ticked address joins the address book (an equal one adds nothing, and at 10 nothing is added,
// silently). Values already set are never overwritten, and the fills log nothing (AC-24).
// Returns whether a new address was saved.
export async function saveToAccount(
  tx: Tx,
  account: CheckoutAccount,
  shipTo: ShipTo,
  customerName: string,
): Promise<boolean> {
  const customerId = account.customer.id;
  await tx.customer.updateMany({
    where: { id: customerId, OR: [{ name: null }, { name: "" }] },
    data: { name: customerName },
  });
  if (shipTo.phone !== null) {
    await tx.customer.updateMany({
      where: { id: customerId, OR: [{ phone: null }, { phone: "" }] },
      data: { phone: shipTo.phone },
    });
  }
  if (!account.saveAddress) return false;
  const outcome = await saveAddress(tx, customerId, addressFields(shipTo, shipTo.countryCode));
  return outcome.kind === "saved";
}
