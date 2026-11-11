'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

interface DataTablePaginationProps {
  totalItems: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export function DataTablePagination({
  totalItems,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: DataTablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const start = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(totalItems, page * pageSize);

  return (
    <div className="px-4 py-3 border-t border-border-sky bg-page/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-ink-muted">
      <div className="flex items-center gap-3">
        <span>
          Menampilkan <strong className="text-ink">{start}-{end}</strong> dari{' '}
          <strong className="text-ink">{totalItems}</strong> data
        </span>
        <select
          value={pageSize}
          onChange={(e) => {
            onPageSizeChange(Number(e.target.value));
            onPageChange(1);
          }}
          className="rounded-lg border border-border-sky bg-white px-2 py-1 text-xs text-ink focus:border-primary-600 focus:outline-none"
          aria-label="Jumlah baris per halaman"
        >
          <option value={10}>10 / hal</option>
          <option value={25}>25 / hal</option>
          <option value={50}>50 / hal</option>
          <option value={100}>100 / hal</option>
        </select>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="inline-flex items-center gap-1 rounded-lg border border-border-sky bg-white px-2.5 py-1.5 font-semibold text-ink hover:bg-page disabled:opacity-40 transition"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          <span>Sebelumnya</span>
        </button>
        <span className="px-2 font-semibold text-ink tabular-nums">
          Hal {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="inline-flex items-center gap-1 rounded-lg border border-border-sky bg-white px-2.5 py-1.5 font-semibold text-ink hover:bg-page disabled:opacity-40 transition"
        >
          <span>Berikutnya</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

