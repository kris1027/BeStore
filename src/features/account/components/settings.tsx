import { Skeleton } from "@/components/ui/skeleton";
import { requireCustomer } from "@/lib/customer/session";
import { db } from "@/lib/db";

import { accountMessages } from "../messages";
import { ChangePasswordForm } from "./change-password-form";
import { DeleteAccountDialog } from "./delete-account-dialog";
import { ProfileForm } from "./profile-form";

const sectionClass = "flex flex-col gap-4 rounded-md border p-6";

// spec 0012, AC-18 to AC-20.
export async function Settings() {
  const customer = await requireCustomer();
  const [profile, openOrders] = await Promise.all([
    db.customer.findUniqueOrThrow({
      where: { id: customer.id },
      select: { name: true, phone: true },
    }),
    db.order.count({ where: { customerId: customer.id, status: "paid" } }),
  ]);

  return (
    <div className="grid max-w-3xl gap-6">
      <section aria-labelledby="details-heading" className={sectionClass}>
        <h3 id="details-heading" className="font-heading text-xl">
          Your details
        </h3>
        <dl className="flex flex-col gap-1">
          <dt className="text-sm font-medium">Email</dt>
          <dd>{customer.email}</dd>
          <dd className="text-sm text-muted-foreground">{accountMessages.emailChange}</dd>
        </dl>
        <ProfileForm name={profile.name} phone={profile.phone} />
      </section>
      <section aria-labelledby="password-heading" className={sectionClass}>
        <h3 id="password-heading" className="font-heading text-xl">
          Password
        </h3>
        <ChangePasswordForm />
      </section>
      <section aria-labelledby="delete-heading" className={sectionClass}>
        <h3 id="delete-heading" className="font-heading text-xl">
          Delete account
        </h3>
        <p className="text-muted-foreground">
          This deletes your profile, saved addresses and cart, and you can no longer sign in.
        </p>
        <div>
          <DeleteAccountDialog openOrders={openOrders} email={customer.email} />
        </div>
      </section>
    </div>
  );
}

export function SettingsSkeleton() {
  return (
    <div className="grid max-w-3xl gap-6" aria-hidden="true">
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
