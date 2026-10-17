import { Skeleton } from "@/components/ui/skeleton";

// While a listing renders: the sidebar and a row of cards.
export function ListingSkeleton() {
  return (
    <div
      className="grid items-start gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12"
      aria-hidden="true"
    >
      <div className="hidden flex-col gap-4 lg:flex">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
      <div className="flex flex-col gap-6">
        <div className="flex items-end justify-between gap-4">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-11 w-48" />
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:gap-x-6 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex flex-col gap-3">
              <Skeleton className="aspect-product w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
