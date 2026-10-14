import "server-only";

import { after } from "next/server";

import { deliverAll } from "./deliver";
import { logEmailDeliveryError } from "./log";

// spec 0011, AC-8: the one after() call. Callers pass the ids their transaction queued, only
// once it committed; the send then runs after the response, so Resend being slow or down never
// holds a webhook answer or an admin action. DB tests replace this module (after() needs a
// request scope). It never throws to the caller: an unscheduled row stays pending for the sweep.
export function scheduleDelivery(ids: readonly (string | null)[]): void {
  const queued = ids.filter((id): id is string => id !== null);
  if (queued.length === 0) return;
  try {
    after(() => deliverAll(queued));
  } catch (error) {
    for (const id of queued) logEmailDeliveryError({ emailSendId: id }, error);
  }
}
