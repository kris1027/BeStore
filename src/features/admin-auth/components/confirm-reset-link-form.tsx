import { Button } from "@/components/ui/button";

import { confirmResetLink } from "../actions/password-reset";

// A plain form: the token travels in hidden fields and is only spent on this POST.
export function ConfirmResetLinkForm({ tokenHash }: { readonly tokenHash: string }) {
  return (
    <form action={confirmResetLink}>
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value="recovery" />
      <Button type="submit" size="lg" className="w-full">
        Continue
      </Button>
    </form>
  );
}
