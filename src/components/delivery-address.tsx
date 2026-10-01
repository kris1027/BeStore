import type { DeliveryAddress } from "@/lib/shipping/address";

// An order's delivery address as a postal block, shared by the order complete page (spec 0007,
// AC-13) and the admin order detail (AC-11). Only the admin passes the phone: it is for the
// courier, and the customer typed it moments ago.
export function DeliveryAddressBlock({
  address,
  phone = null,
}: {
  readonly address: DeliveryAddress;
  readonly phone?: string | null;
}) {
  return (
    <address className="flex flex-col not-italic">
      <span className="font-medium">{address.fullName}</span>
      <span>{address.line1}</span>
      {address.line2 ? <span>{address.line2}</span> : null}
      <span>
        {address.postalCode} {address.city}
      </span>
      <span>{address.countryName}</span>
      {phone !== null ? (
        <a href={`tel:${phone}`} className="self-start underline-offset-4 hover:underline">
          {phone}
        </a>
      ) : null}
    </address>
  );
}
