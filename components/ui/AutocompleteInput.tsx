'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

export interface AutocompleteOption {
  value: string;
  label: string;
  sublabel?: string;
}

interface AutocompleteInputProps {
  options: AutocompleteOption[];
  value: string;
  onChange: (value: string, option?: AutocompleteOption) => void;
  placeholder?: string;
  allowFreeText?: boolean;
  uppercase?: boolean;
  disabled?: boolean;
  className?: string;
  inputId?: string;
  badgeForFreeText?: string;
  clearable?: boolean;
  compact?: boolean;
}

export function AutocompleteInput({
  options,
  value,
  onChange,
  placeholder = 'Ketik untuk mencari...',
  allowFreeText = false,
  uppercase = false,
  disabled = false,
  className = '',
  inputId,
  badgeForFreeText,
  clearable = true,
  compact = false,
}: AutocompleteInputProps) {
  const [open, setOpen] = useState(false);

  const resolvedLabel = useMemo(() => {
    if (!value) return '';
    const match = options.find((opt) => opt.value === value);
    return match ? match.label : value;
  }, [options, value]);

  const [query, setQuery] = useState(resolvedLabel);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(resolvedLabel);
  }, [resolvedLabel]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        if (!allowFreeText) {
          setQuery(resolvedLabel);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [allowFreeText, resolvedLabel]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || (!open && query === resolvedLabel)) return options.slice(0, 60);
    // Jika query persis sama dengan item yang baru dipilih, tampilkan semua agar mudah ganti
    if (options.some((o) => o.label.toLowerCase() === q && o.value === value)) {
      return options.slice(0, 60);
    }
    return options
      .filter(
        (opt) =>
          opt.label.toLowerCase().includes(q) ||
          opt.value.toLowerCase().includes(q) ||
          (opt.sublabel && opt.sublabel.toLowerCase().includes(q))
      )
      .slice(0, 60);
  }, [options, query, open, resolvedLabel, value]);

  const exactMatchExists = useMemo(() => {
    const norm = query.trim().toLowerCase();
    if (!norm) return true;
    return options.some(
      (opt) => opt.label.toLowerCase() === norm || opt.value.toLowerCase() === norm
    );
  }, [options, query]);

  const handleInputChange = (raw: string) => {
    const next = uppercase ? raw.toUpperCase() : raw;
    setQuery(next);
    setOpen(true);
    if (allowFreeText) {
      onChange(next);
    } else {
      const matched = options.find(
        (opt) => opt.label.toLowerCase() === next.trim().toLowerCase()
      );
      if (matched) {
        onChange(matched.value, matched);
      } else if (!next.trim()) {
        onChange('');
      }
    }
  };

  const handleClear = () => {
    setQuery('');
    onChange('');
    setOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <Search className="w-4 h-4 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          id={inputId}
          type="text"
          value={query}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(e) => handleInputChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className={`w-full rounded-xl border border-border-sky bg-white pl-9 ${
            clearable && query ? 'pr-14' : 'pr-9'
          } ${
            compact ? 'py-2 text-xs' : 'py-3 text-sm'
          } text-ink placeholder:text-ink-muted/60 focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:bg-page/70 transition`}
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {clearable && query && !disabled && (
            <button
              type="button"
              tabIndex={-1}
              onClick={handleClear}
              className="p-1 rounded-md text-ink-muted hover:text-danger hover:bg-danger/10 transition"
              aria-label="Hapus pilihan"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            onClick={() => setOpen((p) => !p)}
            className="p-1 text-ink-muted hover:text-ink"
            aria-label="Toggle daftar pilihan"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      </div>

      {allowFreeText && badgeForFreeText && query.trim().length > 0 && !exactMatchExists && (
        <span className="mt-1.5 inline-flex items-center rounded-lg bg-warning/15 border border-warning/30 px-2.5 py-0.5 text-xs font-medium text-amber-800">
          {badgeForFreeText}
        </span>
      )}

      {open && !disabled && (
        <div className="absolute z-50 mt-1.5 w-full min-w-[220px] max-h-60 overflow-y-auto rounded-xl border border-border-sky bg-white shadow-card py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-xs text-ink-muted">
              {allowFreeText
                ? 'Tidak ada di master, teks yang diketik tetap dapat digunakan.'
                : 'Data tidak ditemukan.'}
            </div>
          ) : (
            filtered.map((opt) => {
              const selected = opt.value === value || opt.label === query;
              return (
                <button
                  key={`${opt.value}-${opt.label}`}
                  type="button"
                  onMouseDown={(e) => {
                    // Tangani di onMouseDown sebelum onBlur/outside click terjadi
                    e.preventDefault();
                    setQuery(opt.label);
                    onChange(opt.value, opt);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3.5 py-2 text-sm flex items-center justify-between gap-2 hover:bg-page transition ${
                    selected ? 'bg-primary-50 font-semibold text-primary-700' : 'text-ink'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="truncate">{opt.label}</div>
                    {opt.sublabel && (
                      <div className="text-xs text-ink-muted font-normal truncate">{opt.sublabel}</div>
                    )}
                  </div>
                  {selected && <Check className="w-4 h-4 text-primary-600 shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
