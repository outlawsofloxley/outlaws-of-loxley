/**
 * Placeholder card that matches BrawlerCard's layout so the page reserves
 * roughly the right height while brawlers are loading from chain. Pulsing
 * animation is a Tailwind built-in.
 */
export function BrawlerCardSkeleton() {
  return (
    <div className="brawl-card p-3 space-y-2 animate-pulse">
      <div className="h-2 w-8 bg-brawl-border" />
      <div className="aspect-square w-full bg-brawl-border" />
      <div className="h-3 w-3/4 bg-brawl-border" />
      <div className="h-3 w-1/2 bg-brawl-border" />
      <div className="flex items-center justify-between pt-1">
        <div className="h-3 w-12 bg-brawl-border" />
        <div className="h-3 w-14 bg-brawl-border" />
      </div>
    </div>
  );
}

export function BrawlerCardSkeletonGrid({ count = 12 }: { count?: number }) {
  return (
    <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {Array.from({ length: count }).map((_, i) => (
        <BrawlerCardSkeleton key={i} />
      ))}
    </div>
  );
}
