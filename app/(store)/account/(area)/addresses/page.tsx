import type { Metadata } from "next";
import { Suspense } from "react";

import { AddressBook, AddressBookSkeleton } from "@/features/account/components/address-book";

export const metadata: Metadata = {
  title: "Your addresses",
  robots: { index: false, follow: false },
};

export default function AccountAddressesPage() {
  return (
    <section aria-labelledby="addresses-heading" className="flex flex-col gap-4">
      <h2 id="addresses-heading" className="font-heading text-2xl">
        Addresses
      </h2>
      <Suspense fallback={<AddressBookSkeleton />}>
        <AddressBook />
      </Suspense>
    </section>
  );
}
