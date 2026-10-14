"use client";

import { useSearchParams } from "next/navigation";

import { FormNotice } from "@/components/form-notice";

import { accountMessages } from "../messages";

// spec 0012, AC-20: the home page after a deletion. It reads only the query string, in the
// browser, so the home page stays cached.
export function AccountDeletedNotice() {
  const deleted = useSearchParams().get("notice") === "account_deleted";
  return <FormNotice message={deleted ? accountMessages.deleted : null} tone="info" />;
}
