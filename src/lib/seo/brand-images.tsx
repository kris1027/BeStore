import { ImageResponse } from "next/og";

import { brand } from "@/lib/brand/brand";

import { brandCardSize, logoSize } from "./brand-assets";

// spec 0018, AC-3 and AC-4: generated from brand.ts, so a rebrand updates them. next/og's
// default font: the next/font files cannot be handed to it without bundling them twice.

function brandImage(
  text: string,
  fontSize: number,
  size: { readonly width: number; readonly height: number },
): ImageResponse {
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
        fontSize,
      }}
    >
      {text}
    </div>,
    size,
  );
}

export function brandCardResponse(): ImageResponse {
  return brandImage(brand.name, 120, brandCardSize);
}

export function logoResponse(): ImageResponse {
  return brandImage(Array.from(brand.name)[0]?.toUpperCase() ?? "", 360, logoSize);
}
