import { Skeleton } from "@/components/ui/skeleton";

export default function AppLoading() {
  return (
    <div className="px-6 lg:px-10 py-8 lg:py-10 space-y-8">
      <div className="rounded-[var(--radius-2xl)] border border-[var(--color-ink-100)] p-8">
        <Skeleton className="h-3 w-32 mb-4" />
        <Skeleton className="h-20 w-2/3 mb-3" />
        <Skeleton className="h-3 w-44" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card-solid p-5">
            <Skeleton className="h-2.5 w-20 mb-3" />
            <Skeleton className="h-10 w-24 mb-2" />
            <Skeleton className="h-2.5 w-16" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card-solid p-5">
          <Skeleton className="h-3 w-32 mb-4" />
          <div className="space-y-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </div>
        <div className="card-solid p-5">
          <Skeleton className="h-3 w-32 mb-4" />
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full mb-2" />
          ))}
        </div>
      </div>
    </div>
  );
}
