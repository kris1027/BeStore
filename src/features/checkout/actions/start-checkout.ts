"use server";

import type Stripe from "stripe";

import { canCheckout } from "@/lib/cart/cart-lines";
import { readOwnedCartId } from "@/lib/cart/owned";
import { logAccountEvent } from "@/lib/customer/log";
import { getCustomer } from "@/lib/customer/session";
import { type CustomerIdentity, mergeCartForCustomer } from "@/lib/customer/setup";
import { db, type Tx } from "@/lib/db";
import { uniqueViolation } from "@/lib/db-errors";
import { redeem } from "@/lib/discounts/codes";
import type { DiscountRefused } from "@/lib/discounts/rule";
import { calendarDate } from "@/lib/dates";
import { env } from "@/lib/env";
import { currentTermsVersion } from "@/lib/legal/documents";
import { logOrderExpired } from "@/lib/orders/log";
import { minimumChargeCents } from "@/lib/orders/minimum-charge";
import { orderLineImage } from "@/lib/orders/order-image";
import { sessionState } from "@/lib/orders/session-state";
import { type OrderSnapshot, snapshotOrder } from "@/lib/orders/snapshot";
import { markExpired } from "@/lib/orders/transitions";
import { productImageUrl } from "@/lib/product-image";
import type { ActionResult } from "@/lib/result";
import { deliveryColumns, type ShipTo } from "@/lib/shipping/address";
import { readShippingSettings } from "@/lib/shipping/settings";
import { stripe } from "@/lib/stripe";
import { uuidv7 } from "@/lib/uuid";
import { variantLabel } from "@/lib/variant-label";

import { type CheckoutAccount, lockAccount, orderCustomerName, saveToAccount } from "../account";
import { applyLockedCode, createOrderCoupon } from "../discount";
import {
  logCheckoutRefused,
  logCheckoutStarted,
  logDiscountBelowMinimum,
  logStripeFailed,
  stripeErrorCode,
} from "../log";
import {
  type CheckoutFieldErrors,
  checkoutFieldErrors,
  checkoutMessages,
  checkoutSchema,
  startCheckoutInputSchema,
} from "../schemas";
import { checkoutSessionParams } from "../stripe-session";

export type StartCheckoutError =
  | { readonly code: "validation"; readonly fields: CheckoutFieldErrors }
  // `merged`: signing in brought lines from the account cart into this one (spec 0012, AC-15), so
  // the form reloads instead of leaving for the cart page.
  | { readonly code: "cart_changed"; readonly merged?: true }
  | { readonly code: "below_minimum"; readonly minimumCents: number }
  | { readonly code: "payment_processing" }
  | { readonly code: "already_paid"; readonly confirmationUrl: string }
  | { readonly code: "checkout_in_progress" }
  | { readonly code: "payment_unavailable" }
  // spec 0014, AC-4: the code stopped applying since Apply (or never did); no order was made.
  | ({ readonly code: "discount_refused" } & DiscountRefused)
  // spec 0017, AC-9: the terms changed since the page loaded; the form asks again with this one.
  | { readonly code: "terms_changed"; readonly currentVersion: string };

type Result<T> = ActionResult<T, StartCheckoutError>;

const pendingOrderIndex = "orders_one_pending_per_cart_key";

const expiryReasons = {
  replaced: "Replaced by a new checkout",
  sessionNotCreated: "Stripe session could not be created",
  sessionNotSaved: "Session id could not be saved",
  couponNotCreated: "Stripe coupon could not be created",
} as const;

// spec 0006, AC-1, AC-2 and AC-9: freezes the cart into a pending order and sends the browser to
// Stripe's hosted page. Stripe and the database share no rollback, so each step leaves a safe
// state if the next one fails, and an order is only set expired once Stripe can no longer take
// money for it. spec 0007 adds the delivery address and fee, both frozen onto the order here.
export async function startCheckout(input: unknown): Promise<Result<{ readonly url: string }>> {
  const result = await run(input);
  if (!result.ok) logCheckoutRefused(result.error);
  return result;
}

async function run(input: unknown): Promise<Result<{ readonly url: string }>> {
  const parsed = checkoutSchema(env.STORE_COUNTRY).safeParse(input);
  if (!parsed.success) {
    return fail({ code: "validation", fields: checkoutFieldErrors(parsed.error) });
  }
  const {
    email: typedEmail,
    saveAddress: saveRequested,
    discountCode: codeInput,
    acceptTerms,
    ...address
  } = parsed.data;
  // spec 0017, AC-9: the version the page showed must be the current one, checked before any
  // database work, so a refusal creates no order and takes no lock. A missing or malformed one
  // reads as changed: the customer never saw the current text.
  // acceptTerms is `true` by the schema; checked here too, as the server is what enforces it.
  if (acceptTerms !== true) {
    return fail({ code: "validation", fields: { acceptTerms: checkoutMessages.acceptTerms } });
  }
  const terms = startCheckoutInputSchema.safeParse(input);
  if (!terms.success || terms.data.termsVersion !== currentTermsVersion) {
    return fail({ code: "terms_changed", currentVersion: currentTermsVersion });
  }
  // AC-11: the moment of acceptance is the server's time at Pay.
  const acceptance: TermsAcceptance = {
    version: calendarDate(terms.data.termsVersion),
    acceptedAt: new Date(),
  };
  const shipTo: ShipTo = { ...address, countryCode: env.STORE_COUNTRY };

  // spec 0012, AC-15: a signed in checkout uses the account email, whatever was typed, and a
  // guest cookie cart first joins the account cart. A guest pays only for a guest cart (AC-7).
  const customer = await getCustomer();
  const cart = await checkoutCartId(customer);
  if (!cart.ok) return cart;
  const cartId = cart.data;
  const email = customer?.email ?? typedEmail;
  const account = customer === null ? null : { customer, saveAddress: saveRequested };

  const cleared = await clearPendingOrder(cartId);
  if (!cleared.ok) return cleared;

  const created = await createPendingOrder(cartId, email, shipTo, account, codeInput, acceptance);
  if (!created.ok) return created;
  const order = created.data;

  const coupon = await createCoupon(order);
  if (!coupon.ok) return coupon;

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create(
      checkoutSessionParams(
        {
          orderId: order.id,
          number: order.number,
          email,
          currency: env.STORE_CURRENCY,
          lines: order.snapshot.lines.map((line) => ({
            ...line,
            imageUrl: line.imagePath === null ? null : productImageUrl(line.imagePath),
          })),
          shippingCents: order.snapshot.shippingCents,
          shipping: shipTo,
          couponId: coupon.data,
        },
        { siteUrl: env.NEXT_PUBLIC_SITE_URL, nowMs: Date.now() },
      ),
      // A retried create returns the same session instead of opening a second one.
      { idempotencyKey: `checkout:${order.id}` },
    );
  } catch (error) {
    logStripeFailed(order.id, error);
    // No session exists, so nothing at Stripe can take money for this order.
    await expire(order.id, expiryReasons.sessionNotCreated);
    if (stripeErrorCode(error) !== "amount_too_small") return fail({ code: "payment_unavailable" });
    if (order.discount !== null) logDiscountBelowMinimum(order.id);
    return fail({ code: "below_minimum", minimumCents: minimumChargeCents(env.STORE_CURRENCY) });
  }

  const saved = await saveSessionId(order.id, session.id);
  if (saved !== "saved" || session.url === null) {
    // The browser never gets this session's URL. Kill it at Stripe while its id is still in
    // memory; if even that fails, the order stays pending, the session dies at Stripe on its
    // own, and the reconcile cron finds its checkout.session.expired event.
    const killed = await stripe.checkout.sessions.expire(session.id).then(
      () => true,
      () => false,
    );
    if (killed) await expire(order.id, expiryReasons.sessionNotSaved);
    return fail({ code: saved === "moved" ? "checkout_in_progress" : "payment_unavailable" });
  }

  logCheckoutStarted({
    orderId: order.id,
    number: order.number,
    totalCents: order.totalCents,
    shippingCents: order.snapshot.shippingCents,
    discountCents: order.snapshot.discountCents,
    discountCodeId: order.discount?.codeId ?? null,
  });
  return { ok: true, data: { url: session.url } };
}

// spec 0014, AC-7 and AC-8: no coupon, no session; the order is expired, which frees its use.
async function createCoupon(order: CreatedOrder): Promise<Result<string | null>> {
  if (order.discount === null) return { ok: true, data: null };
  const id = await createOrderCoupon({
    id: order.id,
    code: order.discount.code,
    discountCents: order.snapshot.discountCents,
  });
  if (id !== null) return { ok: true, data: id };
  await expire(order.id, expiryReasons.couponNotCreated);
  return fail({ code: "payment_unavailable" });
}

function fail<T>(error: StartCheckoutError): Result<T> {
  return { ok: false, error };
}

async function expire(orderId: string, reason: string): Promise<void> {
  const moved = await db.$transaction((tx) => markExpired(tx, orderId, reason));
  if (moved) logOrderExpired(orderId, reason);
}

// The other tab may save its session id between our read and this write, and its customer then
// holds a live payment page. Rechecking the id under the row lock closes that gap: the save
// either landed first (we back off) or waits for us and finds the order moved.
async function expireWithoutSession(orderId: string): Promise<"cleared" | "in_progress"> {
  const reason = expiryReasons.replaced;
  const outcome = await db.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ stripe_checkout_session_id: string | null }[]>`
      SELECT stripe_checkout_session_id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
    if (row !== undefined && row.stripe_checkout_session_id !== null) return "in_progress";
    return (await markExpired(tx, orderId, reason)) ? "expired" : "cleared";
  });
  if (outcome === "expired") logOrderExpired(orderId, reason);
  return outcome === "in_progress" ? "in_progress" : "cleared";
}

// AC-9, step 2: a cart may hold one pending order. Before a new one, the old one's session is
// ended at Stripe. If Stripe reports it paid, processing or unknown, the old order is kept and no
// new one is made.
async function clearPendingOrder(cartId: string): Promise<Result<null>> {
  const pending = await db.order.findFirst({
    where: { cartId, status: "pending_payment" },
    select: { id: true, stripeCheckoutSessionId: true },
  });
  if (!pending) return { ok: true, data: null };

  const sessionId = pending.stripeCheckoutSessionId;
  // No session id: its session was never created, was expired when saving its id failed, or
  // another tab is midway through checkout and has not saved it yet.
  if (sessionId === null) {
    const outcome = await expireWithoutSession(pending.id);
    return outcome === "in_progress"
      ? fail({ code: "checkout_in_progress" })
      : { ok: true, data: null };
  }

  try {
    let state = sessionState(await stripe.checkout.sessions.retrieve(sessionId));
    if (state === "open") {
      try {
        await stripe.checkout.sessions.expire(sessionId);
        state = "expired";
      } catch {
        // It may have completed a moment ago: branch once more on what Stripe says now.
        state = sessionState(await stripe.checkout.sessions.retrieve(sessionId));
        if (state === "open") return fail({ code: "payment_unavailable" });
      }
    }
    // Only an expired session can no longer take money; any other keeps its order.
    if (state !== "expired") return keepEarlierOrder(pending.id, sessionId);
  } catch {
    return fail({ code: "payment_unavailable" });
  }

  await expire(pending.id, expiryReasons.replaced);
  return { ok: true, data: null };
}

async function keepEarlierOrder(orderId: string, sessionId: string): Promise<Result<null>> {
  const order = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { status: true },
  });
  // Still pending: a delayed method is processing, or the webhook has not landed yet.
  if (order.status === "pending_payment") return fail({ code: "payment_processing" });
  // A delayed payment failed meanwhile: nothing was paid, so the cart may start over.
  if (order.status === "expired") return { ok: true, data: null };
  return fail({
    code: "already_paid",
    confirmationUrl: `/checkout/complete?session_id=${encodeURIComponent(sessionId)}`,
  });
}

// spec 0012, AC-7 and AC-15: a guest pays only for a guest cart; a signed in customer's guest
// cookie cart first joins the account cart, and lines already there send the form back to reload.
async function checkoutCartId(customer: CustomerIdentity | null): Promise<Result<string>> {
  const merge = customer === null ? null : await mergeCartForCustomer(customer.id);
  if (merge?.accountHadLines) return fail({ code: "cart_changed", merged: true });
  const cartId = merge === null ? await readOwnedCartId() : merge.cartId;
  return cartId === null ? fail({ code: "cart_changed" }) : { ok: true, data: cartId };
}

// spec 0017, AC-11: written on the order in the transaction that creates it, never changed. A
// replaced or restarted checkout makes a new order with its own fresh values.
type TermsAcceptance = { readonly version: Date; readonly acceptedAt: Date };

type CreatedOrder = {
  readonly id: string;
  readonly number: number;
  readonly totalCents: number;
  readonly snapshot: OrderSnapshot;
  // The code this order redeemed, or null for none.
  readonly discount: { readonly codeId: string; readonly code: string } | null;
};

// AC-1, step 3: under the cart lock, reread the cart live and freeze it into an order. Prices
// and the delivery fee come from the database here and nowhere else (spec 0007, AC-5).
async function createPendingOrder(
  cartId: string,
  email: string,
  shipTo: ShipTo,
  account: CheckoutAccount | null,
  codeInput: unknown,
  terms: TermsAcceptance,
): Promise<Result<CreatedOrder>> {
  try {
    const created = await db.$transaction(
      async (tx): Promise<Result<CreatedOrder & { readonly addressSaved: boolean }>> => {
        // The customer lock comes before the cart lock, the order every account write takes.
        const profileName = account === null ? null : await lockAccount(tx, account);
        const [cart] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM carts WHERE id = ${cartId}::uuid AND expires_at > now() FOR UPDATE`;
        if (!cart) return fail({ code: "cart_changed" });

        // spec 0009, Key invariants: a product delete locks its variants before checking for
        // order lines, so holding these until commit means it either waits and then sees this
        // order, or already deleted them and this cart no longer reads them.
        await tx.$queryRaw`
        SELECT v.id FROM product_variants v
        JOIN cart_items ci ON ci.variant_id = v.id
        WHERE ci.cart_id = ${cartId}::uuid
        ORDER BY v.id FOR KEY SHARE OF v`;
        const sources = await loadLockedCart(tx, cartId);
        if (!canCheckout(sources.map((source) => source.facts))) {
          return fail({ code: "cart_changed" });
        }

        // Another tab got here first, between our step 2 and this lock.
        const racing = await tx.order.findFirst({
          where: { cartId, status: "pending_payment" },
          select: { id: true },
        });
        if (racing) return fail({ code: "checkout_in_progress" });

        // Read here, never from the cache: an admin change made while the customer sat on
        // /checkout applies to this Pay (AC-7), and Stripe's page shows that total.
        const settings = await readShippingSettings(tx);
        const lines = sources.map((source) => source.snapshot);
        const minimumCents = minimumChargeCents(env.STORE_CURRENCY);
        // spec 0014, Key invariants: below the minimum without a code is answered before any
        // code check.
        const undiscounted = snapshotOrder(lines, settings, null);
        if (undiscounted.totalCents < minimumCents) {
          return fail({ code: "below_minimum", minimumCents });
        }

        // spec 0014, AC-4: the code lock comes after the customer and cart locks, and before the
        // order, line and redemption inserts that touch the code row's foreign keys.
        const locked = await applyLockedCode(tx, {
          codeInput,
          email,
          subtotalCents: undiscounted.subtotalCents,
          settings,
          minimumCents,
        });
        if (!locked.ok) return fail({ code: "discount_refused", ...locked.error });
        const applied = locked.data;
        const snapshot = snapshotOrder(lines, settings, applied);
        // The AC-2 cap keeps a discounted total at the minimum; this is the backstop.
        if (snapshot.totalCents < minimumCents) {
          throw new Error("A discounted order fell below the minimum charge");
        }

        const customerName = orderCustomerName(profileName, shipTo.fullName);
        const order = await tx.order.create({
          data: {
            id: uuidv7(),
            cartId,
            customerId: account?.customer.id ?? null,
            email,
            customerName,
            ...deliveryColumns(shipTo),
            currency: env.STORE_CURRENCY,
            subtotalCents: snapshot.subtotalCents,
            discountCents: snapshot.discountCents,
            shippingCents: snapshot.shippingCents,
            totalCents: snapshot.totalCents,
            termsVersion: terms.version,
            termsAcceptedAt: terms.acceptedAt,
            // spec 0014, AC-4: the code's snapshot, written once and never changed.
            ...(applied === null
              ? {}
              : {
                  discountCodeId: applied.codeId,
                  discountCode: applied.code,
                  discountType: applied.type,
                  discountValue: applied.value,
                }),
            lines: {
              create: snapshot.lines.map((line) => ({
                variantId: line.variantId,
                productId: line.productId,
                productName: line.productName,
                variantLabel: line.variantLabel,
                sku: line.sku,
                imagePath: line.imagePath,
                unitPriceCents: line.unitPriceCents,
                quantity: line.quantity,
                discountCents: line.discountCents,
                lineTotalCents: line.lineTotalCents,
              })),
            },
            events: {
              create: { type: "created", toStatus: "pending_payment", actorType: "customer" },
            },
          },
          select: { id: true, number: true, totalCents: true },
        });
        if (applied !== null) {
          await redeem(tx, { codeId: applied.codeId, orderId: order.id, email });
        }
        const addressSaved =
          account === null ? false : await saveToAccount(tx, account, shipTo, customerName);
        const discount = applied === null ? null : { codeId: applied.codeId, code: applied.code };
        return { ok: true, data: { ...order, snapshot, discount, addressSaved } };
      },
    );
    if (!created.ok) return created;
    const { addressSaved, ...order } = created.data;
    if (addressSaved && account !== null) {
      logAccountEvent("account.address_saved", { customerId: account.customer.id });
    }
    return { ok: true, data: order };
  } catch (error) {
    // The partial unique index is the backstop for two submits racing past the check above.
    if (uniqueViolation(error) === pendingOrderIndex) return fail({ code: "checkout_in_progress" });
    throw error;
  }
}

async function loadLockedCart(tx: Tx, cartId: string) {
  const items = await tx.cartItem.findMany({
    where: { cartId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      quantity: true,
      variant: {
        select: {
          id: true,
          sku: true,
          priceCents: true,
          stockQuantity: true,
          archived: true,
          optionValues: {
            select: {
              optionValue: {
                select: { id: true, value: true, optionType: { select: { position: true } } },
              },
            },
          },
          product: {
            select: {
              id: true,
              name: true,
              status: true,
              images: { select: { storagePath: true, position: true, optionValueId: true } },
            },
          },
        },
      },
    },
  });

  return items.map(({ quantity, variant }) => {
    const values = variant.optionValues.map(({ optionValue }) => optionValue);
    return {
      facts: {
        quantity,
        priceCents: variant.priceCents,
        stockQuantity: variant.stockQuantity,
        variantArchived: variant.archived,
        productActive: variant.product.status === "active",
      },
      snapshot: {
        variantId: variant.id,
        productId: variant.product.id,
        productName: variant.product.name,
        variantLabel: variantLabel(
          values.map((value) => ({ value: value.value, typePosition: value.optionType.position })),
        ),
        sku: variant.sku,
        imagePath: orderLineImage(
          variant.product.images,
          values.map((value) => value.id),
        ),
        unitPriceCents: variant.priceCents,
        quantity,
      },
    };
  });
}

// Only while the order is still pending: if a second tab expired it meanwhile, this answers
// "moved" and the caller ends the new session instead of sending anyone to it.
async function saveSessionId(
  orderId: string,
  sessionId: string,
): Promise<"saved" | "moved" | "failed"> {
  try {
    const { count } = await db.order.updateMany({
      where: { id: orderId, status: "pending_payment" },
      data: { stripeCheckoutSessionId: sessionId },
    });
    return count === 1 ? "saved" : "moved";
  } catch {
    return "failed";
  }
}
