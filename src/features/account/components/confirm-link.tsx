import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

import { accountMessages } from "../messages";
import { accountPaths } from "../paths";
import { confirmLinkSchema, type ConfirmLinkType } from "../schemas";
import { AccountAuthCard, footerLinkClass } from "./auth-card";
import { ConfirmLinkForm } from "./confirm-link-form";
import { ResendLinkForm } from "./resend-link-form";

type SearchParams = Record<string, string | string[] | undefined>;

// spec 0012, AC-2: what /account/confirm shows. Opening the link changes nothing; only Continue
// (a POST) spends the token. A link that failed, or is not one of ours, shows the expired message
// with the way to a new one.
export async function ConfirmLink({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const type = params.type === "signup" || params.type === "recovery" ? params.type : null;
  const link = confirmLinkSchema.safeParse({ tokenHash: params.token_hash, type: params.type });

  if (params.failed === undefined && link.success) {
    const signup = link.data.type === "signup";
    return (
      <AccountAuthCard
        title={signup ? "Confirm your email" : "Reset your password"}
        description={
          signup
            ? "Continue to confirm your email. Then you choose your password."
            : "Continue to confirm it is you. Then you choose a new password."
        }
      >
        <ConfirmLinkForm tokenHash={link.data.tokenHash} type={link.data.type} />
      </AccountAuthCard>
    );
  }
  return <ExpiredLink type={type} />;
}

function ExpiredLink({ type }: { readonly type: ConfirmLinkType | null }) {
  return (
    <AccountAuthCard
      title="This link does not work"
      description={accountMessages.linkExpired}
      footer={
        <Link href={accountPaths.signIn} className={footerLinkClass}>
          Sign in
        </Link>
      }
    >
      {type === "signup" ? (
        <ResendLinkForm />
      ) : type === "recovery" ? (
        <Link href={accountPaths.forgotPassword} className={buttonVariants({ size: "lg" })}>
          Ask for a new reset link
        </Link>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href={accountPaths.signUp} className={buttonVariants({ size: "lg" })}>
            Create an account
          </Link>
          <Link
            href={accountPaths.forgotPassword}
            className={buttonVariants({ variant: "outline", size: "lg" })}
          >
            Reset your password
          </Link>
        </div>
      )}
    </AccountAuthCard>
  );
}
