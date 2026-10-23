import { ImageResponse } from "next/og";

import { brand } from "@/lib/brand/brand";

import { brandCardSize, logoSize } from "./metadata";

// spec 0018, AC-3 and AC-4: generated from brand.ts, so a rebrand updates them. next/og's
// default font: the next/font files cannot be handed to it without bundling them twice.

export function brandCardResponse(): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: brand.colors.background,
        color: brand.colors.foreground,
        fontSize: 120,
      }}
    >
      {brand.name}
    </div>,
    brandCardSize,
  );
}

export function logoResponse(): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: brand.colors.background,
        color: brand.colors.foreground,
        fontSize: 360,
      }}
    >
      {Array.from(brand.name)[0]?.toUpperCase() ?? ""}
    </div>,
    logoSize,
  );
}
