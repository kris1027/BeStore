import { orderSignUpEmail } from "../order-sign-up";
import { OrderSignUpButton } from "./order-sign-up-button";

// spec 0012, AC-17: under the order confirmation, for a guest whose paid order no account holds.
export async function OrderSignUpOffer({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sessionId = (await searchParams).session_id;
  if (typeof sessionId !== "string" || (await orderSignUpEmail(sessionId)) === null) return null;
  return (
    <section
      aria-labelledby="track-order-heading"
      className="flex max-w-2xl flex-col items-start gap-3 rounded-md border p-6"
    >
      <h2 id="track-order-heading" className="font-heading text-2xl">
        Track this order in an account
      </h2>
      <p className="text-muted-foreground">
        We send a link to the email on this order. Confirm it, choose a password, and this order and
        your next ones show up in your account.
      </p>
      <OrderSignUpButton sessionId={sessionId} />
    </section>
  );
}
