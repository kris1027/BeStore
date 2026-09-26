"use client";

import { LogOutIcon, UserIcon } from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { signOutPath } from "../safe-admin-path";

type UserMenuProps = {
  readonly name: string;
  readonly email: string;
};

// The admin shell's top bar menu: who is signed in, and Sign out (AC-2, AC-8).
export function UserMenu({ name, email }: UserMenuProps) {
  const formRef = useRef<HTMLFormElement>(null);

  // The form sits outside the popup, so closing the menu on click cannot unmount it mid submit.
  return (
    <>
      <form ref={formRef} method="post" action={signOutPath} hidden />
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
          <UserIcon data-icon="inline-start" aria-hidden="true" />
          {name}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">{name}</span>
              <span>{email}</span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => formRef.current?.requestSubmit()}>
              <LogOutIcon aria-hidden="true" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
