import type { DeliveryAddress } from "@/lib/shipping/address";

// An order's delivery address as a postal block, shared by the order complete page (spec 0007,
// AC-13) and the admin order detail (AC-11).
export function DeliveryAddressBlock({ address }: { readonly address: DeliveryAddress }) {
  return (
    <address className="flex flex-col not-italic">
      <span className="font-medium">{address.fullName}</span>
      <span>{address.line1}</span>
      {address.line2 ? <span>{address.line2}</span> : null}
      <span>
        {address.postalCode} {address.city}
      </span>
      <span>{address.countryName}</span>
    </address>
  );
}
