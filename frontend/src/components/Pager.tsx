'use client';

/**
 * Pager — page-size selector + page navigation.
 *
 * Default page size 20 (light, save bandwidth). User can flip to 50 or 100.
 * Used across all paginated list pages so behaviour is consistent.
 */
interface PagerProps {
  page: number;            // 1-indexed
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizes?: readonly number[];
}

const DEFAULT_PAGE_SIZES = [20, 50, 100] as const;

export function Pager({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizes = DEFAULT_PAGE_SIZES,
}: PagerProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(safePage * pageSize, total);
  const canPrev = safePage > 1;
  const canNext = safePage < totalPages;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
      <div className="text-brawl-text-dim">
        Showing <span className="text-brawl-text font-mono">{start}</span>–
        <span className="text-brawl-text font-mono">{end}</span> of{' '}
        <span className="text-brawl-text font-mono">{total}</span>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-brawl-text-dim">Per page</label>
        <select
          className="brawl-input w-auto !min-h-[2rem] !py-1 !text-sm"
          value={pageSize}
          onChange={(e) => {
            onPageSizeChange(Number(e.target.value));
            onPageChange(1);
          }}
        >
          {pageSizes.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <button
          className="brawl-btn !min-h-[2rem] !py-1 !px-3 disabled:opacity-40"
          disabled={!canPrev}
          onClick={() => onPageChange(safePage - 1)}
        >
          ← Prev
        </button>
        <div className="text-brawl-text-dim font-mono">
          Page <span className="text-brawl-text">{safePage}</span> / {totalPages}
        </div>
        <button
          className="brawl-btn !min-h-[2rem] !py-1 !px-3 disabled:opacity-40"
          disabled={!canNext}
          onClick={() => onPageChange(safePage + 1)}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
