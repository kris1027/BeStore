import { Button } from "@/components/ui/button";

import { confirmEmail } from "../actions/confirm";
import type { ConfirmLinkType } from "../schemas";

// A plain form: the token travels in hidden fields and is only spent on this POST (AC-2).
export function ConfirmLinkForm({
  tokenHash,
  type,
}: {
  readonly tokenHash: string;
  readonly type: ConfirmLinkType;
}) {
  return (
    <form action={confirmEmail}>
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      <Button type="submit" size="lg" className="w-full">
        Continue
      </Button>
    </form>
  );
}
