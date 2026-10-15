import { storeContainer } from "@/components/layout/container";
import { cn } from "@/lib/utils";

// The account auth pages: one narrow card in the store's frame.
export default function AccountAuthLayout({ children }: LayoutProps<"/account">) {
  return (
    <div className={cn(storeContainer, "flex justify-center py-12 md:py-16")}>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
